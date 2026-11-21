# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ThreadHive is a Reddit-style app split into two independent npm projects (no root package.json): `threadhive-backend/` (Express 5 + Mongoose, ESM) and `threadhive-frontend/` (React 19 + Redux Toolkit + Vite). Run all commands from inside the respective subdirectory.

## Commands

Backend (`threadhive-backend/`):
- `npm run dev` — nodemon on `main.js`; `npm start` — plain node
- `npm test` — `vitest run` (all tests); single file: `npx vitest run tests/unit/services/authService.test.js`; by name: `npx vitest run -t "name"`
- `npm run populate` — seed DB via `src/scripts/populate_db.js`
- `npm run format` — prettier
- Copy `.env.example` to `.env` (`MONGODB_URI`, `PORT`, `JWT_SECRET`, AI keys). `.env` reads are denied in `.claude/settings.json`.

Frontend (`threadhive-frontend/`):
- `npm run dev`, `npm run build`, `npm run lint`
- `npm test` (vitest in watch mode); single run: `npx vitest run tests/unit/components/Header.test.jsx`; `npm run test:coverage`

## Architecture

**Backend** layering: `routes/` → `controllers/` → `services/` → `models/`. Controllers handle HTTP; business logic and DB access live in services. Errors are created with `utils/createAppError.js` and handled centrally by `middleware/errorHandler.js`; auth via `middleware/authHandler.js` (JWT). `src/app.js` builds the Express app (exported for supertest); `server.js`/`db.js`/`main.js` handle listening and Mongo connection separately. Route mounts: `/api/threads`, `/api/subreddits`, `/api/auth`, `/api/comments`, and `/api` for votes (`routes/votes.js`).

**AI features** (thread summary, rephrase) go through `src/utils/aiProvider.js`, which exports a single `generateAIContent(prompt)`. Providers are switched by commenting/uncommenting code blocks in that file (Gemini currently active, OpenAI option commented out) — not by an env flag.

**Backend tests**: `tests/setup.js` starts `mongodb-memory-server` (needs a first-time binary download; timeouts are 60s, files run serially via `fileParallelism: false`). `tests/unit/` mirrors `src/` layers; `tests/integration/` hits routes through supertest.

**Frontend**: `src/api/axiosInstance.js` hardcodes `baseURL` `http://localhost:5000/api`; endpoint paths live in `src/config/apiConfig.js`; `src/services/*` wrap axios calls; Redux slices are in `src/reducers/` and registered in `src/store/store.js` (auth, threads, selectedThread, comments, theme, subreddits). Frontend tests use jsdom + MSW (`tests/mocks/handlers.js`) with setup in `tests/setup.js`; `tests/unit/` and `tests/integration/` (flow tests).

## Conventions

- ES modules throughout (`import`/`export`, no `require`). Use `.js` extensions in backend relative imports.
- Backend is layered controller → service → model; raise errors with `createAppError`, never respond with ad-hoc error JSON.
- Mongoose models live in `src/models`; routes are mounted in `src/app.js`.
- Frontend: React + Vite + Redux Toolkit; one slice per domain in `src/reducers`, API calls in `src/services`.
- Tests use Vitest; backend integration tests use Supertest. Run with `npm test`.
- A new feature is a vertical slice: model → service → controller → route → tests → Redux slice → frontend service → component.

## Project workflow (`.claude/`)

Custom slash commands: `/spec` (writes numbered spec to `specs/NNN-name.md`, no implementation code), `/plan-feature`, `/open-pr`. Settings allow `git`, `gh`, `npm test*`, `npm run *` and default to `acceptEdits`. There is no git repo in this directory currently.
