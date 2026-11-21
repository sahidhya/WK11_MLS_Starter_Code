# Plan 001: Bookmarks (saved threads)

**Spec:** [001-bookmarks.md](./001-bookmarks.md) · **Drafted:** 2026-11-21 · **Status:** ready to start

The work runs bottom-up, from model to frontend tests. Each task lists the files to create or edit, the key functions, and the acceptance criteria (AC-n) it satisfies. No code is written in this plan.

Paths are relative to `threadhive-backend/` (**BE**) or `threadhive-frontend/` (**FE**).

---

## Conventions this plan relies on

- **Errors:** the backend runs Express 5, which forwards errors thrown by async handlers to `errorHandler` automatically. Controllers therefore contain **no `try/catch`**. Services throw `createAppError(message, status)`, never ad-hoc JSON.
- **Imports:** ES modules everywhere. Backend relative imports end in `.js`.
- **Controller style:** controllers import their service as a namespace (`import * as bookmarkService …`), the same as `commentController.js`. This avoids name clashes between controller and service functions.
- **Frontend services:** each file has its own local `getAuthHeaders()`, calls `axiosInstance`, and returns `res.data.data`, matching the existing `threadService.js`.
- **Redux:** thunks catch errors and return `rejectWithValue(handleApiError(err))`.

---

## T1: Model · BE

**Create** `src/models/Bookmark.js`

- **`BookmarkSchema` fields:**
  - `user`: `ObjectId`, ref `"User"`, required.
  - `thread`: `ObjectId`, ref `"Thread"`, required.
- **Options:** `{ timestamps: true }`.
- **Indexes:**
  - `BookmarkSchema.index({ user: 1, thread: 1 }, { unique: true })`
  - `BookmarkSchema.index({ user: 1, createdAt: -1 })`
- **Export:** `export default mongoose.model("Bookmark", BookmarkSchema)`.

**Satisfies:** AC-22 (database-level uniqueness)

---

## T2: Service · BE

**Create** `src/services/bookmarkService.js`

**Imports:** `mongoose`, `Bookmark`, `Thread`, `createAppError`.

| Function | Behaviour |
|---|---|
| `assertValidThreadId(threadId)` *(internal)* | Throws `createAppError("Invalid thread id", 400)` when the id isn't valid. See the note below on which check to use. |
| `toSavedThread(bookmark)` *(internal)* | Maps a populated, lean bookmark to the spec's thread object: `_id, title, content, voteCount, upvotes, downvotes, createdAt, author{_id,name}, subreddit{_id,name}` plus `savedAt = bookmark.createdAt`. |
| `listBookmarks(userId)` | Finds the user's bookmarks, sorted `createdAt: -1`. Populates `thread` with a `select` of only the fields above, and nested-populates `author` (`select: "name"`) and `subreddit` (`select: "name"`). Uses `.lean()`. Splits the results: rows where `thread` is null are orphans. If there are any, runs `Bookmark.deleteMany({ _id: { $in: orphanIds } })`. Returns the remaining rows mapped through `toSavedThread`. |
| `listBookmarkedThreadIds(userId)` | Gets the user's bookmarks with `select("thread")`. Then `Thread.find({ _id: { $in: ids } }).distinct("_id")` keeps only threads that still exist. Returns the ids as strings. |
| `saveBookmark(userId, threadId)` | Validates the id. If `Thread.exists({ _id: threadId })` is null, throws `createAppError("Thread not found", 404)`. Otherwise runs `Bookmark.findOneAndUpdate({ user, thread }, { $setOnInsert: { user, thread } }, { upsert: true, new: true })`. With timestamps on, Mongoose sets `createdAt` only on insert, so repeat saves keep the original `savedAt`. If that call fails with `err.code === 11000`, re-reads with `Bookmark.findOne({ user, thread })` instead. Returns `{ threadId, saved: true, savedAt }`. |
| `removeBookmark(userId, threadId)` | Validates the id, runs `Bookmark.deleteOne({ user, thread })` and returns `{ threadId, saved: false }`. It doesn't check that the thread exists. |

