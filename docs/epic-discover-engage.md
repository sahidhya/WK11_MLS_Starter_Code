# Epic: Discover & Engage

**Goal:** help users find content worth their time and give them reasons to come back and take part.

**Status:** proposal · **Drafted:** 2026-11-21

All five features are full vertical slices (model → service → controller → route → tests → slice → frontend service → component). Each one can ship alone. Where two features touch the same file, that is flagged in [File overlap](#file-overlap).

---

## Where the codebase is today

These facts about the codebase shape the proposals below:

- **Discovery is minimal.** `GET /api/threads` returns *every* thread, newest first (`threadService.fetchAllThreads`). `Home.jsx` sorts (newest / most-upvoted) and paginates (5 per page) **client-side**. There is no search, no time-aware ranking and no server-side pagination.
- **"Hot Communities" isn't hot.** `RightSidebar.jsx` sorts subreddits alphabetically and labels the result "Hot".
- **Engagement is votes plus flat comments.** There are no replies, saves, follows or personal feed. Comments come back unsorted (`commentService.getCommentsByThread`).
- **Every API route is behind `authHandler`**, and responses use the `{ success, message, data }` envelope. New endpoints follow both conventions.
- **Vote state lives in `threadSlice`.** `selectedThreadSlice` keeps vote counts in sync by listening for `upvoteThreadThunk` / `downvoteThreadThunk` in its `extraReducers`. Any new slice that holds a thread list must do the same (see [Cross-cutting conventions](#cross-cutting-conventions)).

---

## Features at a glance

| # | Feature | Value | New collection | Complexity |
|---|---------|-------|----------------|------------|
| F1 | Search | Find threads and communities by keyword instead of scrolling | – (text indexes) | M |
| F2 | Hot & Top ranking + trending communities | Show what's active *now*, not only newest or all-time | – (indexes) | M |
| F3 | Saved threads | Save threads to come back to later | `Bookmark` | S |
| F4 | Join communities + My Feed | Follow communities and get a personal feed | `Membership` | M |
| F5 | Threaded comment replies | Reply to a comment, so discussions branch | – (2 fields on `Comment`) | M |

**Complexity (rough, one developer, tests included):** S ≈ 1 day · M ≈ 2–4 days · L ≈ 1 week+

---

## F1 — Search

**Value:** find threads and communities by keyword instead of scrolling a newest-first feed.

### Data model
- `src/models/Thread.js`: `ThreadSchema.index({ title: "text", content: "text" }, { weights: { title: 3, content: 1 }, name: "thread_text" })`
- `src/models/Subreddit.js`: `SubredditSchema.index({ name: "text", description: "text" }, { weights: { name: 3, description: 1 }, name: "subreddit_text" })`
- MongoDB allows **one text index per collection**, so these indexes reserve that slot for both collections.

### Endpoints
New files: `routes/search.js` (mounted at `/api/search`), `controllers/searchController.js` and `services/searchService.js`.

| Method & path | Request | Response `data` | Errors |
|---|---|---|---|
| `GET /api/search/threads` | `?q=` (2–100 chars), `?subreddit=` (optional id), `?page=1`, `?limit=10` (max 50) | `{ results: [thread], total, page, limit }`, sorted by `textScore`, author is `{ _id, name }` | 400 bad `q`, `page` or `limit` |
| `GET /api/search/subreddits` | `?q=`, `?limit=5` | `[subreddit]` | 400 bad `q` |

**Notes:**
- `$text` matches whole (stemmed) words only, so `reac` won't find `react`. Subreddit search should also run a case-insensitive **prefix** regex on `name` and merge the results. Subreddits are a small collection, so the regex is cheap. Escape user input before building the regex.
- Unlike the existing feed, search results are paginated **server-side**, because result sets are unbounded.
- Tests: Mongoose builds indexes asynchronously, so call `await Thread.init()` and `await Subreddit.init()` in `beforeAll`. Otherwise the first `$text` query fails with "text index required".

### Frontend touch points
- **New:** `components/Header/SearchBar.jsx` (submitting navigates to `/search?q=`), `pages/User/SearchResults.jsx` (a communities strip plus thread results, reusing `ThreadList` and `PaginationComponent`), `reducers/searchSlice.js`, `services/searchService.js`
- **Edit:** `Header.jsx` (mount `SearchBar` when logged in), `App.jsx` (`/search` `PrivateRoute`), `store.js`, `config/apiConfig.js` (`SEARCH_API`), `tests/mocks/handlers.js`
- The query lives in the URL (`?q=&page=`), so result pages can be linked and survive a refresh.

### Complexity: **M**
The indexes and the two queries are small. The results page, the URL-driven state and keeping vote counts in sync take most of the effort.

---

## F2 — Hot & Top ranking + trending communities

**Value:** show what's active now instead of only newest or all-time-top, and make "Hot Communities" reflect real activity.

### Data model
- No new fields. The comment count is computed at query time with `$lookup`. A denormalized `commentCount` counter would mean editing `commentService.createComment`, which F5 also edits.
- Indexes:
  - `Thread.js`: `{ createdAt: -1 }` and `{ subreddit: 1, createdAt: -1 }`
  - `Comment.js`: `{ thread: 1 }`. F5's index covers this one; see [overlap](#file-overlap).
- **Hot score** (computed in the aggregation): `(voteCount + 2 × commentCount) / (ageHours + 2)^1.5`

### Endpoints
| Method & path | Change | Response `data` | Errors |
|---|---|---|---|
| `GET /api/threads` | **Extended:** `?sort=new\|hot\|top` (default `new`, so current callers are unaffected), `?t=day\|week\|month\|all` (applies to `top`) | `[thread]`, each with `commentCount` added (plus `hotScore` when `sort=hot`) | 400 bad `sort` or `t` |
| `GET /api/subreddits/:id` | **Extended:** same `sort` / `t` params | `{ subreddit, threads }`, threads shaped as above | 400, 404 |
| `GET /api/subreddits/trending` | **New:** `?days=7`, `?limit=5` | `[{ _id, name, description, threadCount, voteTotal }]`, ranked by activity in the window. If fewer than `limit` are active, padded with the newest subreddits. Returns `[]` rather than 404. | 400 |

**Notes:**
- Put the pipeline in one helper, `buildThreadListPipeline({ match, sort, t })`, in `threadService.js`, and call it from `subredditService.fetchSubredditWithThreads` too.
- The pipeline replaces `.populate()` with `$lookup` plus a `$project` that returns only `author: { _id, name }` and `subreddit: { _id, name }`. That also stops these two endpoints from sending password hashes (see [Pre-existing issues](#pre-existing-issues-found-while-exploring)).
- `/trending` must be declared **before** `/:id` in `routes/subreddits.js`. Otherwise `trending` is treated as an id.

### Frontend touch points
- **Edit:**
  - `components/Shared/FilterSortBar.jsx`: add 🔥 Hot and 🏆 Top buttons, plus a time-window dropdown when Top is selected.
  - `pages/User/Home.jsx`: pass the sort to the fetch, drop the client-side `.sort()`, and refetch when the sort changes. This removes the `threads.length === 0` guard.
  - `reducers/threadSlice.js`: `fetchThreads({ sort, t })`, keeping the current params in state.
  - `services/threadService.js`, `services/subredditService.js`.
  - `reducers/subredditSlice.js`: `trending` state and thunk.
  - `components/RightSidebar/RightSidebar.jsx`: "Hot Communities" reads from `/trending`.
  - `components/ThreadList/ThreadList.jsx`: the "View Comments" link becomes "💬 N comments". Treat `commentCount` as optional, because lists from F1, F3 and F4 may not include it.
  - `config/apiConfig.js`, `tests/mocks/handlers.js`.
- Client-side pagination stays as it is. Only sorting moves to the server.

### Complexity: **M**
The aggregation pipeline and the `Home.jsx` fetch refactor take most of the effort. The `Home.jsx` change is also what makes F2 overlap with F4.

---

## F3 — Saved threads

**Value:** let users save threads to come back to, which gives them a reason to return.

### Data model
New `src/models/Bookmark.js`:

```js
{ user:   { type: ObjectId, ref: "User",   required: true },
  thread: { type: ObjectId, ref: "Thread", required: true } }
// timestamps: true
// indexes: { user: 1, thread: 1 } unique, { user: 1, createdAt: -1 }
```

A separate collection rather than a `User.savedThreads` array leaves `User.js` untouched, gives a "saved at" order and avoids an unbounded array.

### Endpoints
New files: `routes/bookmarks.js` (mounted at `/api/bookmarks`), `controllers/bookmarkController.js` and `services/bookmarkService.js`.

| Method & path | Response `data` | Errors |
|---|---|---|
| `GET /api/bookmarks` | Saved threads, newest-saved first, with author `{ _id, name }` and subreddit `{ _id, name }`. Bookmarks whose thread was deleted are filtered out. | – |
| `GET /api/bookmarks/ids` | `[threadId]`, loaded once after login so cards can show their saved state | – |
| `PUT /api/bookmarks/:threadId` | `{ threadId, saved: true }`. Idempotent upsert. | 400 invalid id, 404 thread missing |
| `DELETE /api/bookmarks/:threadId` | `{ threadId, saved: false }`. Idempotent. | 400 invalid id |

**Notes:**
- The separate `/ids` endpoint means there is no need to add an `isSaved` field to thread payloads, which keeps F3 out of `threadService.js` (F2's file).
- Bookmarks of deleted threads are filtered when listing rather than cascaded on delete, which also avoids editing `threadService.js`.

### Frontend touch points
- **New:** `components/Shared/BookmarkButton.jsx`, `pages/User/SavedThreads.jsx` (reuses `ThreadList`), `reducers/bookmarkSlice.js` (`savedIds`, `savedThreads`, a toggle thunk with an optimistic update), `services/bookmarkService.js`
- **Edit:**
  - `ThreadList.jsx` and `ThreadCard.jsx`: add `BookmarkButton`.
  - `App.jsx`: the `/saved` route, plus an effect that dispatches `fetchBookmarkIds()` when a token is present.
  - `Sidebar.jsx`: a "🔖 Saved" menu item.
  - `store.js`, `config/apiConfig.js`, `tests/mocks/handlers.js`.

### Complexity: **S**
One small collection, CRUD-shaped endpoints and one toggle component.

---

## F4 — Join communities + My Feed

**Value:** let users follow the communities they care about and get a home feed of just those.

### Data model
New `src/models/Membership.js`:

```js
{ user:      { type: ObjectId, ref: "User",      required: true },
  subreddit: { type: ObjectId, ref: "Subreddit", required: true } }
// timestamps: true
// indexes: { user: 1, subreddit: 1 } unique, { subreddit: 1 }
```

There is no denormalized `memberCount` on `Subreddit`; the count comes from `countDocuments`. Adding the field would mean editing `Subreddit.js`, which F1 already edits.

### Endpoints
New files: `routes/memberships.js` (mounted at `/api` with full paths, the same pattern as `routes/votes.js`), `controllers/membershipController.js` and `services/membershipService.js`.

| Method & path | Response `data` | Errors |
|---|---|---|
| `GET /api/memberships` | Joined subreddits: `[{ _id, name, description }]` | – |
| `GET /api/memberships/:subredditId` | `{ subredditId, joined, memberCount }` | 400, 404 |
| `PUT /api/memberships/:subredditId` | `{ subredditId, joined: true, memberCount }`. Idempotent. | 400, 404 subreddit missing |
| `DELETE /api/memberships/:subredditId` | `{ subredditId, joined: false, memberCount }`. Idempotent. | 400 |
| `GET /api/feed` | Threads from joined subreddits, newest first, author `{ _id, name }`. `[]` if the user has joined none. | – |

**Notes:**
- The routes avoid `/api/subreddits/joined` and `/api/subreddits/:id/join` for two reasons. The subreddits router's `GET /:id` would capture `joined` as an id. And staying out of `routes/subreddits.js` keeps F4 independent of F2.
- Auto-joining the creator when a subreddit is created would mean editing `subredditService.createNewSubreddit` (F2's file). That's left as a follow-up.

### Frontend touch points
- **New:** `pages/User/MyFeed.jsx` (route `/feed`, reuses `ThreadList` and `PaginationComponent`, with an empty state that links to Hot Communities), `components/Shared/JoinButton.jsx`, `reducers/membershipSlice.js` (`joined`, `feed`, thunks), `services/membershipService.js`
- **Edit:**
  - `Home.jsx`: `JoinButton` and the member count in the subreddit header, and *only* there.
  - `Sidebar.jsx`: a "📰 My Feed" item and a "My Communities" section linking to `/home?subreddit=`. The joined list is fetched when the sidebar mounts.
  - `App.jsx`: the `/feed` route.
  - `store.js`, `config/apiConfig.js`, `tests/mocks/handlers.js`.
- **Design choice:** My Feed is its own page rather than an "All / Joined" toggle inside `Home.jsx`. A toggle would be slightly nicer UX, but it would mean rewriting Home's data-loading effect, which F2 also rewrites.

### Complexity: **M**
The backend is small. The work is the new page, the sidebar section and keeping three thread lists consistent on vote.

---

## F5 — Threaded comment replies

**Value:** let users reply to a specific comment, so discussions branch into conversations instead of one flat list.

### Data model
`src/models/Comment.js` additions:

```js
parentComment: { type: ObjectId, ref: "Comment", default: null },
depth:         { type: Number, default: 0 },   // capped at MAX_DEPTH = 4
// index: { thread: 1, parentComment: 1, createdAt: 1 }
```

No migration is needed. Existing comments have no `parentComment`, and `{ parentComment: null }` also matches documents that are missing the field, so old comments become top-level automatically.

### Endpoints
No new routes.

| Method & path | Change | Errors |
|---|---|---|
| `POST /api/comments` | Body gains an optional `parentComment` id, alongside the existing `thread` and `content`. The service checks that the parent exists, belongs to the same thread and has `depth < MAX_DEPTH`, then sets `depth = parent.depth + 1`. | 400 invalid id, thread mismatch or depth limit; 404 parent missing |
| `GET /api/comments/thread/:threadId` | Same route. The response now includes `parentComment` and `depth`, and is **sorted `createdAt` ascending** (it is unsorted today). | – |

**Notes:**
- The client builds the tree from the flat list: one query and no recursion on the server.
- `generateThreadSummaryService` keeps working as it is, because it still receives every comment.

### Frontend touch points
- **New:** `components/Comment/CommentThread.jsx` (a recursive node: the comment, its votes, a Reply toggle, an inline reply form and its children), `utils/buildCommentTree.js` (flat list → tree in O(n))
- **Edit:**
  - `components/Comment/CommentList.jsx`: render root comments through `CommentThread`.
  - `components/Comment/CommentForm.jsx`: a compact inline reply mode with a Cancel button.
  - `reducers/commentSlice.js`: `addComment({ threadId, content, parentCommentId })`.
  - `services/commentService.js`.
  - `tests/mocks/handlers.js` and `tests/mocks/mockData.js` (nested comment fixtures).
- `ThreadPage.jsx` doesn't change. The top-level comment form stays, and each node keeps its own reply text in local state.

### Complexity: **M**
The backend is about 20 lines. Recursive rendering, inline reply forms and indentation styling in both light and dark themes take most of the effort.

---

## File overlap

Files that two or more features edit. New files are unique to their feature and are not listed.

| File | F1 | F2 | F3 | F4 | F5 | Risk |
|---|:-:|:-:|:-:|:-:|:-:|---|
| `frontend/tests/mocks/handlers.js` (+ `mockData.js`) | ✓ | ✓ | ✓ | ✓ | ✓ | **Medium.** Every feature adds handlers. F2 also changes the existing `/threads` and `/subreddits/:id` mocks, and F5 changes the `/comments` mocks. |
| `frontend/src/config/apiConfig.js` | ✓ | ✓ | ✓ | ✓ | | Low. Each feature adds its own block; F2 adds `SUBREDDIT_API.TRENDING`. |
| `frontend/src/pages/User/Home.jsx` | | ✓ | | ✓ | | **Medium.** F2 rewrites the fetch effect and the sorting; F4 adds a button in the subreddit header. Different regions, but F2's diff is large. |
| `frontend/src/components/Sidebar/Sidebar.jsx` | | | ✓ | ✓ | | **Medium.** F3 adds a menu item; F4 adds a menu item and a section. |
| `frontend/src/components/ThreadList/ThreadList.jsx` | | ✓ | ✓ | | | Low–Medium. F2 changes the comments link; F3 adds a bookmark button. Same card, different elements. |
| `frontend/src/App.jsx` | ✓ | | ✓ | ✓ | | Low. Each adds a route; F3 also adds a bootstrap effect. |
| `frontend/src/store/store.js` | ✓ | | ✓ | ✓ | | Low. One reducer line each. |
| `backend/src/app.js` | ✓ | | ✓ | ✓ | | Low. One `app.use` line each. |
| `backend/src/models/Thread.js` | ✓ | ✓ | | | | Low. Each appends `ThreadSchema.index()` lines. |
| `backend/src/models/Comment.js` | | ✓ | | | ✓ | Low. F5's `{ thread, parentComment, createdAt }` index covers F2's `{ thread }`. Whichever lands second drops F2's index. |

**Existing test files also overlap,** following their components: `tests/unit/pages/home.test.jsx` (F2, F4), `tests/unit/components/Sidebar.test.jsx` (F3, F4), `tests/unit/components/ThreadList.test.jsx` (F2, F3).

**Coupling that isn't a file overlap:**
- **Thread payload shape.** F2 changes `author` to `{ _id, name }` and adds `commentCount`. F1, F3 and F4 render their lists with the same `ThreadList`, so they should return the same author shape, and `ThreadList` must treat `commentCount` as optional.
- **`threadSlice` vote thunks.** F1, F3 and F4 *import* `upvoteThreadThunk` / `downvoteThreadThunk` but don't edit `threadSlice`. F2 changes only `fetchThreads`, whose sole caller is `Home.jsx`.

**Fully isolated:** F5 shares only test mocks and an index line with the others.

### Suggested sequencing
1. **Parallel:** F1, F3 and F5 (low-risk, append-only overlaps), plus F2.
2. **F4 after F2 merges**, or give both to the same developer, so F4's `Home.jsx` change rebases onto F2's refactor.
3. Whichever of F3 and F4 lands second resolves the `Sidebar.jsx` merge.
4. Land the `author` select fix (below) **before** any of these, so new endpoints copy the corrected pattern.

---

## Cross-cutting conventions

These apply to every feature in the epic:

- **Populate the author with `select: "name"`** (or `$project` it) in every new thread or comment list. Never return the full `User` document.
- **Validate path ids** with `mongoose.isValidObjectId` and throw `createAppError(..., 400)`. Without this, a malformed id causes a Mongoose `CastError`, which `errorHandler` turns into a 500.
- **Keep vote counts in sync.** Any new slice that holds threads (`searchSlice`, `bookmarkSlice.savedThreads`, `membershipSlice.feed`) adds `extraReducers` for `upvoteThreadThunk.fulfilled` / `downvoteThreadThunk.fulfilled`, the same way `selectedThreadSlice` does.
- **Reset per-user slices on logout.** `authSlice` doesn't export its plain `logout` action, so match the `"auth/logout"` type in `extraReducers` (applies to `bookmarkSlice` and `membershipSlice`).
- **Test cleanup.** `tests/setup.js` clears only `Thread` and `Subreddit`. New collections (`Bookmark`, `Membership`) should be cleared in each feature's own `beforeEach` rather than by editing `setup.js`, which would add another shared file.
- **Route order.** Literal paths (`/trending`, `/ids`) go before `/:id` in the same router.

---

## Pre-existing issues found while exploring

None of these are part of the epic, but they affect it.

1. **Password hashes are sent to clients.** `threadService.js:13` and `threadService.js:22` (`GET /api/threads`, `GET /api/threads/:id`) and `subredditService.js:32` (`GET /api/subreddits/:id`) populate `author` with no `select`. `User` doesn't hide `password`, so every client receives each author's bcrypt hash and email. **Recommend fixing this first** by adding `select: "name"`. F2 would fix two of the three paths as a side effect, but the fix shouldn't wait for F2.
2. **No ownership check on thread edit or delete.** `PUT` and `DELETE /api/threads/:id` don't check the author, and `updateThread` passes `req.body` straight to `findByIdAndUpdate`. Any logged-in user can edit or delete any thread, including setting `voteCount` and `upvotedBy` directly. That matters more once F2 ranks threads by `voteCount`.
3. **"Hot Communities" is alphabetical** (`RightSidebar.jsx:19-23`). F2 fixes this.
4. **Comments are returned unsorted** (`commentService.js:5`). F5 adds a `createdAt` sort.
5. **Minor:**
   - `SUBREDDIT_API.GET_WITH_THREADS` (`/subreddits/:id/threads`) has no backend route and is unused.
   - `tests/mocks/handlers.js` mocks `GET /users/:id`, which has no backend route.
   - Profile fields (bio, location, website) are saved only to localStorage and aren't in the `User` schema.

---

## Considered, not proposed

- **Notifications** (replies to your comments, votes on your threads): high engagement value, but they hook into `commentService` and `voteService`, so they can't be built independently of F5. A natural next epic once F5 lands.
- **Public user profiles + karma:** a good candidate for a follow-up epic. It needs `User` schema changes (profile fields currently live only in localStorage) and a `/users/:id` API, which the frontend mocks already anticipate.
