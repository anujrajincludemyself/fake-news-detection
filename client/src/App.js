import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { initNotifications } from './services/notificationService';

import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';

const HomePage = lazy(() => import('./pages/HomePage'));
const AnalyzePage = lazy(() => import('./pages/AnalyzePage'));
const MediaAnalyzePage = lazy(() => import('./pages/MediaAnalyzePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const WallOfFakePage = lazy(() => import('./pages/WallOfFakePage'));
const NetworkGraphPage = lazy(() => import('./pages/NetworkGraphPage'));

function ProtectedRoute({ children }) {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

// Redirect logged-in users away from login/register
function GuestRoute({ children }) {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  return isAuthenticated ? <Navigate to="/" replace /> : children;
}

function App() {
  const theme = useSelector((state) => state.ui.theme);
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Re-register FCM token whenever the user is authenticated (covers page refresh)
  useEffect(() => {
    if (isAuthenticated) {
      initNotifications().catch(() => {});
    }
  }, [isAuthenticated]);

  return (
    <div className="app">
      <Navbar />
      <main>
        <Suspense fallback={<div style={{ padding: '2rem' }}>Loading page...</div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/analyze" element={<ProtectedRoute><AnalyzePage /></ProtectedRoute>} />
            <Route path="/media-analyze" element={<ProtectedRoute><MediaAnalyzePage /></ProtectedRoute>} />
            <Route path="/wall-of-fake" element={<WallOfFakePage />} />
            <Route path="/network" element={<NetworkGraphPage />} />
            <Route path="/about" element={<ProtectedRoute><AboutPage /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/history" element={<ProtectedRoute><HistoryPage /></ProtectedRoute>} />
            <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
            <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

export default App;