**Note on id validation:** the spec names `mongoose.isValidObjectId`, but that check accepts **any 12-character string**. Use **`mongoose.isObjectIdOrHexString`** instead: it accepts only 24-hex strings and ObjectIds, which matches the spec's intent. With the looser check, a 12-character id would get a 404 instead of a 400; it would never crash.

**Satisfies:** AC-3, AC-4, AC-14, AC-20, AC-21, AC-22, AC-23

---

## T3: Controller · BE

**Create** `src/controllers/bookmarkController.js`, with `import * as bookmarkService from "../services/bookmarkService.js"`.

Every handler responds 200 with `{ success: true, message, data }`.

| Export | Calls | `message` |
|---|---|---|
| `getBookmarks(req, res)` | `listBookmarks(req.user.userId)` | `"Bookmarks fetched successfully"` |
| `getBookmarkIds(req, res)` | `listBookmarkedThreadIds(req.user.userId)` | `"Bookmark ids fetched successfully"` |
| `saveBookmark(req, res)` | `saveBookmark(req.user.userId, req.params.threadId)` | `"Thread saved"` |
| `unsaveBookmark(req, res)` | `removeBookmark(req.user.userId, req.params.threadId)` | `"Thread unsaved"` |

There is no business logic and no `try/catch`. The user id always comes from `req.user`, never from the request body.

**Satisfies:** the response envelope in spec §4

---

## T4: Route + mount · BE

**Create** `src/routes/bookmarks.js`. Each route has `authHandler`, and they are declared in this order:
1. `GET /`: `getBookmarks`
2. `GET /ids`: `getBookmarkIds` (declared before the `/:threadId` routes, as a convention)
3. `PUT /:threadId`: `saveBookmark`
4. `DELETE /:threadId`: `unsaveBookmark`

**Edit** `src/app.js`: import `bookmarkRoutes` and add `app.use("/api/bookmarks", bookmarkRoutes)` alongside the other `/api/*` mounts, before `app.use(errorHandler)`.

**Satisfies:** AC-24 (auth on every route)

---

## T5: Backend tests · BE

### Unit tests: `tests/unit/services/bookmarkService.test.js` (create)

`vi.mock` the Bookmark and Thread models, as `voteService.test.js` does.

- **Mocking query chains:** stub each query step and resolve at the end. For example, `Bookmark.find` returns `{ sort, populate, lean }`, each `mockReturnThis()`, with `lean` resolving to fixture rows. Keep one small chain-builder helper at the top of the file.
- **Cases:**
  - **Save:** creates a bookmark; a repeat returns the original `savedAt`; error `11000` leads to `findOne` and still succeeds; an invalid id gives 400 and makes **no** model calls; a missing thread gives 404.
  - **Remove:** deletes; succeeds when there was nothing to delete; an invalid id gives 400.
  - **List:** sorts by `createdAt: -1`; maps `savedAt`; filters orphans and calls `deleteMany` with their ids; populate selects are limited to `name` for author and subreddit.
  - **Ids:** returns only ids that `distinct` reports as existing.

### Unit tests: `tests/unit/controllers/bookmarkController.test.js` (create)

`vi.mock` the service. Build `req` and `res` doubles.

- **Cases:** each handler passes `req.user.userId` (and `req.params.threadId`) to the service and sends status 200 with the exact message and `data`. A rejected service call propagates as a rejection, never as a JSON response.

### Integration tests: `tests/integration/bookmark.test.js` (create)

**Setup:**
- Import `../setup.js` and `app`.
- Copy the `createUserAndLogin()` helper from `thread.test.js` and create **two** users.
- In `beforeAll`, `await Bookmark.init()` so the unique index exists before the concurrency test runs.
- In `beforeEach`, clear `Bookmark`, `Thread` and `Subreddit`, then create one subreddit and threads. Don't edit `tests/setup.js`.

