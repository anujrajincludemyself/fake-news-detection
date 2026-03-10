import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import {
  FiBarChart2,
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
  FiArrowRight,
  FiGlobe,
  FiMonitor,
} from 'react-icons/fi';
import { fetchStats } from '../store/slices/analysisSlice';
import './DashboardPage.css';

ChartJS.register(ArcElement, Tooltip, Legend);

// Static config — defined outside component to avoid recreation on every render
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: '#94a3b8',
        padding: 16,
        font: { size: 12, weight: 600 },
      },
    },
  },
  cutout: '65%',
};

const formatDate = (date) =>
  new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const VERDICT_COLOR = {
  REAL:        '#4ade80',
  FAKE:        '#f87171',
  UNCERTAIN:   '#fbbf24',
  AUTHENTIC:   '#4ade80',
  MANIPULATED: '#f87171',
};

const DashboardPage = () => {
  const dispatch = useDispatch();
  const stats = useSelector((state) => state.analysis.stats);
  const statsLoading = useSelector((state) => state.analysis.statsLoading);
  const user = useSelector((state) => state.auth.user);

  useEffect(() => {
    dispatch(fetchStats());
  }, [dispatch]);

  const chartData = stats
    ? {
        labels: ['Real', 'Fake', 'Uncertain'],
        datasets: [
          {
            data: [
              stats.labels.REAL.count,
              stats.labels.FAKE.count,
              stats.labels.UNCERTAIN.count,
            ],
            backgroundColor: [
              'rgba(16, 185, 129, 0.8)',
              'rgba(239, 68, 68, 0.8)',
              'rgba(245, 158, 11, 0.8)',
            ],
            borderColor: [
              'rgba(16, 185, 129, 1)',
              'rgba(239, 68, 68, 1)',
              'rgba(245, 158, 11, 1)',
            ],
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      }
    : null;

  const statCards = useMemo(() => [
    {
      label: 'TOTAL ANALYSES',
      value: statsLoading && !stats ? '…' : (stats?.totalAnalyses ?? 0),
      icon: <FiBarChart2 />,
      color: 'blue',
      sub: 'All time',
    },
    {
      label: 'REAL NEWS',
      value: statsLoading && !stats ? '…' : (stats?.labels?.REAL?.count ?? 0),
      icon: <FiCheckCircle />,
      color: 'green',
      sub: `Avg ${stats?.labels?.REAL?.avgConfidence ?? 0}% confidence`,
    },
    {
      label: 'FAKE NEWS',
      value: statsLoading && !stats ? '…' : (stats?.labels?.FAKE?.count ?? 0),
      icon: <FiXCircle />,
      color: 'red',
      sub: `Avg ${stats?.labels?.FAKE?.avgConfidence ?? 0}% confidence`,
    },
    {
      label: 'UNCERTAIN',
      value: statsLoading && !stats ? '…' : (stats?.labels?.UNCERTAIN?.count ?? 0),
      icon: <FiAlertTriangle />,
      color: 'yellow',
      sub: `Avg ${stats?.labels?.UNCERTAIN?.avgConfidence ?? 0}% confidence`,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [stats, statsLoading]);

  return (
    <div className="dashboard-page">
      <div className="container">
        <motion.div
          className="dashboard-header"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1>Dashboard</h1>
          <p>Welcome back, {user?.name || 'User'}. Here is your analysis overview.</p>
        </motion.div>

        <div className="stats-grid">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              className="stat-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <div className="stat-card-header">
                <span className="stat-card-label">{card.label}</span>
                <div className={`stat-card-icon ${card.color}`}>
                  {card.icon}
                </div>
              </div>
              <div className="stat-card-value">{card.value}</div>
              <div className="stat-card-sub">{card.sub}</div>
            </motion.div>
          ))}
        </div>

        <div className="dashboard-content">
          {/* Recent */}
          <div className="dashboard-section">
            <div className="dashboard-section-header">
              <h3 className="dashboard-section-title">Recent Analyses</h3>
              <Link to="/history" className="btn btn-ghost btn-sm">
                View All <FiArrowRight />
              </Link>
            </div>

            {stats?.recentAnalyses?.length > 0 ? (
              stats.recentAnalyses.map((item) => {
                const isExtension = !item.user;
                const vColor = VERDICT_COLOR[item.prediction.label] || '#94a3b8';
                return (
                  <div key={item._id} className="recent-item">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="recent-item-title">{item.title}</div>
                      <div className="recent-item-date" style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        <span className={`hist-source-tag ${isExtension ? 'tag-ext' : 'tag-web'}`}
                          style={{ fontSize:'0.68rem', padding:'1px 7px' }}>
                          {isExtension ? <><FiGlobe size={9}/> Extension</> : <><FiMonitor size={9}/> Web App</>}
                        </span>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                    </div>
                    <div className="recent-item-right">
                      <span className={`badge badge-${item.prediction.label.toLowerCase()}`}>
                        {item.prediction.label}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: vColor, fontWeight:700 }}>
                        {item.prediction.confidence}%
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                {statsLoading ? 'Loading…' : 'No analyses yet. Start by analyzing a news article!'}
              </div>
            )}
          </div>

          {/* Chart */}
          <div className="dashboard-section">
            <div className="dashboard-section-header">
              <h3 className="dashboard-section-title">
                Prediction Distribution
              </h3>
            </div>
            {chartData &&
            (chartData.datasets[0].data[0] > 0 ||
              chartData.datasets[0].data[1] > 0 ||
              chartData.datasets[0].data[2] > 0) ? (
              <div className="chart-container">
                <Doughnut data={chartData} options={chartOptions} />
              </div>
            ) : (
              <div
                style={{
                  textAlign: 'center',
                  padding: '3rem 1rem',
                  color: 'var(--text-muted)',
                  fontSize: '0.9rem',
                }}
              >
                Chart data will appear after your first analysis.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
