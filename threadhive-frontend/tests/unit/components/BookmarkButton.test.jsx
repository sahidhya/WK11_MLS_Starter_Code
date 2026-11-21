import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../mocks/server';
import { resetBookmarkMock } from '../../mocks/handlers';
import BookmarkButton from '../../../src/components/Shared/BookmarkButton';
import bookmarkReducer from '../../../src/reducers/bookmarkSlice';

const BASE_URL = 'http://localhost:5000/api';

const renderButton = (threadId, bookmarks = {}) => {
  const store = configureStore({
    reducer: { bookmarks: bookmarkReducer },
    preloadedState: {
      bookmarks: {
        savedIds: [],
        idsStatus: 'succeeded',
        savedThreads: [],
        threadsStatus: 'idle',
        threadsError: null,
        pendingIds: [],
        removedThreads: {},
        ...bookmarks,
      },
    },
  });
  render(
    <Provider store={store}>
      <BookmarkButton threadId={threadId} />
    </Provider>,
  );
  return store;
};

const icon = (button) => button.querySelector('i');

describe('BookmarkButton', () => {
  beforeEach(() => {
    resetBookmarkMock();
  });

  it('shows the unsaved state for a thread that is not saved', () => {
    renderButton('thread-3');

    const button = screen.getByRole('button', { name: 'Save thread' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', 'Save thread');
    expect(icon(button)).toHaveClass('bi-bookmark');
    expect(icon(button)).not.toHaveClass('bi-bookmark-fill');
  });

  it('shows the saved state for a saved thread', () => {
    renderButton('thread-1', { savedIds: ['thread-1'] });

    const button = screen.getByRole('button', { name: 'Unsave thread' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(icon(button)).toHaveClass('bi-bookmark-fill');
  });

  it('switches to saved immediately and stays disabled until the server answers', async () => {
    server.use(
      http.put(`${BASE_URL}/bookmarks/:threadId`, async ({ params }) => {
        await delay(100);
        return HttpResponse.json({
          data: { threadId: params.threadId, saved: true, savedAt: new Date().toISOString() },
        });
      }),
    );
    const store = renderButton('thread-3');
    const button = screen.getByRole('button', { name: 'Save thread' });

    await userEvent.click(button);

    // Before the delayed response arrives:
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toBeDisabled();

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveAccessibleName('Unsave thread');
    expect(store.getState().bookmarks.savedIds).toContain('thread-3');
  });

  it('unsaves a saved thread when clicked', async () => {
    const store = renderButton('thread-1', { savedIds: ['thread-1'] });

    await userEvent.click(screen.getByRole('button', { name: 'Unsave thread' }));

    await waitFor(() => expect(store.getState().bookmarks.pendingIds).toEqual([]));
    expect(screen.getByRole('button', { name: 'Save thread' })).toHaveAttribute('aria-pressed', 'false');
    expect(store.getState().bookmarks.savedIds).not.toContain('thread-1');
  });

  it('reverts when saving fails', async () => {
    server.use(
      http.put(`${BASE_URL}/bookmarks/:threadId`, () =>
        HttpResponse.json({ message: 'Server error' }, { status: 500 }),
      ),
    );
    const store = renderButton('thread-3');
    const button = screen.getByRole('button', { name: 'Save thread' });

    await userEvent.click(button);

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(store.getState().bookmarks.savedIds).toEqual([]);
  });

  it('is disabled while a request for that thread is pending', () => {
    renderButton('thread-1', { pendingIds: ['thread-1'] });

    expect(screen.getByRole('button', { name: 'Save thread' })).toBeDisabled();
  });
});