**Cases (each maps to a spec §9 row):**
- 401 on all four endpoints without a token.
- `PUT` then both GETs show the thread, with `savedAt` and author/subreddit as `{ _id, name }`.
- Two sequential `PUT`s and two concurrent `PUT`s (`Promise.all`) each give 200, leave `countDocuments` at 1, and keep the same `savedAt`.
- `DELETE` removes the thread from the list; deleting something not saved returns 200.
- `PUT` to a non-existent ObjectId gives 404; `PUT` and `DELETE` with `abc` give 400.
- A thread that was saved and then deleted is absent from both GETs, and its bookmark document is removed after `GET /api/bookmarks`.
- User B can't see user A's bookmarks.
- Three saves come back newest-first.
- A recursive key scan finds no `password` or `email` keys in any response.

**Run:** `cd threadhive-backend && npm test`. For one file: `npx vitest run tests/integration/bookmark.test.js`.

> **Checkpoint A:** the backend suite is fully green (existing and new tests) before frontend work starts. The API is now complete and can be used on its own.

**Satisfies:** test evidence for AC-3, AC-4, AC-8, AC-14, AC-20 to AC-24

---

## T6: Redux slice · FE

**Create** `src/reducers/bookmarkSlice.js`

**Dependency:** this slice imports from `services/bookmarkService.js` (T7). Create T7's file in the same change, or write the slice against T7's function names first.

**`initialState`:** `savedIds: []`, `idsStatus: 'idle'`, `savedThreads: []`, `threadsStatus: 'idle'`, `threadsError: null`, `pendingIds: []`.

| Thunk | Calls | Notes |
|---|---|---|
| `fetchBookmarkIds()` | `fetchBookmarkIds` | Sets `idsStatus` and `savedIds` |
| `fetchSavedThreads()` | `fetchBookmarks` | Sets `threadsStatus`, `savedThreads` and `threadsError` |
| `toggleBookmark({ threadId, save })` | `saveBookmark` or `unsaveBookmark` | Add a **`condition`** option that skips dispatching when `threadId` is already in `pendingIds`. This guards against double-dispatch, on top of the disabled button. |

**How `toggleBookmark` changes state (it uses `action.meta.arg`):**
- **pending:** push to `pendingIds`. If `save`, add to `savedIds`; otherwise remove it from `savedIds` and drop the thread from `savedThreads`.
- **fulfilled:** remove from `pendingIds`.
- **rejected:** remove from `pendingIds` and invert the `savedIds` change. Don't restore `savedThreads`; the list refetches when the tab next opens.

**Other reducers:**
- **Vote sync:** handle `upvoteThreadThunk.fulfilled` and `downvoteThreadThunk.fulfilled`, imported from `./threadSlice`, by merging `voteCount`, `upvotes` and `downvotes` into the matching `savedThreads` item.
- **Logout:** `builder.addCase('auth/logout', () => initialState)`. `authSlice` doesn't export its plain `logout` action, so match on the type string. Register string cases before any `addMatcher`.

**Exported selectors:** `selectSavedIds`, `selectIsSaved(state, threadId)`, `selectIsPending(state, threadId)`, `selectSavedCount`, and `selectSavedThreadsState` (returns `{ savedThreads, threadsStatus, threadsError }`).

**Satisfies:** AC-3 to AC-7, AC-11, AC-16, AC-19, AC-25

---

## T7: Frontend service + API config · FE

**Edit** `src/config/apiConfig.js`: add
`BOOKMARK_API = { GET_ALL: "/bookmarks", GET_IDS: "/bookmarks/ids", BY_THREAD: (id) => \`/bookmarks/${id}\` }`.

**Create** `src/services/bookmarkService.js`, with a local `getAuthHeaders()`:

| Function | Request |
|---|---|
| `fetchBookmarks()` | `GET BOOKMARK_API.GET_ALL` |
| `fetchBookmarkIds()` | `GET BOOKMARK_API.GET_IDS` |
| `saveBookmark(threadId)` | `PUT BOOKMARK_API.BY_THREAD(threadId)` with a `null` body |
| `unsaveBookmark(threadId)` | `DELETE BOOKMARK_API.BY_THREAD(threadId)` |

