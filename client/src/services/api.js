import axios from 'axios';

// Normalise the base URL so it always ends with /api.
// This tolerates REACT_APP_API_URL being set with or without the /api suffix.
const _rawBase =
  process.env.REACT_APP_API_URL || 'https://fake-news-detection-f1ha.onrender.com';
const API_URL = _rawBase.replace(/\/api\/?$/, '') + '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('fn_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('fn_token');
      localStorage.removeItem('fn_user');
      const { pathname } = window.location;
      if (pathname !== '/login' && pathname !== '/register') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
