import React, { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiActivity,
  FiAlertTriangle,
  FiGlobe,
  FiLink,
  FiLayers,
  FiRefreshCw,
  FiX,
  FiZoomIn,
  FiZoomOut,
  FiMaximize,
} from 'react-icons/fi';
import { fetchNetwork, resetNetworkCache } from '../store/slices/networkSlice';
import './NetworkGraphPage.css';

/* ══════════════════════════════════════════════════════════════
   FORCE-DIRECTED GRAPH ENGINE  (zero dependencies)
   ══════════════════════════════════════════════════════════════ */

function createSimulation(nodes, edges, width, height) {
  // Assign initial positions in a circle
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.32;

  const simNodes = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    return {
      ...n,
      x: cx + radius * Math.cos(angle) + (Math.random() - 0.5) * 40,
      y: cy + radius * Math.sin(angle) + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
      radius: Math.max(8, Math.min(32, 6 + Math.sqrt(n.fakeCount) * 4)),
    };
  });

  const nodeIndex = {};
  simNodes.forEach((n, i) => { nodeIndex[n.id] = i; });

  const simEdges = edges
    .filter((e) => nodeIndex[e.source] !== undefined && nodeIndex[e.target] !== undefined)
    .map((e) => ({
      ...e,
      sourceIdx: nodeIndex[e.source],
      targetIdx: nodeIndex[e.target],
    }));

  return { nodes: simNodes, edges: simEdges, cx, cy };
}

function tick(sim, width, height) {
  const { nodes, edges, cx, cy } = sim;
  const DAMPING = 0.88;
  const REPULSION = 1800;
  const ATTRACTION = 0.005;
  const CENTER_GRAVITY = 0.01;

  // Repulsion between all node pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      nodes[i].vx += fx;
      nodes[i].vy += fy;
      nodes[j].vx -= fx;
      nodes[j].vy -= fy;
    }
  }

  // Attraction along edges
  for (const e of edges) {
    const a = nodes[e.sourceIdx];
    const b = nodes[e.targetIdx];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = dist * ATTRACTION * (1 + e.weight);
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // Center gravity
  for (const n of nodes) {
    n.vx += (cx - n.x) * CENTER_GRAVITY;
    n.vy += (cy - n.y) * CENTER_GRAVITY;
  }

  // Apply velocity
  const PAD = 40;
  for (const n of nodes) {
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    n.x += n.vx;
    n.y += n.vy;
    // Keep within bounds
    n.x = Math.max(PAD, Math.min(width - PAD, n.x));
    n.y = Math.max(PAD, Math.min(height - PAD, n.y));
  }
}

/* ── colour helpers ─────────────────────────────────────────── */

function fakeScoreColor(score) {
  if (score >= 70) return '#ef4444';
  if (score >= 40) return '#f97316';
  if (score >= 20) return '#fbbf24';
  return '#4ade80';
}

function fakeScoreGlow(score) {
  if (score >= 70) return 'rgba(239,68,68,0.45)';
  if (score >= 40) return 'rgba(249,115,22,0.35)';
  if (score >= 20) return 'rgba(251,191,36,0.25)';
  return 'rgba(74,222,128,0.2)';
}