Each returns `res.data.data`.

---

## T8: Components · FE

**Create** `src/utils/formatRelativeTime.js`

- **Signature:** `formatRelativeTime(isoString, now = Date.now())`. The injectable `now` keeps tests deterministic.
- **Output:** "just now" under 1 minute; "Nm ago" under an hour, "Nh ago" under a day, "Nd ago" up to 30 days; after that, a short locale date. Built on `Intl.RelativeTimeFormat` for wording or `toLocaleDateString` for the date. No new dependency.

**Create** `src/components/Shared/BookmarkButton.jsx` (default export, prop `threadId`)

- **Behaviour:** reads `selectIsSaved` and `selectIsPending`. On click, dispatches `toggleBookmark({ threadId, save: !isSaved })`.
- **Markup:** a react-bootstrap `Button` with `variant="link" size="sm"` and `className="bookmark-btn"`, containing `<i className="bi bi-bookmark | bi-bookmark-fill" aria-hidden>`.
- **Accessibility and state:** `aria-pressed={isSaved}`; `aria-label` and `title` of "Save thread" or "Unsave thread"; `disabled={isPending}`.
- **Styling:** color via `var(--primary-blue)` so dark mode works. No new CSS file; this matches `VoteButtons`, which has none either.

**Satisfies:** AC-2, AC-3, AC-4, AC-5, AC-14 (relative time)

---

## T9: Wire-up · FE

| File | Change |
|---|---|
| `src/store/store.js` | Import `bookmarkReducer` and register `bookmarks: bookmarkReducer`. |
| `src/App.jsx` | Add `useDispatch` and import `fetchBookmarkIds`. Add `useEffect(() => { if (token) dispatch(fetchBookmarkIds()) }, [token, dispatch])`. This covers both a fresh login and app load with a stored token. |
| `src/components/ThreadList/ThreadList.jsx` | Render `<BookmarkButton threadId={thread._id} />` inside `.thread-header`, after the subreddit badge. When `thread.savedAt` is present, render "saved {formatRelativeTime(thread.savedAt)}" in muted text next to the badge. |
| `src/components/ThreadList/ThreadCard.jsx` | Render `<BookmarkButton threadId={thread._id} />` beside the Generate Summary button. Change the decorative `bi bi-bookmark` icon on the subreddit meta row (currently around line 96) to `bi bi-people`. |
| `src/pages/User/Profile.jsx` | Add tabs and the Saved panel (details below). |

### `Profile.jsx` details

- **Tab state:**
  - `const [searchParams, setSearchParams] = useSearchParams()`.
  - `activeTab = searchParams.get('tab') === 'saved' ? 'saved' : 'details'`, so an unknown value opens Details.
- **Tabs:**
  - react-bootstrap `Tabs` with `activeKey={activeTab}`.
  - `onSelect`: when the key is `details`, call `setSearchParams({})`; otherwise call `setSearchParams({ tab: key })`.
  - The Saved tab's title is `` `Saved (${savedCount})` ``.
- **Header:** the avatar and name stay. The Edit, Save and Cancel buttons render **only when `activeTab === 'details'`**. The existing field grid and edit form move unchanged into the Details tab.
- **Saved panel** (a local component inside `Profile.jsx`; extract it to its own file only if the page grows unwieldy):
  - **On activation** (an effect on `activeTab === 'saved'`): dispatch `fetchSavedThreads()` and reset `currentPage` to 1. Also dispatch `fetchBookmarkIds()` if `idsStatus === 'failed'`.
  - **States:**
    - loading: `Spinner`
    - error: `Alert` with a Retry button that re-dispatches `fetchSavedThreads()`
    - empty: "You haven't saved any threads yet." with `<Link to="/home">`
    - list: `<ThreadList threadsToDisplay={pageSlice} />` plus `PaginationComponent`, at 5 per page, sliced the same way as `Home.jsx`
  - **Clamp effect:** when `currentPage > totalPages && totalPages > 0`, set `currentPage` to `totalPages`.

