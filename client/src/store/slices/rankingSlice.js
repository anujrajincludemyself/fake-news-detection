import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';

const CACHE_TTL_MS = 60 * 1000;

// ── Thunks ─────────────────────────────────────────────────────────────────

export const fetchRankings = createAsyncThunk(
  'ranking/fetchRankings',
  async ({ page = 1, limit = 20, sort = 'fakeScore_desc', minScans = 1 } = {}, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/ranking', { params: { page, limit, sort, minScans } });
      return { sites: data.data, pagination: data.pagination, page };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load rankings');
    }
  }
);

export const fetchRankingStats = createAsyncThunk(
  'ranking/fetchStats',
  async (_, { rejectWithValue, getState }) => {
    const { statsLastFetched } = getState().ranking;
    if (statsLastFetched && Date.now() - statsLastFetched < CACHE_TTL_MS) return null;
    try {
      const { data } = await api.get('/ranking/stats');
      return data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load stats');
    }
  }
);

export const fetchTopFake = createAsyncThunk(
  'ranking/fetchTopFake',
  async ({ limit = 5 } = {}, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/ranking/top-fake', { params: { limit, minScans: 1 } });
      return data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load top fake sites');
    }
  }
);

export const fetchMostReliable = createAsyncThunk(
  'ranking/fetchMostReliable',
  async ({ limit = 5 } = {}, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/ranking/most-reliable', { params: { limit, minScans: 1 } });
      return data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load reliable sites');
    }
  }
);

// ── Slice ──────────────────────────────────────────────────────────────────

const rankingSlice = createSlice({
  name: 'ranking',
  initialState: {
    sites: [],
    pagination: { total: 0, page: 1, limit: 20, pages: 1 },
    stats: null,
    topFake: [],
    mostReliable: [],

    loading: false,
    statsLoading: false,
    topFakeLoading: false,
    reliableLoading: false,

    error: null,
    statsLastFetched: null,

    // current filter/sort state (kept in store so page remounts restore it)
    currentSort: 'fakeScore_desc',
    currentMinScans: 1,
  },
  reducers: {
    setSort: (state, action) => { state.currentSort = action.payload; },
    setMinScans: (state, action) => { state.currentMinScans = action.payload; },
    clearError: (state) => { state.error = null; },
  },
  extraReducers: (builder) => {
    // fetchRankings
    builder
      .addCase(fetchRankings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchRankings.fulfilled, (state, action) => {
        state.loading = false;
        state.sites = action.payload.sites;
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchRankings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // fetchRankingStats
    builder
      .addCase(fetchRankingStats.pending, (state) => { state.statsLoading = true; })
      .addCase(fetchRankingStats.fulfilled, (state, action) => {
        state.statsLoading = false;
        if (action.payload) {
          state.stats = action.payload;
          state.statsLastFetched = Date.now();
        }
      })
      .addCase(fetchRankingStats.rejected, (state) => { state.statsLoading = false; });

    // fetchTopFake
    builder
      .addCase(fetchTopFake.pending, (state) => { state.topFakeLoading = true; })
      .addCase(fetchTopFake.fulfilled, (state, action) => {
        state.topFakeLoading = false;
        state.topFake = action.payload;
      })
      .addCase(fetchTopFake.rejected, (state) => { state.topFakeLoading = false; });

    // fetchMostReliable
    builder
      .addCase(fetchMostReliable.pending, (state) => { state.reliableLoading = true; })
      .addCase(fetchMostReliable.fulfilled, (state, action) => {
        state.reliableLoading = false;
        state.mostReliable = action.payload;
      })
      .addCase(fetchMostReliable.rejected, (state) => { state.reliableLoading = false; });
  },
});

export const { setSort, setMinScans, clearError } = rankingSlice.actions;
export default rankingSlice.reducer;