/* ── Canvas renderer ────────────────────────────────────────── */
function drawGraph(ctx, sim, hoveredNode, zoom, panX, panY, time) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  const { nodes, edges } = sim;

  // Draw edges with animated particles
  for (const e of edges) {
    const a = nodes[e.sourceIdx];
    const b = nodes[e.targetIdx];
    const alpha = 0.15 + e.weight * 0.4;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `rgba(139,92,246,${alpha})`;
    ctx.lineWidth = 0.8 + e.weight * 2;
    ctx.stroke();

    // Animated particle along edge
    const t = ((time * 0.001 * (0.3 + e.weight)) % 1);
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    ctx.beginPath();
    ctx.arc(px, py, 2 + e.weight * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(168,85,247,${0.6 + e.weight * 0.3})`;
    ctx.fill();
  }

  // Draw nodes
  for (const n of nodes) {
    const isHovered = hoveredNode && hoveredNode.id === n.id;
    const color = fakeScoreColor(n.fakeScore);
    const glow = fakeScoreGlow(n.fakeScore);
    const r = n.radius * (isHovered ? 1.3 : 1);

    // Outer glow (pulsing)
    const pulseR = r + 4 + Math.sin(time * 0.003 + n.fakeScore) * 3;
    ctx.beginPath();
    ctx.arc(n.x, n.y, pulseR, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Main circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.3, r * 0.1, n.x, n.y, r);
    grad.addColorStop(0, color + 'dd');
    grad.addColorStop(1, color + '88');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = isHovered ? '#fff' : color;
    ctx.lineWidth = isHovered ? 2.5 : 1.2;
    ctx.stroke();

    // Domain label
    const label = n.id.length > 18 ? n.id.slice(0, 16) + '…' : n.id;
    ctx.font = `${isHovered ? 'bold ' : ''}${Math.max(9, r * 0.7)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.75)';
    ctx.fillText(label, n.x, n.y + r + 4);
  }

  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════
   REACT COMPONENT
   ══════════════════════════════════════════════════════════════ */

const StatCard = memo(function StatCard({ icon: Icon, label, value, color, delay }) {
  return (
    <motion.div
      className="net-stat-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <div className="net-stat-icon" style={{ color }}><Icon size={20} /></div>
      <div className="net-stat-body">
        <span className="net-stat-value" style={{ color }}>{value}</span>
        <span className="net-stat-label">{label}</span>
      </div>
    </motion.div>
  );
});

const ThreatBadge = memo(function ThreatBadge({ level, color }) {
  return (
    <motion.div
      className="net-threat-badge"
      style={{ borderColor: color, color }}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, delay: 0.3 }}
    >
      <FiAlertTriangle size={16} />
      <span className="net-threat-level">{level}</span>
      <span className="net-threat-sub">Threat Level</span>
    </motion.div>
  );
});

const ClusterCard = memo(function ClusterCard({ cluster, nodeMap, index }) {
  return (
    <motion.div
      className="net-cluster-card"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 * index, duration: 0.3 }}
    >
      <div className="net-cluster-header">
        <FiLayers size={14} />
        <span>Cluster #{cluster.id + 1}</span>
        <span className="net-cluster-score" style={{ color: fakeScoreColor(cluster.avgFakeScore) }}>
          Avg. Fake Score: {cluster.avgFakeScore}
        </span>
      </div>
      <div className="net-cluster-domains">
        {cluster.domains.map((d) => {
          const node = nodeMap[d];
          return (
            <span key={d} className="net-cluster-domain-pill" style={{ borderColor: fakeScoreColor(node?.fakeScore || 0) }}>
              {d}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
});

const TimelineBar = memo(function TimelineBar({ timeline }) {
  if (!timeline.length) return null;
  const maxVal = Math.max(...timeline.map((d) => d.total), 1);

  return (
    <div className="net-timeline">
      <h3 className="net-section-title"><FiActivity size={16} /> Activity Timeline (30 days)</h3>
      <div className="net-timeline-bars">
        {timeline.map((d, i) => (
          <div key={d.date} className="net-timeline-col" title={`${d.date}\nFake: ${d.fake}  Real: ${d.real}  Uncertain: ${d.uncertain}`}>
            <div className="net-timeline-stack" style={{ height: `${(d.total / maxVal) * 100}%` }}>
              {d.fake > 0 && (
                <motion.div
                  className="net-tl-fake"
                  style={{ flex: d.fake }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: i * 0.02, duration: 0.4 }}
                />
              )}
              {d.real > 0 && (
                <motion.div
                  className="net-tl-real"
                  style={{ flex: d.real }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: i * 0.02 + 0.05, duration: 0.4 }}
                />
              )}
              {d.uncertain > 0 && (
                <motion.div
                  className="net-tl-uncertain"
                  style={{ flex: d.uncertain }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: i * 0.02 + 0.1, duration: 0.4 }}
                />
              )}
            </div>
            {i % Math.max(1, Math.floor(timeline.length / 6)) === 0 && (
              <span className="net-tl-label">{d.date.slice(5)}</span>
            )}
          </div>
        ))}
      </div>
      <div className="net-timeline-legend">
        <span><span className="net-legend-dot" style={{ background: '#ef4444' }} /> Fake</span>
        <span><span className="net-legend-dot" style={{ background: '#4ade80' }} /> Real</span>
        <span><span className="net-legend-dot" style={{ background: '#fbbf24' }} /> Uncertain</span>
      </div>
    </div>
  );
});

