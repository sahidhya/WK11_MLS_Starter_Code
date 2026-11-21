import { describe, it, expect, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../mocks/server';
import { resetBookmarkMock } from '../../mocks/handlers';
import bookmarkReducer, {
  fetchBookmarkIds,
  fetchSavedThreads,
  toggleBookmark,
  retryFailedBookmarkIds,
  selectIsSaved,
  selectIsPending,
  selectSavedCount,
} from '../../../src/reducers/bookmarkSlice';
import authReducer, { logout } from '../../../src/reducers/authSlice';
import { upvoteThreadThunk, downvoteThreadThunk } from '../../../src/reducers/threadSlice';

const BASE_URL = 'http://localhost:5000/api';

const initialState = () => ({
  savedIds: [],
  idsStatus: 'idle',
  savedThreads: [],
  threadsStatus: 'idle',
  threadsError: null,
  pendingIds: [],
  removedThreads: {},
});
const stateWith = (overrides = {}) => ({ ...initialState(), ...overrides });

const toggleAction = (status, arg) => ({
  type: toggleBookmark[status].type,
  meta: { arg, requestId: 'req-1' },
});

const makeStore = (bookmarks = {}, auth = {}) =>
  configureStore({
    reducer: { auth: authReducer, bookmarks: bookmarkReducer },
    preloadedState: {
      auth: { token: null, user: null, loading: false, error: null, registrationSuccess: false, ...auth },
      bookmarks: stateWith(bookmarks),
    },
  });

describe('bookmarkSlice', () => {
  beforeEach(() => {
    resetBookmarkMock();
  });

  it('has the expected initial state', () => {
    expect(bookmarkReducer(undefined, { type: '@@INIT' })).toEqual(initialState());
  });

  describe('toggleBookmark (optimistic updates)', () => {
    it('marks a thread saved and pending as soon as a save starts', () => {
      const next = bookmarkReducer(initialState(), toggleAction('pending', { threadId: 't1', save: true }));

      expect(next.savedIds).toEqual(['t1']);
      expect(next.pendingIds).toEqual(['t1']);
    });

    it('does not duplicate an id that is already saved', () => {
      const next = bookmarkReducer(
        stateWith({ savedIds: ['t1'] }),
        toggleAction('pending', { threadId: 't1', save: true }),
      );

      expect(next.savedIds).toEqual(['t1']);
    });

    it('removes a thread from savedIds and savedThreads as soon as an unsave starts, stashing the row', () => {
      const next = bookmarkReducer(
        stateWith({ savedIds: ['t1', 't2'], savedThreads: [{ _id: 't1' }, { _id: 't2' }] }),
        toggleAction('pending', { threadId: 't1', save: false }),
      );

      expect(next.savedIds).toEqual(['t2']);
      expect(next.savedThreads).toEqual([{ _id: 't2' }]);
      expect(next.pendingIds).toEqual(['t1']);
      expect(next.removedThreads).toEqual({ t1: { thread: { _id: 't1' }, index: 0 } });
    });

    it('clears the pending flag and the stash on success', () => {
      const next = bookmarkReducer(
        stateWith({ pendingIds: ['t1'], removedThreads: { t1: { thread: { _id: 't1' }, index: 0 } } }),
        toggleAction('fulfilled', { threadId: 't1', save: false }),
      );

      expect(next.pendingIds).toEqual([]);
      expect(next.removedThreads).toEqual({});
    });

    it('undoes a failed save', () => {
      const next = bookmarkReducer(
        stateWith({ savedIds: ['t1'], pendingIds: ['t1'] }),
        toggleAction('rejected', { threadId: 't1', save: true }),
      );

      expect(next.savedIds).toEqual([]);
      expect(next.pendingIds).toEqual([]);
    });

    it('puts a failed unsave back into savedThreads at its old position', () => {
      let state = stateWith({
        savedIds: ['t1', 't2', 't3'],
        savedThreads: [{ _id: 't1' }, { _id: 't2' }, { _id: 't3' }],
      });
      state = bookmarkReducer(state, toggleAction('pending', { threadId: 't2', save: false }));
      state = bookmarkReducer(state, toggleAction('rejected', { threadId: 't2', save: false }));

      expect(state.savedThreads.map((t) => t._id)).toEqual(['t1', 't2', 't3']);
      expect(state.savedIds).toContain('t2');
      expect(state.pendingIds).toEqual([]);
      expect(state.removedThreads).toEqual({});
    });

    it('clamps the restore position when the list got shorter meanwhile', () => {
      const next = bookmarkReducer(
        stateWith({
          savedThreads: [{ _id: 't1' }],
          pendingIds: ['t9'],
          removedThreads: { t9: { thread: { _id: 't9' }, index: 5 } },
        }),
        toggleAction('rejected', { threadId: 't9', save: false }),
      );

      expect(next.savedThreads.map((t) => t._id)).toEqual(['t1', 't9']);
    });

    it('restores only savedIds when the failed unsave came from a card not in the Saved list', () => {
      const next = bookmarkReducer(
        stateWith({ savedThreads: [{ _id: 't1' }], pendingIds: ['t7'] }),
        toggleAction('rejected', { threadId: 't7', save: false }),
      );

      expect(next.savedIds).toEqual(['t7']);
      expect(next.savedThreads).toEqual([{ _id: 't1' }]);
    });

    it('ignores a second toggle while one is in flight for the same thread', async () => {
      const store = makeStore();

      const first = store.dispatch(toggleBookmark({ threadId: 'thread-3', save: true }));
      const second = await store.dispatch(toggleBookmark({ threadId: 'thread-3', save: false }));
      await first;

      expect(second.meta.condition).toBe(true);
      expect(store.getState().bookmarks.savedIds).toContain('thread-3');
      expect(store.getState().bookmarks.pendingIds).toEqual([]);
    });
  });

  describe('fetchBookmarkIds', () => {
    it('loads saved ids', async () => {
      const store = makeStore();

      await store.dispatch(fetchBookmarkIds());

      expect(store.getState().bookmarks.idsStatus).toBe('succeeded');
      expect(store.getState().bookmarks.savedIds).toEqual(['thread-2', 'thread-1']);
    });

    it('keeps the optimistic value of a save that is still in flight', () => {
      const next = bookmarkReducer(
        stateWith({ savedIds: ['t9'], pendingIds: ['t9'] }),
        { type: fetchBookmarkIds.fulfilled.type, payload: ['t1'] },
      );

      expect(next.savedIds).toEqual(['t1', 't9']);
    });

    it('keeps the optimistic value of an unsave that is still in flight', () => {
      const next = bookmarkReducer(
        stateWith({ savedIds: [], pendingIds: ['t1'] }),
        { type: fetchBookmarkIds.fulfilled.type, payload: ['t1', 't2'] },
      );

      expect(next.savedIds).toEqual(['t2']);
    });

    it('marks ids as failed when loading fails', async () => {
      server.use(
        http.get(`${BASE_URL}/bookmarks/ids`, () =>
          HttpResponse.json({ message: 'Server error' }, { status: 500 }),
        ),
      );
      const store = makeStore();

      await store.dispatch(fetchBookmarkIds());

      expect(store.getState().bookmarks.idsStatus).toBe('failed');
    });

    it('ignores a response that arrives after the user logged out', async () => {
      server.use(
        http.get(`${BASE_URL}/bookmarks/ids`, async () => {
          await delay(50);
          return HttpResponse.json({ data: ['thread-1'] });
        }),
      );
      const store = makeStore({}, { token: 'token-a' });

      const request = store.dispatch(fetchBookmarkIds());
      store.dispatch(logout());
      const result = await request;

      expect(result.payload).toEqual({ stale: true });
      expect(store.getState().bookmarks).toEqual(initialState());
    });
  });

  describe('fetchSavedThreads', () => {
    it('loads saved threads', async () => {
      const store = makeStore();

      await store.dispatch(fetchSavedThreads());

      const { threadsStatus, savedThreads, threadsError } = store.getState().bookmarks;
      expect(threadsStatus).toBe('succeeded');
      expect(savedThreads.map((t) => t._id)).toEqual(['thread-2', 'thread-1']);
      expect(threadsError).toBeNull();
    });

    it('records the error message when loading fails', async () => {
      server.use(
        http.get(`${BASE_URL}/bookmarks`, () =>
          HttpResponse.json({ message: 'Server error' }, { status: 500 }),
        ),
      );
      const store = makeStore();

      await store.dispatch(fetchSavedThreads());

      expect(store.getState().bookmarks.threadsStatus).toBe('failed');
      expect(store.getState().bookmarks.threadsError).toBe('Server error');
    });

    it('ignores a failure that arrives after the user logged out', async () => {
      server.use(
        http.get(`${BASE_URL}/bookmarks`, async () => {
          await delay(50);
          return HttpResponse.json({ message: 'Server error' }, { status: 500 });
        }),
      );
      const store = makeStore({}, { token: 'token-a' });

      const request = store.dispatch(fetchSavedThreads());
      store.dispatch(logout());
      const result = await request;

      expect(result.payload).toEqual({ stale: true });
      expect(store.getState().bookmarks.threadsError).toBeNull();
      expect(store.getState().bookmarks.threadsStatus).toBe('idle');
    });
  });

  describe('retryFailedBookmarkIds', () => {
    it('refetches ids that failed at startup', async () => {
      const store = makeStore({ idsStatus: 'failed' });

      await store.dispatch(retryFailedBookmarkIds());

      expect(store.getState().bookmarks.idsStatus).toBe('succeeded');
      expect(store.getState().bookmarks.savedIds).toEqual(['thread-2', 'thread-1']);
    });

    it('does nothing when the ids already loaded', async () => {
      const store = makeStore({ idsStatus: 'succeeded', savedIds: ['only-this'] });

      await store.dispatch(retryFailedBookmarkIds());

      expect(store.getState().bookmarks.savedIds).toEqual(['only-this']);
    });
  });

  describe('vote sync', () => {
    const withSavedThread = () =>
      stateWith({ savedThreads: [{ _id: 't1', title: 'Saved', voteCount: 1, upvotes: 1, downvotes: 0 }] });

    it('updates vote counts of a saved thread after an upvote', () => {
      const next = bookmarkReducer(withSavedThread(), {
        type: upvoteThreadThunk.fulfilled.type,
        payload: { _id: 't1', voteCount: 2, upvotes: 2, downvotes: 0 },
      });

      expect(next.savedThreads[0]).toMatchObject({ title: 'Saved', voteCount: 2, upvotes: 2 });
    });

    it('updates vote counts after a downvote and leaves missing fields alone', () => {
      const next = bookmarkReducer(withSavedThread(), {
        type: downvoteThreadThunk.fulfilled.type,
        payload: { _id: 't1', voteCount: 0 },
      });

      expect(next.savedThreads[0]).toMatchObject({ voteCount: 0, upvotes: 1, downvotes: 0 });
    });

    it('ignores votes on threads that are not in the saved list', () => {
      const before = withSavedThread();
      const next = bookmarkReducer(before, {
        type: upvoteThreadThunk.fulfilled.type,
        payload: { _id: 'other', voteCount: 9 },
      });

      expect(next.savedThreads).toEqual(before.savedThreads);
    });
  });

  it('resets when the real logout thunk runs', () => {
    const store = makeStore({
      savedIds: ['t1'],
      idsStatus: 'succeeded',
      savedThreads: [{ _id: 't1' }],
      threadsStatus: 'succeeded',
    });

    // Dispatching authSlice's own logout (not a hand-written action) means a
    // rename of its action type would fail this test.
    store.dispatch(logout());

    expect(store.getState().bookmarks).toEqual(initialState());
  });

  describe('selectors', () => {
    it('read saved, pending and count state', () => {
      const state = { bookmarks: stateWith({ savedIds: ['t1', 't2'], pendingIds: ['t2'] }) };

      expect(selectIsSaved(state, 't1')).toBe(true);
      expect(selectIsSaved(state, 't3')).toBe(false);
      expect(selectIsPending(state, 't2')).toBe(true);
      expect(selectSavedCount(state)).toBe(2);
    });

    it('fall back to empty state when the slice is not registered', () => {
      expect(selectIsSaved({}, 't1')).toBe(false);
      expect(selectIsPending({}, 't1')).toBe(false);
      expect(selectSavedCount({})).toBe(0);
    });
  });
});
