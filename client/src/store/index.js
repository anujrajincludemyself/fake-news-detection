import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import analysisReducer from './slices/analysisSlice';
import uiReducer from './slices/uiSlice';
import wallReducer from './slices/wallSlice';
import networkReducer from './slices/networkSlice';

const store = configureStore({
  reducer: {
    auth: authReducer,
    analysis: analysisReducer,
    ui: uiReducer,
    wall: wallReducer,
    network: networkReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Only ignore the non-serializable Date.now() used in TTL fields
      serializableCheck: {
        ignoredPaths: ['analysis.statsLastFetched', 'wall.lastFetched', 'network.lastFetched'],
      },
    }),
  devTools: process.env.NODE_ENV !== 'production',
});

export default store;
