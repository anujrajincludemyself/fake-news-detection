import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';

const CACHE_TTL_MS = 60 * 1000;

export const fetchNetwork = createAsyncThunk(
  'network/fetch',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/network');
      return data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load network data');
    }
  },
  {
    condition: (_, { getState }) => {
      const { loading, lastFetched } = getState().network;
      if (loading) return false;
      if (lastFetched && Date.now() - lastFetched < CACHE_TTL_MS) return false;
      return true;
    },
  }
);

const networkSlice = createSlice({
  name: 'network',
  initialState: {
    nodes: [],
    edges: [],
    clusters: [],
    timeline: [],
    stats: null,
    loading: false,
    error: null,
    lastFetched: null,
  },
  reducers: {
    resetNetworkCache: (state) => {
      state.lastFetched = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNetwork.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchNetwork.fulfilled, (state, action) => {
        state.loading = false;
        state.nodes = action.payload.nodes;
        state.edges = action.payload.edges;
        state.clusters = action.payload.clusters;
        state.timeline = action.payload.timeline;
        state.stats = action.payload.stats;
        state.lastFetched = Date.now();
      })
      .addCase(fetchNetwork.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
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

export const { resetNetworkCache } = networkSlice.actions;
export default networkSlice.reducer;
