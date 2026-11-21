# Spec 001 — Bookmarks (saved threads)

**Status:** draft · **Drafted:** 2026-11-21 · **Epic:** [Discover & Engage, F3](../docs/epic-discover-engage.md#f3--saved-threads)

**Decisions made while drafting:**
- The Save toggle appears on **feed cards and the thread page**.
- Saved threads appear in a **Saved tab on Profile**.
- This differs from the epic draft: there is no `/saved` route and no Sidebar link.

---

## 1. Problem / motivation

ThreadHive has no way to keep a thread for later. The feed is newest-first with five threads per page, so a thread a user meant to come back to drifts out of reach within a few visits. The only workaround is remembering the title or the URL.

Bookmarks give users a private, persistent list of threads they care about, and that list is a concrete reason to return to the app.

**What exists today that this builds on:**
- Thread cards in the feed (`ThreadList.jsx`) and the single-thread view (`ThreadCard.jsx`).
- A Profile page (`/profile`) that currently shows only locally stored details.
- JWT auth on every API route (`authHandler`), which supplies `req.user.userId`.

---

## 2. User stories

1. As a logged-in user, I can **save a thread from the feed** with one click, without opening it.
2. As a logged-in user, I can **save or unsave a thread from its thread page**.
3. As a logged-in user, I can **see at a glance whether a thread is already saved**, wherever its card appears.
4. As a logged-in user, I can open the **Saved tab on my Profile** and see the threads I saved, newest first, with when I saved each one.
5. As a logged-in user, I can **unsave a thread directly from the Saved tab**.
6. As a logged-in user, **my saved threads are private**: no other user can see or change them.
7. As a logged-in user, I can **share or bookmark a link to my Saved tab** (`/profile?tab=saved`).

---

## 3. Acceptance criteria

Each criterion is written to map to at least one automated test (see [§9](#9-test-plan)).

### Saving and unsaving

| ID | Criterion |
|---|---|
| AC-1 | Every thread card in the Home and subreddit feed (`ThreadList`) and the thread page (`ThreadCard`) shows a bookmark toggle. |
| AC-2 | For a thread the user hasn't saved, the toggle shows the outline icon (`bi-bookmark`), has `aria-pressed="false"` and the accessible name "Save thread". |
| AC-3 | Clicking the toggle on an unsaved thread switches it **immediately** (before the server responds) to the filled icon (`bi-bookmark-fill`), `aria-pressed="true"` and the accessible name "Unsave thread". It also sends `PUT /api/bookmarks/:threadId`. |
| AC-4 | Clicking the toggle on a saved thread switches it immediately back to the unsaved state and sends `DELETE /api/bookmarks/:threadId`. |
| AC-5 | While a save or unsave request for a thread is in flight, that thread's toggle is `disabled` everywhere it appears. |
| AC-6 | If the request fails, the toggle reverts to its previous state and the error goes through `handleApiError`. A 401 response triggers the existing redirect to `/login`. |
| AC-7 | Saved state is shared: saving a thread on its thread page and then going back to the feed shows that thread's toggle filled, without a reload. |
| AC-8 | Saved state persists: after a full page reload, threads saved earlier still show the filled icon. |

### Profile → Saved tab

| ID | Criterion |
|---|---|
| AC-9 | `/profile` shows two tabs, **Details** and **Saved**. Details is selected by default. |
| AC-10 | Opening `/profile?tab=saved` selects the Saved tab directly. Switching tabs updates the `tab` query parameter without a full navigation. |
| AC-11 | The Saved tab label shows the number of saved threads, for example "Saved (12)". The count changes when the user saves or unsaves anywhere in the app. |
| AC-12 | The **Edit Profile** button is shown only while the Details tab is active. All existing Details behaviour (view mode, edit mode, Save, Cancel) is unchanged. |
| AC-13 | Each time the Saved tab is activated, it fetches `GET /api/bookmarks` and shows a spinner while loading. |
| AC-14 | The Saved tab lists saved threads **newest-saved first**. Each item shows the title, `r/<subreddit>`, vote count, "saved <relative time>" (for example "saved 2h ago"), a bookmark toggle in the saved state, and a link to `/thread/:id`. |
| AC-15 | With more than 5 saved threads, the list is paginated at 5 per page with the existing `PaginationComponent`. |
| AC-16 | Unsaving from the Saved tab removes that item from the list immediately and decrements the tab count. If that empties the current page, the view moves to the previous page. |
| AC-17 | With no saved threads, the tab shows "You haven't saved any threads yet." and a link to `/home`. |
| AC-18 | If loading fails, the tab shows an error alert with a **Retry** button that fetches again. |
| AC-19 | Voting on a thread in the Saved tab updates its displayed vote count. |

### Data integrity and privacy

| ID | Criterion |
|---|---|
| AC-20 | A thread that was saved and then deleted appears neither in `GET /api/bookmarks` nor in `GET /api/bookmarks/ids`, and isn't counted in the tab label. |
| AC-21 | `GET /api/bookmarks` and `GET /api/bookmarks/ids` return only the requesting user's bookmarks. |
| AC-22 | Saving the same thread twice, sequentially or concurrently, leaves exactly **one** bookmark document, and both requests return 200. |
| AC-23 | No bookmark response contains any user's `password` or `email`. |
| AC-24 | All four bookmark endpoints return 401 without a valid token. |
| AC-25 | After logout, all bookmark state is cleared. Logging in as a different user shows only that user's saved state. |

---

## 4. API contract

**For all four endpoints:**
- **Auth:** `Authorization: Bearer <jwt>`, enforced by `authHandler`. A missing token returns 401 "No token provided, authorization denied."; an invalid token returns 401 "Token is not valid.".
- **Envelope:** `{ success, message, data }`.
- **Errors:** thrown with `createAppError(message, status)` and serialized by `errorHandler` as `{ success: false, message }`.
- **Routing:** new router `src/routes/bookmarks.js`, mounted in `src/app.js` at `/api/bookmarks`. `/ids` is declared **before** `/:threadId`.

### Thread object returned by this feature

This shape is used by `GET /api/bookmarks`. It deliberately exposes only the fields the UI needs.

| Field | Type | Notes |
|---|---|---|
| `_id` | string | Thread id |
| `title` | string | |
| `content` | string | |
| `voteCount` | number | |
| `upvotes` | number | |
| `downvotes` | number | |
| `createdAt` | ISO string | Thread creation time |
| `author` | `{ _id, name }` | **Never** includes `email` or `password` |
| `subreddit` | `{ _id, name }` | |
| `savedAt` | ISO string | The bookmark's `createdAt` |

`upvotedBy` and `downvotedBy` are **not** included.

### `GET /api/bookmarks`

Lists the caller's saved threads.

| | |
|---|---|
| Request | No parameters |
| 200 | `message: "Bookmarks fetched successfully"`, `data`: an array of the thread objects above, sorted by `savedAt` descending. `[]` if there are none. |
| 401 | Missing or invalid token |

**Behaviour:** bookmarks whose thread no longer exists are left out of the response and **deleted** in the same request (lazy cleanup).

### `GET /api/bookmarks/ids`

Returns the ids of every thread the caller has saved. The frontend loads this once per session to show saved state on cards.

| | |
|---|---|
| Request | No parameters |
| 200 | `message: "Bookmark ids fetched successfully"`, `data: string[]` (thread ids, unordered). Excludes threads that no longer exist. |
| 401 | Missing or invalid token |

### `PUT /api/bookmarks/:threadId`

Saves a thread. Idempotent.

| | |
|---|---|
| Params | `threadId`: a thread ObjectId |
| Body | None |
| 200 | `message: "Thread saved"`, `data: { threadId, saved: true, savedAt }`. Repeat calls return the **original** `savedAt`. |
| 400 | `"Invalid thread id"`: `threadId` isn't a valid ObjectId |
| 404 | `"Thread not found"` |
| 401 | Missing or invalid token |

**Behaviour:** if a concurrent save trips the unique index (MongoDB duplicate-key error `11000`), the request is treated as a success and returns the existing bookmark.

### `DELETE /api/bookmarks/:threadId`

Unsaves a thread. Idempotent.

| | |
|---|---|
| Params | `threadId`: a thread ObjectId |
| 200 | `message: "Thread unsaved"`, `data: { threadId, saved: false }`. Also returned when no bookmark existed. |
| 400 | `"Invalid thread id"` |
| 401 | Missing or invalid token |

**Behaviour:** the thread doesn't need to exist, so a user can remove a bookmark whose thread was deleted.

### Why `PUT` / `DELETE` rather than a `POST` toggle

The client always knows the state it wants. Idempotent verbs mean retries and double-clicks can't flip the state the wrong way.

### Backend layering

| Layer | File | Responsibilities |
|---|---|---|
| Model | `src/models/Bookmark.js` (new) | Schema and indexes, see [§5](#5-data-model-changes) |
| Service | `src/services/bookmarkService.js` (new) | `listBookmarks(userId)`, `listBookmarkedThreadIds(userId)`, `saveBookmark(userId, threadId)`, `removeBookmark(userId, threadId)`. ObjectId validation (`mongoose.isValidObjectId`, then 400), thread existence check, duplicate-key handling, orphan filtering and cleanup, author/subreddit field selection. |
| Controller | `src/controllers/bookmarkController.js` (new) | Reads `req.user.userId` and `req.params.threadId`, calls the service, sends the envelope. No business logic. |
| Route | `src/routes/bookmarks.js` (new) | Four routes, each with `authHandler` |
| App | `src/app.js` (edit) | `app.use("/api/bookmarks", bookmarkRoutes)` |

---

## 5. Data model changes

### New collection: `Bookmark` (`src/models/Bookmark.js`)

| Field | Mongoose type | `ref` | Required | Default | Notes |
|---|---|---|---|---|---|
| `user` | `Schema.Types.ObjectId` | `"User"` | yes | – | Owner. Always taken from `req.user.userId`, never from the request. |
| `thread` | `Schema.Types.ObjectId` | `"Thread"` | yes | – | The saved thread |
| `createdAt` | Date | – | – | auto | From `{ timestamps: true }`; exposed as `savedAt` |
| `updatedAt` | Date | – | – | auto | From `{ timestamps: true }`; unused |

**Schema options:** `{ timestamps: true }`. Model name: `"Bookmark"`.

**Indexes:**

| Index | Options | Purpose |
|---|---|---|
| `{ user: 1, thread: 1 }` | `unique: true` | One bookmark per user per thread; makes concurrent saves idempotent |
| `{ user: 1, createdAt: -1 }` | – | Listing a user's bookmarks newest-first |

### Existing models

**No changes** to `User`, `Thread`, `Subreddit` or `Comment`.

- **Why a collection rather than `User.savedThreads: [ObjectId]`:** it leaves `User.js` untouched, records a save time, avoids an unbounded array on the user document, and the unique compound index enforces no duplicates at the database level.
- **No migration.** The collection is created on first write.

---

## 6. UI changes

### New files

| File | Purpose |
|---|---|
| `src/services/bookmarkService.js` | `fetchBookmarks()`, `fetchBookmarkIds()`, `saveBookmark(threadId)`, `unsaveBookmark(threadId)`. Same `getAuthHeaders()` / `axiosInstance` pattern as the other services; each returns `res.data.data`. |
| `src/reducers/bookmarkSlice.js` | Bookmark state, see below |
| `src/components/Shared/BookmarkButton.jsx` | The toggle, see below |
| `src/utils/formatRelativeTime.js` | ISO date to "just now", "5m ago", "2h ago", "3d ago", or a short locale date beyond 30 days. Built on `Intl.RelativeTimeFormat`, no new dependency. |

### Redux: `bookmarkSlice` (registered as `bookmarks` in `src/store/store.js`)

**State:**

| Key | Type | Meaning |
|---|---|---|
| `savedIds` | `string[]` | Thread ids the user has saved. Drives every toggle and the tab count. |
| `idsStatus` | `'idle' \| 'loading' \| 'succeeded' \| 'failed'` | |
| `savedThreads` | `thread[]` | Thread objects from [§4](#4-api-contract), for the Saved tab |
| `threadsStatus` | `'idle' \| 'loading' \| 'succeeded' \| 'failed'` | |
| `threadsError` | `string \| null` | |
| `pendingIds` | `string[]` | Threads with a save or unsave request in flight |

**Thunks:** `fetchBookmarkIds`, `fetchSavedThreads`, and `toggleBookmark({ threadId, save })`, where `save` is a boolean for the desired state. Failures go through `handleApiError`.

**How `toggleBookmark` updates state:**
- **pending:** add `threadId` to `pendingIds`. Optimistically add it to (save) or remove it from (unsave) `savedIds`. On unsave, also remove the thread from `savedThreads`.
- **fulfilled:** remove `threadId` from `pendingIds`.
- **rejected:** remove from `pendingIds` and restore the previous `savedIds` entry. An unsaved thread removed from `savedThreads` is not restored; the list refetches the next time the tab opens.

**Other reducers:**
- **Vote sync:** on `upvoteThreadThunk.fulfilled` / `downvoteThreadThunk.fulfilled` from `threadSlice`, update `voteCount`, `upvotes` and `downvotes` of the matching item in `savedThreads`. This is the same pattern `selectedThreadSlice` uses.
- **Logout:** on the `"auth/logout"` action type, reset to the initial state. `authSlice` doesn't export its plain `logout` action, so match on the type string.

### `BookmarkButton` component

- **Props:** `threadId`.
- **State:** reads `savedIds` and `pendingIds`; dispatches `toggleBookmark`.
- **Rendering:** a small `variant="link"` button with `bi-bookmark` or `bi-bookmark-fill`, plus `aria-pressed`, an `aria-label` of "Save thread" or "Unsave thread", and a matching `title` tooltip. `disabled` while pending.
- **Styling:** uses the existing CSS variables, so it works in both light and dark themes.

### Edits to existing files

| File | Change |
|---|---|
| `src/components/ThreadList/ThreadList.jsx` | Add `BookmarkButton` to each card's `thread-header`, after the subreddit badge. When `thread.savedAt` is present, show "saved {formatRelativeTime(savedAt)}" next to the subreddit badge. This optional field is only set by the Saved tab's data. |
| `src/components/ThreadList/ThreadCard.jsx` | Add `BookmarkButton` beside "Generate Summary". **Change the decorative `bi-bookmark` icon** before the subreddit badge (currently line 96) to `bi-people` so it isn't confused with the new button. |
| `src/pages/User/Profile.jsx` | Restructure into tabs (see below). |
| `src/App.jsx` | Add an effect: when `token` becomes truthy (login, or app load with a stored token), dispatch `fetchBookmarkIds()`. No new routes. |
| `src/store/store.js` | Register `bookmarks: bookmarkReducer`. |
| `src/config/apiConfig.js` | Add `BOOKMARK_API`: `GET_ALL` → `/bookmarks`, `GET_IDS` → `/bookmarks/ids`, `BY_THREAD(id)` → `/bookmarks/:id` (used by both save and unsave). |

### Profile page structure

1. **Header card** (unchanged visuals): avatar, name, and the Edit / Save / Cancel buttons. The buttons render only when the Details tab is active.
2. **Tabs:** react-bootstrap `Tabs` with keys `details` and `saved`. `activeKey` is bound to the `tab` search parameter via `useSearchParams`; a missing or unknown value falls back to `details`. The Saved tab title is `Saved (${savedIds.length})`.
3. **Details tab:** the existing field grid and edit form, moved here unchanged.
4. **Saved tab:**
   - On activation, dispatch `fetchSavedThreads()` and reset to page 1.
   - Renders loading, error with Retry, empty, or list states.
   - The list is `ThreadList` with `PaginationComponent` (5 per page), sliced client-side the same way `Home.jsx` does.

### Routes

No new routes. `/profile?tab=saved` is the deep link.

---

## 7. Edge cases & error handling

| Case | Expected behaviour |
|---|---|
| `threadId` isn't a valid ObjectId (e.g. `abc`) | 400 "Invalid thread id". Without this check, Mongoose would throw `CastError` and `errorHandler` would return 500. |
| Saving a thread that doesn't exist or was just deleted | 404 "Thread not found". The client reverts the optimistic toggle. |
| Thread deleted after it was saved | Left out of both GET endpoints; the orphaned bookmark is deleted on the next `GET /api/bookmarks`. A toggle can't appear for it because the thread no longer renders anywhere. |
| Double-click or rapid toggling | Toggle disabled while pending (AC-5). The server is idempotent either way. |
| Two concurrent saves (two tabs) | Unique index plus duplicate-key handling, so one document and both return 200 (AC-22). |
| Unsaving something that isn't saved | 200 no-op. |
| Token expires mid-session | 401, then the existing `handleApiError` clears storage and hard-redirects to `/login`. |
| `fetchBookmarkIds` fails at startup | `idsStatus: 'failed'`; toggles show the unsaved state. Saving still works because `PUT` is idempotent. The ids are fetched again when the Saved tab opens. |
| Saving from the feed while the Saved tab's data is stale | The Saved tab refetches every time it's activated (AC-13). |
| Unsaving the only item on the last page | The page clamps to the new last page (AC-16). |
| Unknown `?tab=` value | Falls back to `details`. |
| Logout, then login as another user | Slice reset on `auth/logout`; the ids refetch for the new token (AC-25). |
| Other devices or tabs change bookmarks | This tab's state may drift until reload or until the Saved tab is reopened. Accepted for v1. |
| Very large number of bookmarks | No cap in v1; the server returns all and the client paginates. See Out of scope. |

---

## 8. Out of scope

- A dedicated `/saved` route or a Sidebar "Saved" link. The epic draft proposed both; this spec puts the list on Profile only, as requested.
- Bookmarking comments or subreddits.
- Folders or collections, notes on bookmarks, reordering, sorting or filtering the saved list.
- Public or shared saved lists, and save counts shown on threads.
- Server-side pagination of `GET /api/bookmarks`. Revisit if users routinely exceed about 200 bookmarks.
- Cascading bookmark deletion from `deleteThreadById`. Lazy cleanup on read covers this, and cascading would mean editing `threadService.js`, which the epic's F2 also edits.
- **Pre-existing issues**, tracked separately (see the epic's "Pre-existing issues"):
  - `GET /api/threads` and `GET /api/subreddits/:id` leak author password hashes. This feature's endpoints must not leak (AC-23), but fixing the existing ones is a separate change.
  - Thread edit and delete have no ownership check.
- Making profile Details fields (bio, location, website) persist to the server.

---

## 9. Test plan

### Backend: unit tests (Vitest, models mocked with `vi.mock`, following `tests/unit/services/voteService.test.js`)

**`tests/unit/services/bookmarkService.test.js`**

| Test | Covers |
|---|---|
| `saveBookmark` creates a bookmark when the thread exists and none exists yet | AC-3 |
| `saveBookmark` returns the existing bookmark (original `savedAt`) without creating a second | AC-22 |
| `saveBookmark` treats duplicate-key error `11000` as success | AC-22 |
| `saveBookmark` throws 400 for an invalid ObjectId, without querying | Edge cases |
| `saveBookmark` throws 404 when the thread doesn't exist | Edge cases |
| `removeBookmark` deletes the user's bookmark | AC-4 |
| `removeBookmark` resolves without error when none exists | Edge cases |
| `removeBookmark` throws 400 for an invalid ObjectId | Edge cases |
| `listBookmarks` queries by `user` sorted by `createdAt` descending and maps `savedAt` | AC-14 |
| `listBookmarks` leaves out bookmarks whose thread is null and deletes those orphans | AC-20 |
| `listBookmarks` selects only `{ _id, name }` for the author and subreddit | AC-23 |
| `listBookmarkedThreadIds` returns only ids of existing threads | AC-20 |

**`tests/unit/controllers/bookmarkController.test.js`**

| Test | Covers |
|---|---|
| Each handler passes `req.user.userId` (and `req.params.threadId`) to the service and responds with the right status, message and envelope | §4 |
| Service errors propagate (thrown, not caught into ad-hoc JSON) | Conventions |

### Backend: integration tests (supertest, in-memory Mongo)

**`tests/integration/bookmark.test.js`**

Setup:
- Import `../setup.js`.
- Create two users via register and login, as `thread.test.js` does.
- `await Bookmark.init()` in `beforeAll` so the unique index exists before the duplicate tests.
- Clear `Bookmark`, `Thread` and `Subreddit` in `beforeEach`. Don't edit `tests/setup.js`.

| Test | Covers |
|---|---|
| All four endpoints return 401 without a token | AC-24 |
| `PUT` then `GET /api/bookmarks` returns the thread with `savedAt` and the author/subreddit shapes | AC-3, AC-14 |
| `PUT` then `GET /api/bookmarks/ids` contains the thread id | AC-8 |
| `PUT` twice sequentially gives 200 both times, one document, and the same `savedAt` | AC-22 |
| Two concurrent `PUT`s (`Promise.all`) give 200 both times and one document | AC-22 |
| `DELETE` after `PUT` returns 200, and `GET` no longer lists the thread | AC-4 |
| `DELETE` of an unsaved thread returns 200 | Edge cases |
| `PUT` to a non-existent valid ObjectId returns 404 | Edge cases |
| `PUT` / `DELETE` with `abc` return 400 | Edge cases |
| Thread saved then deleted is absent from both GETs, and its bookmark document is removed after `GET /api/bookmarks` | AC-20 |
| User B's GETs don't include user A's bookmarks | AC-21 |
| Three saves come back newest-saved first | AC-14 |
| Response body contains no `password` or `email` keys at any depth | AC-23 |

### Frontend: unit tests (Vitest, jsdom, React Testing Library, MSW)

**New files:**

| File | Tests | Covers |
|---|---|---|
| `tests/unit/reducers/bookmarkSlice.test.js` | Optimistic add/remove on `toggleBookmark.pending`; revert on `rejected`; `pendingIds` lifecycle; unsave removes from `savedThreads`; vote-thunk sync updates `voteCount`; reset on `{ type: "auth/logout" }`; fetch thunks set status and data | AC-3–6, AC-16, AC-19, AC-25 |
| `tests/unit/components/BookmarkButton.test.jsx` | Unsaved and saved rendering (icon class, `aria-pressed`, accessible name); click dispatches `toggleBookmark` with the right `save` flag; disabled when the id is in `pendingIds` | AC-2–5 |
| `tests/unit/utils/formatRelativeTime.test.js` | Boundaries: just now, minutes, hours, days, more than 30 days | AC-14 |

**Existing files to update** (each builds its own store, which must now include `bookmarks: bookmarkReducer`):

| File | Change |
|---|---|
| `tests/unit/pages/Profile.test.jsx` | Add the `bookmarks` reducer to `createMockStore`. All existing tests must still pass. New tests: Details is the default tab; `?tab=saved` (via `MemoryRouter initialEntries`) selects Saved; the tab label shows the count; empty state; list renders items with "saved … ago"; unsaving removes a row and decrements the count; pagination at more than 5 items; the error state's Retry refetches; Edit Profile is hidden on the Saved tab. |
| `tests/unit/components/ThreadList.test.jsx` | Add the `bookmarks` reducer. Each card renders a bookmark toggle; a thread whose id is preloaded in `savedIds` renders as saved; "saved … ago" appears only when `savedAt` is set. |
| `tests/unit/components/ThreadCard.test.jsx` | Add the `bookmarks` reducer. The toggle renders; the subreddit meta icon is no longer `bi-bookmark`. |
| `tests/unit/store/store.test.js` | Assert `state` has `bookmarks`, and that `state.bookmarks` has `savedIds`, `savedThreads`, `pendingIds`. |

### Frontend: integration tests (Redux + MSW, following `tests/integration/threadFlow.test.jsx`)

**`tests/integration/bookmarkFlow.test.jsx`**

| Test | Covers |
|---|---|
| `fetchBookmarkIds` populates `savedIds` | AC-8 |
| `toggleBookmark({ save: true })` ends with the id in `savedIds` and nothing pending | AC-3 |
| `toggleBookmark({ save: false })` removes the id from `savedIds` and the item from `savedThreads` | AC-4, AC-16 |
| Use `server.use(...)` to make `PUT` return 500; `savedIds` reverts after rejection | AC-6 |
| `fetchSavedThreads` populates `savedThreads` in server order | AC-14 |

### Mocks

- `tests/mocks/handlers.js`: add handlers for all four endpoints, backed by an in-memory set so toggles round-trip within a test.
- `tests/mocks/mockData.js`: add `mockBookmarks`, thread objects with `savedAt`.

### Manual check before merge

Run both apps (`npm run dev` in each), then:
1. Save from the feed.
2. Confirm the toggle is filled on the thread page.
3. Reload; it's still saved.
4. Open `/profile?tab=saved`; the item is listed with "saved just now".
5. Unsave there; the row disappears and the count drops.
6. Delete a saved thread via the API; it's gone from the Saved tab.
7. Repeat in dark mode.
