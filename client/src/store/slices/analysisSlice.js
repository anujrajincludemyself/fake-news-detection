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
  async ({ file, title }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);
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
  loading: false,
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
      .addCase(fetchStats.fulfilled, (state, action) => {
        state.stats = action.payload;
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
