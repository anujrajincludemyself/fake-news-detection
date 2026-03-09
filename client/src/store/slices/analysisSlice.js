import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';

export const analyzeNews = createAsyncThunk(
  'analysis/analyze',
  async (newsData, { rejectWithValue }) => {
    try {
      const { data } = await api.post('/analysis', newsData);
      return data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Analysis failed'
      );
    }
  }
);

export const analyzeImage = createAsyncThunk(
  'analysis/analyzeImage',
  async ({ file, title, claim }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);
      if (claim) formData.append('claim', claim);
      const { data } = await api.post('/media/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      return data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Image analysis failed'
      );
    }
  }
);

export const analyzeVideo = createAsyncThunk(
  'analysis/analyzeVideo',
  async ({ file, title }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);
      const { data } = await api.post('/media/video', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      return data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Video analysis failed'
      );
    }
  }
);

const STATS_TTL_MS = 60 * 1000;

export const fetchHistory = createAsyncThunk(
  'analysis/fetchHistory',
  async (params = {}, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/analysis/history', { params });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch history'
      );
    }
  },
  {
    // Block duplicate in-flight calls (handles React StrictMode double-fire)
    condition: (_, { getState }) => !getState().analysis.loading,
  }
);

export const fetchStats = createAsyncThunk(
  'analysis/fetchStats',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/analysis/stats');
      return data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch stats'
      );
    }
  },
  {
    // condition runs BEFORE pending is dispatched — safe to check loading
    condition: (_, { getState }) => {
      const { statsLoading, statsLastFetched } = getState().analysis;
      if (statsLoading) return false;
      if (statsLastFetched && Date.now() - statsLastFetched < STATS_TTL_MS) return false;
      return true;
    },
  }
);

export const submitFeedback = createAsyncThunk(
  'analysis/submitFeedback',
  async ({ id, feedback }, { rejectWithValue }) => {
    try {
      const { data } = await api.put(`/analysis/${id}/feedback`, feedback);
      return data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to submit feedback'
      );
    }
  }
);

const initialState = {
  currentAnalysis: null,
  history: [],
  stats: null,
  pagination: null,
  loading: false,       // history fetch in-flight
  statsLoading: false,  // stats fetch in-flight
  statsLastFetched: null,
  analyzing: false,
  error: null,
};

const analysisSlice = createSlice({
  name: 'analysis',
  initialState,
  reducers: {
    clearCurrentAnalysis: (state) => {
      state.currentAnalysis = null;
      state.error = null;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Analyze
      .addCase(analyzeNews.pending, (state) => {
        state.analyzing = true;
        state.error = null;
        state.currentAnalysis = null;
      })
      .addCase(analyzeNews.fulfilled, (state, action) => {
        state.analyzing = false;
        state.currentAnalysis = action.payload;
        state.statsLastFetched = null; // invalidate so dashboard re-fetches on next visit
      })
      .addCase(analyzeNews.rejected, (state, action) => {
        state.analyzing = false;
        state.error = action.payload;
      })
      // Analyze Image
      .addCase(analyzeImage.pending, (state) => {
        state.analyzing = true;
        state.error = null;
        state.currentAnalysis = null;
      })
      .addCase(analyzeImage.fulfilled, (state, action) => {
        state.analyzing = false;
        state.currentAnalysis = action.payload;
        state.statsLastFetched = null;
      })
      .addCase(analyzeImage.rejected, (state, action) => {
        state.analyzing = false;
        state.error = action.payload;
      })
      // Analyze Video
      .addCase(analyzeVideo.pending, (state) => {
        state.analyzing = true;
        state.error = null;
        state.currentAnalysis = null;
      })
      .addCase(analyzeVideo.fulfilled, (state, action) => {
        state.analyzing = false;
        state.currentAnalysis = action.payload;
        state.statsLastFetched = null;
      })
      .addCase(analyzeVideo.rejected, (state, action) => {
        state.analyzing = false;
        state.error = action.payload;
      })
      // History
      .addCase(fetchHistory.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchHistory.fulfilled, (state, action) => {
        state.loading = false;
        state.history = action.payload.data;
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Stats
      .addCase(fetchStats.pending, (state) => {
        state.statsLoading = true;
      })
      .addCase(fetchStats.fulfilled, (state, action) => {
        state.statsLoading = false;
        state.stats = action.payload;
        state.statsLastFetched = Date.now();
      })
      .addCase(fetchStats.rejected, (state) => {
        state.statsLoading = false;
      })
      // Feedback
      .addCase(submitFeedback.fulfilled, (state, action) => {
        state.currentAnalysis = action.payload;
        const idx = state.history.findIndex(
          (h) => h._id === action.payload._id
        );
        if (idx !== -1) {
          state.history[idx] = action.payload;
        }
      });
  },
});

export const { clearCurrentAnalysis, clearError } = analysisSlice.actions;
export default analysisSlice.reducer;