> **Warning:** after T9, the existing `Profile.test.jsx`, `ThreadList.test.jsx`, `ThreadCard.test.jsx` and `store.test.js` **fail** until T10 updates them. Do T9 and T10 in the same sitting, and don't stop between them.

**Satisfies:** AC-1, AC-7, AC-8, AC-9 to AC-18

---

## T10: Frontend tests · FE

### Mocks (do these first, because the other tests depend on them)

- `tests/mocks/mockData.js`: add `mockBookmarks`, thread objects with `savedAt` and author and subreddit as `{ _id, name }`.
- `tests/mocks/handlers.js`:
  - Add handlers for all four endpoints, backed by a module-level `Set` of saved ids, so a save followed by a list round-trips.
  - Export a `resetBookmarkMock()` function and call it in each bookmark test's `beforeEach`. `server.resetHandlers()` doesn't clear module state.

### New test files

| File | Cases |
|---|---|
| `tests/unit/reducers/bookmarkSlice.test.js` | Optimistic add and remove on pending; reverse on rejected; `pendingIds` lifecycle; `condition` blocks a duplicate in-flight toggle; unsave drops the thread from `savedThreads`; vote-thunk fulfilled syncs counts; logout reset. The logout test must dispatch the **real `logout()` thunk from `authSlice`**, not a hand-written action, so renaming the action type breaks the test. |
| `tests/unit/components/BookmarkButton.test.jsx` | Saved and unsaved rendering (icon class, `aria-pressed`, accessible name); a click dispatches with the correct `save` flag; disabled when the id is in `pendingIds`. |
| `tests/unit/utils/formatRelativeTime.test.js` | Boundary values: 59 s, 1 m, 59 m, 1 h, 23 h, 1 d, 30 d, 31 d. Use a fixed `now`. |
| `tests/integration/bookmarkFlow.test.jsx` | A real store with `bookmarks` (and `threads`) plus MSW. `fetchBookmarkIds` fills `savedIds`. A save leaves the id saved with nothing pending. An unsave removes it from `savedIds` and `savedThreads`. With `server.use(...)` making `PUT` return 500, the change reverts. `fetchSavedThreads` keeps the server's order. |

### Existing test files to update

| File | Change |
|---|---|
| `tests/unit/pages/Profile.test.jsx` | Add `bookmarks: bookmarkReducer` to `createMockStore`. Switch to `MemoryRouter` (with `initialEntries`) where a test needs `?tab=saved`. All existing tests must still pass unchanged. New cases: Details opens by default; `?tab=saved` opens Saved; tab count; empty state; list with "saved … ago"; unsave removes a row and lowers the count; pagination past 5 items; Retry after an error; Edit Profile hidden on Saved. |
| `tests/unit/components/ThreadList.test.jsx` | Add the reducer. Every card has a toggle; a preloaded `savedIds` entry renders as saved; "saved …" text appears only when `savedAt` is set. |
| `tests/unit/components/ThreadCard.test.jsx` | Add the reducer. The toggle renders; the subreddit meta icon isn't `bi-bookmark`. |
| `tests/unit/store/store.test.js` | Assert that `state.bookmarks` exists and has `savedIds`, `savedThreads` and `pendingIds`. |

**Run:** `cd threadhive-frontend && npx vitest run` (plain `npm test` starts watch mode), then `npm run lint`.

> **Checkpoint B:** both suites and lint are green.

**Satisfies:** test evidence for AC-1 to AC-19 and AC-25

---

## T11: Manual verification (spec §9)

Run both apps (`npm run dev` in each), then:
1. Save from the feed.
2. Confirm the toggle is filled on the thread page.
3. Reload; it's still saved.
4. Open `/profile?tab=saved`; the item shows "saved just now".
5. Unsave it there; the row disappears and the count drops.
6. Delete a saved thread via the API; it's gone from the Saved tab.
7. Repeat in dark mode.

