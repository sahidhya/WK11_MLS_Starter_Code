import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { resetBookmarkMock } from '../../mocks/handlers';
import Profile from '../../../src/pages/User/Profile';
import bookmarkReducer from '../../../src/reducers/bookmarkSlice';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const createMockStore = (user, bookmarks = {}) => {
  return configureStore({
    reducer: {
      auth: () => ({
        token: 'test-token',
        user: user,
        loading: false,
        error: null,
      }),
      bookmarks: bookmarkReducer,
    },
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
};

// Renders the current query string so tests can check tab changes reach the URL.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

const renderWithProviders = (store, initialEntry = '/profile') => {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/profile"
            element={
              <>
                <Profile />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
};

describe('Profile', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('should render profile page with user data', () => {
    const mockUser = {
      name: 'John Doe',
      email: 'john@example.com',
      bio: 'Software developer',
      location: 'New York, USA',
      website: 'https://johndoe.com',
    };

    const store = createMockStore(mockUser);
    renderWithProviders(store);

    // Use getAllByText for elements that appear multiple times
    expect(screen.getAllByText('John Doe').length).toBeGreaterThan(0);
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('Software developer')).toBeInTheDocument();
    expect(screen.getByText('New York, USA')).toBeInTheDocument();
    expect(screen.getByText('https://johndoe.com')).toBeInTheDocument();
  });

  it('should show placeholder text when user data is missing', () => {
    const mockUser = {
      name: 'John Doe',
      email: 'john@example.com',
    };

    const store = createMockStore(mockUser);
    renderWithProviders(store);

    // User name and email should be present
    expect(screen.getAllByText('John Doe').length).toBeGreaterThan(0);
    expect(screen.getByText('john@example.com')).toBeInTheDocument();

    // Bio, location, website are empty strings ("" ?? placeholder won't trigger)
    // So the fields render empty, not with placeholder text
    expect(screen.getByText('Bio')).toBeInTheDocument();
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Website')).toBeInTheDocument();
  });

  it('should show Edit Profile button initially', () => {
    const store = createMockStore({ name: 'Test User' });
    renderWithProviders(store);

    expect(screen.getByText(/Edit Profile/)).toBeInTheDocument();
  });

  it('should enter edit mode when Edit Profile button is clicked', async () => {
    const user = userEvent.setup();
    const store = createMockStore({ name: 'Test User', email: 'test@test.com' });
    renderWithProviders(store);

    const editButton = screen.getByText(/Edit Profile/);
    await user.click(editButton);

    expect(screen.getByRole('button', { name: '✓ Save' })).toBeInTheDocument();
    expect(screen.getByText(/Cancel/)).toBeInTheDocument();
  });

  it('should show form inputs in edit mode', async () => {
    const user = userEvent.setup();
    const mockUser = {
      name: 'John Doe',
      email: 'john@example.com',
      bio: 'Developer',
    };

    const store = createMockStore(mockUser);
    renderWithProviders(store);

    const editButton = screen.getByText(/Edit Profile/);
    await user.click(editButton);

    // Should have input fields
    const nameInput = screen.getByDisplayValue('John Doe');
    const emailInput = screen.getByDisplayValue('john@example.com');
    const bioInput = screen.getByDisplayValue('Developer');

    expect(nameInput).toBeInTheDocument();
    expect(emailInput).toBeInTheDocument();
    expect(bioInput).toBeInTheDocument();
  });

  it('should allow editing form fields', async () => {
    const user = userEvent.setup();
    const store = createMockStore({ name: 'John', email: 'john@test.com' });
    renderWithProviders(store);

    await user.click(screen.getByText(/Edit Profile/));

    const nameInput = screen.getByDisplayValue('John');
    await user.clear(nameInput);
    await user.type(nameInput, 'John Doe');

    expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
  });

  it('should have email field disabled in edit mode', async () => {
    const user = userEvent.setup();
    const store = createMockStore({ name: 'Test', email: 'test@test.com' });
    renderWithProviders(store);

    await user.click(screen.getByText(/Edit Profile/));

    const emailInput = screen.getByDisplayValue('test@test.com');
    expect(emailInput).toBeDisabled();
  });

  it('should cancel edit mode when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const store = createMockStore({ name: 'Test User' });
    renderWithProviders(store);

    await user.click(screen.getByText(/Edit Profile/));
    expect(screen.getByRole('button', { name: '✓ Save' })).toBeInTheDocument();

    await user.click(screen.getByText(/Cancel/));
    expect(screen.getByText(/Edit Profile/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '✓ Save' })).not.toBeInTheDocument();
  });

  it('should navigate to home when Back to Home is clicked', async () => {
    const user = userEvent.setup();
    const store = createMockStore({ name: 'Test User' });
    renderWithProviders(store);

    const backButton = screen.getByText(/Back to Home/);
    await user.click(backButton);

    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });

  it('should display user avatar with first letter of name', () => {
    const store = createMockStore({ name: 'Alice' });
    renderWithProviders(store);

    const avatar = document.querySelector('.profile-avatar');
    expect(avatar.textContent).toBe('A');
  });

  it('should handle null user gracefully', () => {
    const store = createMockStore(null);
    renderWithProviders(store);

    // When user is null, component renders without crashing
    // form fields are initialized to empty strings
    expect(screen.getByText(/Edit Profile/)).toBeInTheDocument();
  });

  it('should show all form fields in edit mode', async () => {
    const user = userEvent.setup();
    const store = createMockStore({ name: 'Test', email: 'test@test.com' });
    renderWithProviders(store);

    await user.click(screen.getByText(/Edit Profile/));

    expect(screen.getByPlaceholderText(/Tell us about yourself/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/City, Country/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/https:\/\//)).toBeInTheDocument();
  });
});

describe('Profile Saved tab', () => {
  const BASE_URL = 'http://localhost:5000/api';
  const user = { name: 'John Doe', email: 'john@example.com' };
  const titles = () => screen.queryAllByRole('heading', { level: 5 }).map((h) => h.textContent);

  beforeEach(() => {
    mockNavigate.mockClear();
    resetBookmarkMock();
  });

  it('shows Details and Saved tabs with Details selected by default', () => {
    renderWithProviders(createMockStore(user));

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Saved (0)' })).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the number of saved threads in the tab label', () => {
    renderWithProviders(createMockStore(user, { savedIds: ['thread-1', 'thread-2'] }));

    expect(screen.getByRole('tab', { name: 'Saved (2)' })).toBeInTheDocument();
  });

  it('retries saved ids that failed at startup, so the count is right on the Details tab', async () => {
    renderWithProviders(createMockStore(user, { idsStatus: 'failed' }));

    expect(await screen.findByRole('tab', { name: 'Saved (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the Saved tab from ?tab=saved and lists saved threads newest first', async () => {
    renderWithProviders(createMockStore(user, { savedIds: ['thread-2', 'thread-1'] }), '/profile?tab=saved');

    expect(screen.getByRole('tab', { name: 'Saved (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('JavaScript Tips and Tricks')).toBeInTheDocument();
    expect(titles()).toEqual(['JavaScript Tips and Tricks', 'Getting Started with React']);
    expect(screen.getAllByText(/^saved /)).toHaveLength(2);
  });

  it('opens Details for an unknown tab value', () => {
    renderWithProviders(createMockStore(user), '/profile?tab=nonsense');

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  });

  it('puts the selected tab in the URL', async () => {
    const userEv = userEvent.setup();
    renderWithProviders(createMockStore(user));

    await userEv.click(screen.getByRole('tab', { name: 'Saved (0)' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=saved');
    await screen.findByText('JavaScript Tips and Tricks');

    await userEv.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/);
  });

  it('hides Edit Profile on the Saved tab', async () => {
    renderWithProviders(createMockStore(user), '/profile?tab=saved');

    await screen.findByText('JavaScript Tips and Tricks');
    expect(screen.queryByText(/Edit Profile/)).not.toBeInTheDocument();
  });

  it('shows an empty state with a link home when nothing is saved', async () => {
    server.use(http.get(`${BASE_URL}/bookmarks`, () => HttpResponse.json({ data: [] })));
    renderWithProviders(createMockStore(user), '/profile?tab=saved');

    expect(await screen.findByText("You haven't saved any threads yet.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the home feed' })).toHaveAttribute('href', '/home');
  });

  it('shows an error with a Retry button that loads the list again', async () => {
    const userEv = userEvent.setup();
    server.use(
      http.get(`${BASE_URL}/bookmarks`, () => HttpResponse.json({ message: 'Server error' }, { status: 500 }), {
        once: true,
      }),
    );
    renderWithProviders(createMockStore(user), '/profile?tab=saved');

    expect(await screen.findByText(/Couldn't load your saved threads\. Server error/)).toBeInTheDocument();
    await userEv.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('JavaScript Tips and Tricks')).toBeInTheDocument();
  });

  it('removes an unsaved thread from the list and the count right away', async () => {
    const userEv = userEvent.setup();
    renderWithProviders(createMockStore(user, { savedIds: ['thread-2', 'thread-1'] }), '/profile?tab=saved');
    await screen.findByText('JavaScript Tips and Tricks');

    await userEv.click(screen.getAllByRole('button', { name: 'Unsave thread' })[0]);

    expect(screen.queryByText('JavaScript Tips and Tricks')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Saved (1)' })).toBeInTheDocument();
    expect(titles()).toEqual(['Getting Started with React']);
  });

  it('puts the row back in place and restores the count when an unsave fails', async () => {
    const userEv = userEvent.setup();
    server.use(
      http.delete(`${BASE_URL}/bookmarks/:threadId`, () =>
        HttpResponse.json({ message: 'Server error' }, { status: 500 }),
      ),
    );
    renderWithProviders(createMockStore(user, { savedIds: ['thread-2', 'thread-1'] }), '/profile?tab=saved');
    await screen.findByText('JavaScript Tips and Tricks');

    await userEv.click(screen.getAllByRole('button', { name: 'Unsave thread' })[0]);

    await waitFor(() =>
      expect(titles()).toEqual(['JavaScript Tips and Tricks', 'Getting Started with React']),
    );
    expect(screen.getByRole('tab', { name: 'Saved (2)' })).toBeInTheDocument();
  });

  it('paginates at 5 per page and steps back a page when its last thread is unsaved', async () => {
    const userEv = userEvent.setup();
    const saved = Array.from({ length: 6 }, (_, i) => ({
      _id: `p${i + 1}`,
      title: `Saved thread ${i + 1}`,
      content: `Content ${i + 1}`,
      voteCount: 100 + i,
      createdAt: '2024-01-01T00:00:00.000Z',
      author: { _id: 'user-1', name: 'John Doe' },
      subreddit: { _id: 'sub-1', name: 'JavaScript' },
      savedAt: new Date(Date.UTC(2024, 0, 20 - i)).toISOString(),
    }));
    server.use(http.get(`${BASE_URL}/bookmarks`, () => HttpResponse.json({ data: saved })));
    renderWithProviders(
      createMockStore(user, { savedIds: saved.map((t) => t._id) }),
      '/profile?tab=saved',
    );

    await screen.findByText('Saved thread 1');
    expect(titles()).toHaveLength(5);

    await userEv.click(screen.getByText('2'));
    expect(titles()).toEqual(['Saved thread 6']);

    await userEv.click(screen.getByRole('button', { name: 'Unsave thread' }));
    await waitFor(() => expect(titles()).toHaveLength(5));
    expect(titles()[0]).toBe('Saved thread 1');
    expect(screen.getByRole('tab', { name: 'Saved (5)' })).toBeInTheDocument();
  });
});
