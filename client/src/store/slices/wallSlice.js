import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';
// Lazy import via string-matching to avoid circular deps — see addMatcher below

const CACHE_TTL_MS = 60 * 1000;
const RUMOR_CACHE_TTL_MS = 5 * 60 * 1000;

export const fetchWall = createAsyncThunk(
  'wall/fetch',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/wall');
      return data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load Wall of Fake');
    }
  },
  {
    // condition runs BEFORE pending is dispatched — safe to check loading here
    condition: (_, { getState }) => {
      const { loading, lastFetched } = getState().wall;
      if (loading) return false;
      if (lastFetched && Date.now() - lastFetched < CACHE_TTL_MS) return false;
      return true;
    },
  }
);

export const fetchTrendingRumor = createAsyncThunk(
  'wall/fetchTrendingRumor',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/wall/trending-rumor');
      return data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load trending rumor');
    }
  },
  {
    condition: (_, { getState }) => {
      const { rumorLoading, rumorLastFetched } = getState().wall;
      if (rumorLoading) return false;
      if (rumorLastFetched && Date.now() - rumorLastFetched < RUMOR_CACHE_TTL_MS) return false;
      return true;
    },
  }
);

const wallSlice = createSlice({
  name: 'wall',
  initialState: {
    sites: [],
    loading: false,
    error: null,
    lastFetched: null,
    trendingRumor: null,
    rumorLoading: false,
    rumorError: null,
    rumorLastFetched: null,
  },
  reducers: {
    resetFetched: (state) => {
      state.lastFetched = null;
      state.rumorLastFetched = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWall.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWall.fulfilled, (state, action) => {
        state.loading = false;
        state.sites = action.payload;
        state.lastFetched = Date.now();
      })
      .addCase(fetchWall.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchTrendingRumor.pending, (state) => {
        state.rumorLoading = true;
        state.rumorError = null;
      })
      .addCase(fetchTrendingRumor.fulfilled, (state, action) => {
        state.rumorLoading = false;
        state.trendingRumor = action.payload;
        state.rumorLastFetched = Date.now();
      })
      .addCase(fetchTrendingRumor.rejected, (state, action) => {
        state.rumorLoading = false;
        state.rumorError = action.payload;
      })
      // Invalidate our cache whenever an article analysis finishes — server just updated SiteRecord
      .addMatcher(
        (action) => [
          'analysis/analyze/fulfilled',
          'analysis/analyzeVideo/fulfilled',
        ].includes(action.type),
        (state) => {
          state.lastFetched = null;
        }
      );
  },
});

export const { resetFetched } = wallSlice.actions;
export default wallSlice.reducer;

