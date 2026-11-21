import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  fetchBookmarks as fetchBookmarksAPI,
  fetchBookmarkIds as fetchBookmarkIdsAPI,
  saveBookmark as saveBookmarkAPI,
  unsaveBookmark as unsaveBookmarkAPI,
} from '../services/bookmarkService';
import { upvoteThreadThunk, downvoteThreadThunk } from './threadSlice';
import { handleApiError } from '../utils/handleApiError';

const initialState = {
  savedIds: [],         // ids of saved threads; drives every toggle and the tab count
  idsStatus: 'idle',    // 'idle' | 'loading' | 'succeeded' | 'failed'
  savedThreads: [],     // full thread objects for the Profile Saved tab
  threadsStatus: 'idle',
  threadsError: null,
  pendingIds: [],       // threads with a save/unsave request in flight
  removedThreads: {},   // threadId -> { thread, index } stashed by an optimistic unsave
};

// Selectors. Fall back to the initial state so components still render in a
// store that doesn't register this slice (e.g. narrowly scoped test stores).
const selectBookmarkState = (state) => state.bookmarks ?? initialState;
export const selectSavedIds = (state) => selectBookmarkState(state).savedIds;
export const selectSavedCount = (state) => selectBookmarkState(state).savedIds.length;
export const selectIdsStatus = (state) => selectBookmarkState(state).idsStatus;
export const selectIsSaved = (state, threadId) =>
  selectBookmarkState(state).savedIds.includes(threadId);
export const selectIsPending = (state, threadId) =>
  selectBookmarkState(state).pendingIds.includes(threadId);
export const selectSavedThreads = (state) => selectBookmarkState(state).savedThreads;
export const selectThreadsStatus = (state) => selectBookmarkState(state).threadsStatus;
export const selectThreadsError = (state) => selectBookmarkState(state).threadsError;

// A fetch that resolves after the session changed (logout, or another user
// logging in mid-flight) is rejected with this marker and ignored by the
// reducers, so one user's response never lands in the next user's state.
const STALE = { stale: true };
const isStale = (action) => action.payload?.stale === true;

const sessionGuardedFetch = (apiCall) => async (_, { getState, rejectWithValue }) => {
  const token = getState().auth?.token;
  const sessionChanged = () => getState().auth?.token !== token;
  try {
    const data = await apiCall();
    return sessionChanged() ? rejectWithValue(STALE) : data;
  } catch (err) {
    return sessionChanged() ? rejectWithValue(STALE) : rejectWithValue(handleApiError(err));
  }
};

// Async thunks
export const fetchBookmarkIds = createAsyncThunk(
  'bookmarks/fetchIds',
  sessionGuardedFetch(fetchBookmarkIdsAPI)
);

export const fetchSavedThreads = createAsyncThunk(
  'bookmarks/fetchSavedThreads',
  sessionGuardedFetch(fetchBookmarksAPI)
);

export const toggleBookmark = createAsyncThunk(
  'bookmarks/toggle',
  async ({ threadId, save }, { rejectWithValue }) => {
    try {
      return save ? await saveBookmarkAPI(threadId) : await unsaveBookmarkAPI(threadId);
    } catch (err) {
      return rejectWithValue(handleApiError(err));
    }
  },
  {
    // Ignore a second toggle while one is already in flight for this thread.
    condition: ({ threadId }, { getState }) => !selectIsPending(getState(), threadId),
  }
);

// Retry the saved ids if the startup fetch failed. Profile calls this once on
// mount (not on every idsStatus change, which would retry in a loop while the
// server stays down).
export const retryFailedBookmarkIds = () => (dispatch, getState) => {
  if (selectIdsStatus(getState()) === 'failed') {
    return dispatch(fetchBookmarkIds());
  }
  return Promise.resolve();
};

const without = (list, id) => list.filter((item) => item !== id);

const syncVoteCounts = (state, action) => {
  const updated = action.payload;
  const thread = state.savedThreads.find((t) => t._id === updated?._id);
  if (!thread) return;
  ['voteCount', 'upvotes', 'downvotes'].forEach((key) => {
    if (updated[key] !== undefined) thread[key] = updated[key];
  });
};

const bookmarkSlice = createSlice({
  name: 'bookmarks',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // fetchBookmarkIds
      .addCase(fetchBookmarkIds.pending, (state) => {
        state.idsStatus = 'loading';
      })
      .addCase(fetchBookmarkIds.fulfilled, (state, action) => {
        state.idsStatus = 'succeeded';
        // Merge rather than replace: a toggle still in flight keeps its
        // optimistic value, so a slow response can't undo it.
        const pending = new Set(state.pendingIds);
        const merged = action.payload.filter((id) => !pending.has(id));
        state.pendingIds.forEach((id) => {
          if (state.savedIds.includes(id)) merged.push(id);
        });
        state.savedIds = merged;
      })
      .addCase(fetchBookmarkIds.rejected, (state, action) => {
        if (isStale(action)) return;
        state.idsStatus = 'failed';
      })

      // fetchSavedThreads
      .addCase(fetchSavedThreads.pending, (state) => {
        state.threadsStatus = 'loading';
        state.threadsError = null;
      })
      .addCase(fetchSavedThreads.fulfilled, (state, action) => {
        state.threadsStatus = 'succeeded';
        state.savedThreads = action.payload;
      })
      .addCase(fetchSavedThreads.rejected, (state, action) => {
        if (isStale(action)) return;
        state.threadsStatus = 'failed';
        state.threadsError = action.payload ?? action.error.message;
      })

      // toggleBookmark: optimistic. The UI changes on pending; a failure undoes it.
      .addCase(toggleBookmark.pending, (state, action) => {
        const { threadId, save } = action.meta.arg;
        state.pendingIds.push(threadId);
        if (save) {
          if (!state.savedIds.includes(threadId)) state.savedIds.push(threadId);
          return;
        }
        state.savedIds = without(state.savedIds, threadId);
        const index = state.savedThreads.findIndex((t) => t._id === threadId);
        if (index !== -1) {
          // Stash the row so a failed unsave can put it back where it was.
          state.removedThreads[threadId] = { thread: state.savedThreads[index], index };
          state.savedThreads.splice(index, 1);
        }
      })
      .addCase(toggleBookmark.fulfilled, (state, action) => {
        const { threadId } = action.meta.arg;
        state.pendingIds = without(state.pendingIds, threadId);
        delete state.removedThreads[threadId];
      })
      .addCase(toggleBookmark.rejected, (state, action) => {
        const { threadId, save } = action.meta.arg;
        state.pendingIds = without(state.pendingIds, threadId);
        if (save) {
          state.savedIds = without(state.savedIds, threadId);
          return;
        }
        if (!state.savedIds.includes(threadId)) state.savedIds.push(threadId);
        const stashed = state.removedThreads[threadId];
        if (stashed) {
          // Re-insert at the old position (clamped) so the tab count and the
          // visible rows stay in sync.
          const index = Math.min(stashed.index, state.savedThreads.length);
          state.savedThreads.splice(index, 0, stashed.thread);
          delete state.removedThreads[threadId];
        }
      })

      // Keep vote counts current in the Saved list.
      .addCase(upvoteThreadThunk.fulfilled, syncVoteCounts)
      .addCase(downvoteThreadThunk.fulfilled, syncVoteCounts)

      // authSlice doesn't export its plain logout action, so match on its type.
      .addCase('auth/logout', () => initialState);
  },
});

export default bookmarkSlice.reducer;