---

## Risks and gotchas

| Risk | Mitigation |
|---|---|
| Existing frontend tests build their own stores without `bookmarks` and crash once the components read it | T10 updates all four; do T9 and T10 together |
| The unique index builds asynchronously, so the concurrency test could pass or fail by luck | `await Bookmark.init()` in the integration `beforeAll` |
| `isValidObjectId` accepts 12-character strings | Use `isObjectIdOrHexString` (T2) |
| The logout reset depends on the `"auth/logout"` type string | The slice test dispatches the real `logout()` thunk, so a rename fails the test |
| Mocking Mongoose query chains is brittle | One chain-builder helper in the unit test; the integration tests are the real proof |
| MSW handler state leaks between tests | `resetBookmarkMock()` in `beforeEach` |
| Mongoose upsert timestamps: `savedAt` must not change on a repeat save | Rely on `$setOnInsert` with timestamps; covered by the "same `savedAt`" integration test |

---

## Task checklist

### Backend
- [ ] **T1** Create `src/models/Bookmark.js` (fields, timestamps, both indexes)
- [ ] **T2** Create `src/services/bookmarkService.js`
  - [ ] `assertValidThreadId` (uses `isObjectIdOrHexString`) and `toSavedThread`
  - [ ] `listBookmarks`: populate with `select`, sort, filter and delete orphans
  - [ ] `listBookmarkedThreadIds`: only existing threads
  - [ ] `saveBookmark`: 404 check, upsert, `11000` fallback
  - [ ] `removeBookmark`: idempotent
- [ ] **T3** Create `src/controllers/bookmarkController.js` (4 handlers, exact messages)
- [ ] **T4** Create `src/routes/bookmarks.js`; mount in `src/app.js`
- [ ] **T5** Backend tests
  - [ ] `tests/unit/services/bookmarkService.test.js`
  - [ ] `tests/unit/controllers/bookmarkController.test.js`
  - [ ] `tests/integration/bookmark.test.js` (two users, `Bookmark.init()`, own cleanup)
  - [ ] **Checkpoint A:** `npm test` green in `threadhive-backend`

### Frontend
- [ ] **T6** Create `src/reducers/bookmarkSlice.js` (state, 3 thunks with `condition`, vote sync, logout reset, selectors)
- [ ] **T7** Add `BOOKMARK_API` to `src/config/apiConfig.js`; create `src/services/bookmarkService.js`
- [ ] **T8** Components
  - [ ] Create `src/utils/formatRelativeTime.js`
  - [ ] Create `src/components/Shared/BookmarkButton.jsx`
- [ ] **T9** Wire-up
  - [ ] Register `bookmarks` in `src/store/store.js`
  - [ ] `App.jsx`: load ids when the token is set
  - [ ] `ThreadList.jsx`: toggle and "saved …" text
  - [ ] `ThreadCard.jsx`: toggle; swap the `bi-bookmark` meta icon to `bi-people`
  - [ ] `Profile.jsx`: URL-driven tabs, Edit button only on Details, Saved panel (all four states, pagination, clamp)
- [ ] **T10** Frontend tests
  - [ ] `mockData.js` and `handlers.js` (with `resetBookmarkMock`)
  - [ ] `bookmarkSlice.test.js`
  - [ ] `BookmarkButton.test.jsx`
  - [ ] `formatRelativeTime.test.js`
  - [ ] `integration/bookmarkFlow.test.jsx`
  - [ ] Update `Profile.test.jsx`
  - [ ] Update `ThreadList.test.jsx`
  - [ ] Update `ThreadCard.test.jsx`
  - [ ] Update `store.test.js`
  - [ ] **Checkpoint B:** `npx vitest run` and `npm run lint` green in `threadhive-frontend`

### Verification
- [ ] **T11** Manual check (7 steps) in light and dark mode
- [ ] Every AC-1 to AC-25 has a passing test, or is covered by the manual check
