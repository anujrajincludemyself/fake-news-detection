const Analysis = require('../models/Analysis');
const SiteRecord = require('../models/SiteRecord');

/* ── helpers ────────────────────────────────────────────────── */

/** Tokenise text into a Set of lowercase words (≥3 chars, no stop-words). */
const STOP = new Set([
  'the','and','for','that','this','with','from','are','was','were','has','have',
  'had','been','will','would','could','should','not','but','its','his','her',
  'they','them','their','what','which','who','whom','how','when','where','why',
  'can','did','does','may','might','must','shall','into','than','then','also',
  'just','more','most','other','some','such','only','own','same','very','about',
  'after','before','between','each','few','all','both','through','during','over',
  'under','again','further','once','here','there','out','new','said','one','two',
  'three','year','years','time','people','way','day','man','woman','know','like',
  'get','make','news','says','report','article','according','source','sources',
]);

function tokenise(text) {
  if (!text) return new Set();
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  return new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)));
}

/** Jaccard similarity between two Sets. */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Threat level based on overall fake ratio. */
function threatLevel(fakeRatio) {
  if (fakeRatio >= 0.6) return 'CRITICAL';
  if (fakeRatio >= 0.4) return 'HIGH';
  if (fakeRatio >= 0.2) return 'MODERATE';
  return 'LOW';
}

const THREAT_COLORS = { CRITICAL: '#ef4444', HIGH: '#f97316', MODERATE: '#fbbf24', LOW: '#4ade80' };

/* ── controller ─────────────────────────────────────────────── */

/**
 * @desc  Build misinformation network graph data
 * @route GET /api/network
 * @access Public
 */
exports.getNetwork = async (req, res, next) => {
  try {
    // 1 & 2. Run independent DB queries in parallel
    const [sites, fakeAnalyses] = await Promise.all([
      SiteRecord.find({ totalScans: { $gte: 1 } })
        .sort({ fakeScore: -1 })
        .lean(),
      Analysis.find({
        'prediction.label': { $in: ['FAKE', 'MANIPULATED'] },
        sourceUrl: { $exists: true, $ne: '' },
        status: 'completed',
      })
        .sort({ createdAt: -1 })
        .limit(500)
        .select('title content sourceUrl prediction createdAt')
        .lean(),
    ]);

    // 3. Group fake analyses by domain
    const domainArticles = {};
    for (const a of fakeAnalyses) {
      try {
        const host = new URL(a.sourceUrl).hostname.replace(/^www\./, '');
        if (!domainArticles[host]) domainArticles[host] = [];
        domainArticles[host].push({
          title: a.title || '',
          content: (a.content || '').slice(0, 500),
          confidence: a.prediction?.confidence || 50,
          createdAt: a.createdAt,
        });
      } catch (_) { /* invalid URL */ }
    }

    // 4. Build per-domain word-sets from fake article titles + content snippets
    const domainTokens = {};
    for (const [domain, articles] of Object.entries(domainArticles)) {
      const combined = articles.map((a) => `${a.title} ${a.content}`).join(' ');
      domainTokens[domain] = tokenise(combined);
    }

    // 5. Build nodes from SiteRecords
    const nodeMap = {};
    for (const s of sites) {
      nodeMap[s.domain] = {
        id: s.domain,
        fakeCount: s.fakeCount,
        realCount: s.realCount,
        totalScans: s.totalScans,
        fakeScore: s.fakeScore,
        lastScannedAt: s.lastScannedAt,
        recentFakes: (domainArticles[s.domain] || []).slice(0, 5).map((a) => a.title),
      };
    }

    // Also add domains that appear in fakeAnalyses but not in SiteRecord
    for (const domain of Object.keys(domainArticles)) {
      if (!nodeMap[domain]) {
        const arts = domainArticles[domain];
        nodeMap[domain] = {
          id: domain,
          fakeCount: arts.length,
          realCount: 0,
          totalScans: arts.length,
          fakeScore: 100,
          lastScannedAt: arts[0]?.createdAt || new Date(),
          recentFakes: arts.slice(0, 5).map((a) => a.title),
        };
      }
    }

    const nodes = Object.values(nodeMap);

    // 6. Build edges — connect domains with Jaccard similarity > threshold
    const SIMILARITY_THRESHOLD = 0.08;
    const edges = [];
    const domainList = Object.keys(domainTokens);

    for (let i = 0; i < domainList.length; i++) {
      for (let j = i + 1; j < domainList.length; j++) {
        const d1 = domainList[i];
        const d2 = domainList[j];
        const sim = jaccard(domainTokens[d1], domainTokens[d2]);
        if (sim >= SIMILARITY_THRESHOLD) {
          // Find shared words for narrative label
          const shared = [];
          for (const w of domainTokens[d1]) {
            if (domainTokens[d2].has(w)) shared.push(w);
          }
          edges.push({
            source: d1,
            target: d2,
            weight: Math.round(sim * 100) / 100,
            sharedKeywords: shared.slice(0, 8),
          });
        }
      }
    }

    // 7. Simple cluster detection using connected components
    const parent = {};
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (a, b) => { parent[find(a)] = find(b); };

    for (const d of domainList) parent[d] = d;
    for (const e of edges) union(e.source, e.target);

    const clusterMap = {};
    for (const d of domainList) {
      const root = find(d);
      if (!clusterMap[root]) clusterMap[root] = [];
      clusterMap[root].push(d);
    }

    const clusters = Object.values(clusterMap)
      .filter((c) => c.length > 1)
      .map((domains, i) => ({
        id: i,
        domains,
        size: domains.length,
        avgFakeScore: Math.round(
          domains.reduce((sum, d) => sum + (nodeMap[d]?.fakeScore || 0), 0) / domains.length
        ),
      }));

    // 8. Timeline — aggregate analyses by date (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const timelineAnalyses = await Analysis.find({
      createdAt: { $gte: thirtyDaysAgo },
      status: 'completed',
    })
      .select('prediction.label createdAt')
      .lean();

    const dateMap = {};
    for (const a of timelineAnalyses) {
      const day = a.createdAt.toISOString().split('T')[0];
      if (!dateMap[day]) dateMap[day] = { date: day, fake: 0, real: 0, uncertain: 0, total: 0 };
      dateMap[day].total++;
      const lbl = a.prediction?.label;
      if (lbl === 'FAKE' || lbl === 'MANIPULATED') dateMap[day].fake++;
      else if (lbl === 'REAL' || lbl === 'AUTHENTIC') dateMap[day].real++;
      else dateMap[day].uncertain++;
    }

    const timeline = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

    // 9. Compute global stats
    const totalFake = nodes.reduce((s, n) => s + n.fakeCount, 0);
    const totalReal = nodes.reduce((s, n) => s + n.realCount, 0);
    const totalAll = totalFake + totalReal + nodes.reduce((s, n) => s + (n.totalScans - n.fakeCount - n.realCount), 0);
    const fakeRatio = totalAll > 0 ? totalFake / totalAll : 0;

    const stats = {
      totalDomains: nodes.length,
      totalFakeArticles: totalFake,
      totalAnalyses: totalAll,
      fakeRatio: Math.round(fakeRatio * 100),
      threatLevel: threatLevel(fakeRatio),
      threatColor: THREAT_COLORS[threatLevel(fakeRatio)],
      totalClusters: clusters.length,
      totalConnections: edges.length,
    };

    res.status(200).json({
      success: true,
      data: { nodes, edges, clusters, timeline, stats },
    });
  } catch (error) {
    next(error);
  }
};