/* ── detail sidebar ─────────────────────────────────────────── */
const NodeDetail = memo(function NodeDetail({ node, edges, onClose }) {
  if (!node) return null;
  const connections = edges.filter((e) => e.source === node.id || e.target === node.id);
  const color = fakeScoreColor(node.fakeScore);

  return (
    <motion.div
      className="net-detail-panel"
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <button className="net-detail-close" onClick={onClose}><FiX /></button>

      <div className="net-detail-domain" style={{ color }}>{node.id}</div>

      <div className="net-detail-fakeindex" style={{ borderColor: color, color }}>
        Fake Score: {node.fakeScore}
      </div>

      <div className="net-detail-stats">
        <div><strong style={{ color: '#ef4444' }}>{node.fakeCount}</strong><span>Fake</span></div>
        <div><strong style={{ color: '#4ade80' }}>{node.realCount}</strong><span>Real</span></div>
        <div><strong style={{ color: '#94a3b8' }}>{node.totalScans}</strong><span>Total</span></div>
      </div>

      {connections.length > 0 && (
        <div className="net-detail-section">
          <h4><FiLink size={13} /> Connected Domains ({connections.length})</h4>
          {connections.map((c, i) => {
            const other = c.source === node.id ? c.target : c.source;
            return (
              <div key={i} className="net-detail-conn">
                <span className="net-detail-conn-domain">{other}</span>
                <span className="net-detail-conn-sim">{Math.round(c.weight * 100)}% similar</span>
              </div>
            );
          })}
        </div>
      )}

      {node.recentFakes?.length > 0 && (
        <div className="net-detail-section">
          <h4>Recent Fake Articles</h4>
          {node.recentFakes.map((t, i) => (
            <div key={i} className="net-detail-article">{t || 'Untitled article'}</div>
          ))}
        </div>
      )}
    </motion.div>
  );
});

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */

