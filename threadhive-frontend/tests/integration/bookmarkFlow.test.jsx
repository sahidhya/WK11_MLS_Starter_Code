import { describe, it, expect, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { resetBookmarkMock } from '../mocks/handlers';
import bookmarkReducer, {
  fetchBookmarkIds,
  fetchSavedThreads,
  toggleBookmark,
} from '../../src/reducers/bookmarkSlice';
import threadReducer from '../../src/reducers/threadSlice';

/**
 * Integration Tests: Bookmark Operations with Redux + MSW
 * Saves and unsaves round-trip through the mocked API's in-memory store.
 */

const BASE_URL = 'http://localhost:5000/api';

const createTestStore = () =>
  configureStore({
    reducer: {
      bookmarks: bookmarkReducer,
      threads: threadReducer,
    },
  });

describe('Bookmark Flow Integration Tests (Redux + MSW)', () => {
  let store;

  beforeEach(() => {
    resetBookmarkMock();
    store = createTestStore();
  });

  it('loads saved ids into savedIds', async () => {
    const result = await store.dispatch(fetchBookmarkIds());

    expect(fetchBookmarkIds.fulfilled.match(result)).toBe(true);
    expect(store.getState().bookmarks.savedIds).toEqual(['thread-2', 'thread-1']);
  });

  it('loads saved threads in the order the server returns them', async () => {
    await store.dispatch(fetchSavedThreads());

    const { savedThreads } = store.getState().bookmarks;
    expect(savedThreads.map((t) => t._id)).toEqual(['thread-2', 'thread-1']);
    expect(savedThreads[0]).toHaveProperty('savedAt');
    expect(Object.keys(savedThreads[0].author).sort()).toEqual(['_id', 'name']);
  });

  it('saves a thread, which then appears first in the saved list', async () => {
    const result = await store.dispatch(toggleBookmark({ threadId: 'thread-3', save: true }));

    expect(toggleBookmark.fulfilled.match(result)).toBe(true);
    expect(store.getState().bookmarks.savedIds).toContain('thread-3');
    expect(store.getState().bookmarks.pendingIds).toEqual([]);

    await store.dispatch(fetchSavedThreads());
    expect(store.getState().bookmarks.savedThreads[0]._id).toBe('thread-3');
  });

  it('unsaves a thread and removes it from both savedIds and savedThreads', async () => {
    await store.dispatch(fetchBookmarkIds());
    await store.dispatch(fetchSavedThreads());

    await store.dispatch(toggleBookmark({ threadId: 'thread-2', save: false }));

    expect(store.getState().bookmarks.savedIds).toEqual(['thread-1']);
    expect(store.getState().bookmarks.savedThreads.map((t) => t._id)).toEqual(['thread-1']);

    // The server agrees after a refetch.
    await store.dispatch(fetchSavedThreads());
    expect(store.getState().bookmarks.savedThreads.map((t) => t._id)).toEqual(['thread-1']);
  });

  it('reverts a save when the server returns an error', async () => {
    server.use(
      http.put(`${BASE_URL}/bookmarks/:threadId`, () =>
        HttpResponse.json({ message: 'Server error' }, { status: 500 }),
      ),
    );

    const result = await store.dispatch(toggleBookmark({ threadId: 'thread-3', save: true }));

    expect(toggleBookmark.rejected.match(result)).toBe(true);
    expect(result.payload).toBe('Server error');
    expect(store.getState().bookmarks.savedIds).not.toContain('thread-3');
    expect(store.getState().bookmarks.pendingIds).toEqual([]);
  });
});
