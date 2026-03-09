import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import analysisReducer from './slices/analysisSlice';
import uiReducer from './slices/uiSlice';
import wallReducer from './slices/wallSlice';
import rankingReducer from './slices/rankingSlice';

const store = configureStore({
  reducer: {
    auth: authReducer,
    analysis: analysisReducer,
    ui: uiReducer,
    wall: wallReducer,
    ranking: rankingReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
  devTools: process.env.NODE_ENV !== 'production',
});

export default store;