const NetworkGraphPage = () => {
  const dispatch = useDispatch();
  const { nodes, edges, clusters, timeline, stats, loading, error } = useSelector((s) => s.network);
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const animRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // O(1) lookup for ClusterCard instead of O(n) .find() per domain
  const nodeMap = useMemo(() => {
    const map = {};
    for (const n of nodes) map[n.id] = n;
    return map;
  }, [nodes]);

  // Refs so the render loop always reads the latest values (no stale closure)
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const hoveredRef = useRef(hoveredNode);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  useEffect(() => { dispatch(fetchNetwork()); }, [dispatch]);

  // Initialise simulation when data arrives
  useEffect(() => {
    if (!nodes.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width * 2; // retina
    const h = rect.height * 2;
    canvas.width = w;
    canvas.height = h;

    simRef.current = createSimulation(nodes, edges, w, h);

    // Run physics warm-up (stabilise the graph before first paint)
    for (let i = 0; i < 120; i++) tick(simRef.current, w, h);

    // Start render loop — reads from refs so it always uses current values
    const startTime = performance.now();
    const render = (now) => {
      if (!simRef.current) return;
      tick(simRef.current, w, h);
      const ctx = canvas.getContext('2d');
      const z = zoomRef.current;
      const p = panRef.current;
      drawGraph(ctx, simRef.current, hoveredRef.current, z, p.x * 2, p.y * 2, now - startTime);
      animRef.current = requestAnimationFrame(render);
    };
    animRef.current = requestAnimationFrame(render);

    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Canvas coordinate conversion — reads latest refs
  const canvasToSim = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const z = zoomRef.current;
    const p = panRef.current;
    return {
      x: ((clientX - rect.left) * scaleX - p.x * 2) / z,
      y: ((clientY - rect.top) * scaleY - p.y * 2) / z,
    };
  }, []);

  const findNodeAt = useCallback((sx, sy) => {
    if (!simRef.current) return null;
    for (const n of simRef.current.nodes) {
      const dx = n.x - sx;
      const dy = n.y - sy;
      if (dx * dx + dy * dy < (n.radius + 6) * (n.radius + 6)) return n;
    }
    return null;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (isDragging.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    const { x, y } = canvasToSim(e.clientX, e.clientY);
    const node = findNodeAt(x, y);
    // Only update state when the hovered node actually changes (prevents re-render per pixel)
    const prevId = hoveredRef.current?.id ?? null;
    const nextId = node?.id ?? null;
    if (prevId !== nextId) {
      hoveredRef.current = node;
      setHoveredNode(node);
    }
    if (canvasRef.current) canvasRef.current.style.cursor = node ? 'pointer' : 'grab';
  }, [canvasToSim, findNodeAt]);

  const handleMouseDown = useCallback((e) => {
    const { x, y } = canvasToSim(e.clientX, e.clientY);
    const node = findNodeAt(x, y);
    if (node) {
      setSelectedNode(node);
    } else {
      isDragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    }
  }, [canvasToSim, findNodeAt]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.3, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  // Attach wheel listener with { passive: false } so preventDefault works
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleRefresh = useCallback(() => {
    dispatch(resetNetworkCache());
    dispatch(fetchNetwork());
  }, [dispatch]);

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(3, z + 0.2)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.3, z - 0.2)), []);
  const clearSelection = useCallback(() => setSelectedNode(null), []);

  return (
    <div className="net-page">
      <div className="container">

        {/* ── Header ─────────────────────────────────── */}
        <div className="net-header">
          <div className="net-header-left">
            <motion.h1
              className="net-title"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <FiGlobe className="net-title-icon" />
              Threat Network Intelligence
            </motion.h1>
            <motion.p
              className="net-subtitle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              Interactive map of misinformation spread — domains connected by shared fake narratives.
            </motion.p>
          </div>
          <div className="net-header-actions">
            {stats && <ThreatBadge level={stats.threatLevel} color={stats.threatColor} />}
            <button className="net-refresh-btn" onClick={handleRefresh} disabled={loading}>
              <FiRefreshCw className={loading ? 'spin' : ''} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* ── Stats Row ──────────────────────────────── */}
        {stats && (
          <div className="net-stats-row">
            <StatCard icon={FiGlobe} label="Domains Tracked" value={stats.totalDomains} color="#a855f7" delay={0.1} />
            <StatCard icon={FiAlertTriangle} label="Fake Articles" value={stats.totalFakeArticles} color="#ef4444" delay={0.15} />
            <StatCard icon={FiLink} label="Connections" value={stats.totalConnections} color="#6366f1" delay={0.2} />
            <StatCard icon={FiLayers} label="Clusters Found" value={stats.totalClusters} color="#f97316" delay={0.25} />
            <StatCard icon={FiActivity} label="Fake Ratio" value={`${stats.fakeRatio}%`} color={stats.threatColor} delay={0.3} />
          </div>
        )}

        {/* ── Error ──────────────────────────────────── */}
        {error && (
          <div className="net-error">
            <FiAlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {error}
          </div>
        )}

        {/* ── Loading ────────────────────────────────── */}
        {loading && !nodes.length && (
          <div className="net-loading">
            <div className="net-spinner" />
            <p>Mapping misinformation network…</p>
          </div>
        )}

        {/* ── Empty state ────────────────────────────── */}
        {!loading && !error && !nodes.length && (
          <div className="net-empty">
            <FiGlobe size={48} opacity={0.3} />
            <h3>No network data yet</h3>
            <p>Analyze articles with source URLs to start building the threat network.</p>
          </div>
        )}

        {/* ── Graph + Sidebar ────────────────────────── */}
        {nodes.length > 0 && (
          <motion.div
            className="net-graph-wrapper"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <div className="net-graph-toolbar">
              <button onClick={zoomIn} title="Zoom in"><FiZoomIn /></button>
              <button onClick={zoomOut} title="Zoom out"><FiZoomOut /></button>
              <button onClick={resetView} title="Reset view"><FiMaximize /></button>
              <span className="net-graph-hint">Click node for details · Scroll to zoom · Drag to pan</span>
            </div>
            <div className="net-graph-container">
              <canvas
                ref={canvasRef}
                className="net-canvas"
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
              <AnimatePresence>
                {selectedNode && (
                  <NodeDetail
                    node={selectedNode}
                    edges={edges}
                    onClose={clearSelection}
                  />
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* ── Clusters ───────────────────────────────── */}
        {clusters.length > 0 && (
          <div className="net-clusters-section">
            <h2 className="net-section-title"><FiLayers size={18} /> Misinformation Clusters</h2>
            <p className="net-section-desc">Domains grouped by shared fake narratives — these sites spread similar misinformation.</p>
            <div className="net-clusters-grid">
              {clusters.map((c, i) => (
                <ClusterCard key={c.id} cluster={c} nodeMap={nodeMap} index={i} />
              ))}
            </div>
          </div>
        )}

        {/* ── Timeline ───────────────────────────────── */}
        {timeline.length > 0 && <TimelineBar timeline={timeline} />}

      </div>
    </div>
  );
};

export default NetworkGraphPage;
