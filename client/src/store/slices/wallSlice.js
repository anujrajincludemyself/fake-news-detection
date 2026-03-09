import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';

const CACHE_TTL_MS = 60 * 1000;

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

const wallSlice = createSlice({
  name: 'wall',
  initialState: {
    sites: [],
    loading: false,
    error: null,
    lastFetched: null,
  },
  reducers: {
    resetFetched: (state) => {
      state.lastFetched = null;
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
      });
  },
});

export const { resetFetched } = wallSlice.actions;
export default wallSlice.reducer;

