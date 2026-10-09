# Splitlock — Speedrun Moderation Tool

A moderation console for a speedrunning website. Moderators review submitted runs, maintain leaderboards, and manage bans.

**Stack:** Node.js · Express · TypeScript · PostgreSQL · React · Vite  
**Run:** `docker compose up`

---

## Quick start

```bash
docker compose up --build
```

First boot will:

1. Start Postgres and apply `db/schema.sql`
2. Seed ~60k runs / 3.5k runners (takes 1–3 minutes depending on machine)
3. Start the API on **http://localhost:4000**
4. Start the React UI on **http://localhost:3000**

Open **http://localhost:3000**. Use the moderator switcher in the header to act as different moderators (no real login — identity is the `X-Moderator-Id` request header).

Default seed volume is tuned for a fast first boot. A production-scale site would be closer to a few hundred thousand runs; you can scale up without code changes:

```bash
SEED_RUNS=200000 SEED_RUNNERS=8000 docker compose run --rm seed
```

Run the unit tests (no Docker required for this step):

```bash
cd backend && npm install && npm test
```

---

## What it does

Mapped 1:1 to the product brief:

### Leaderboards
- Each game has its own categories (e.g. SM64 120-Star, Celeste Any%).
- Boards show **verified personal bests** of **non-banned** runners, ranked best → worst, with the runner name next to each time.
- Filter by category, platform, and runner-name search.
- **Export CSV** of the current filtered view.

### Run details
- Final time, platform, emulator flag, VOD link, comment.
- Intermediate **checkpoint / split times**.
- Full **review history** — which moderator did what, and when.
- Heuristic **suspicion flags** (WR threat, overnight PB spike, missing VOD, emulator on console board, frame-clone times, cheat-language in comments, etc.).

### Moderation
- New submissions start as **pending**.
- Moderators **approve** (run appears on the leaderboard) or **reject** (it does not; note required).
- Moderators can **ban** a runner; all of that runner’s times leave the leaderboards.
- Bans are **reversible** (appeal / lift with a reason). Run rows are never deleted.

### Authorization
- No real login system (per brief).
- Current moderator is identified by the `X-Moderator-Id` request header (UI switcher stores the choice in `localStorage`).
- Each moderator is assigned specific games via `moderator_games` and can only approve / reject / ban on those games.

---

## Project layout

```
splitlock/
├── docker-compose.yml          # db + seed + backend + frontend
├── db/schema.sql               # Postgres schema + access-path indexes
├── scripts/seed.mjs            # Batched fake-data generator
├── package-seed.json           # Minimal deps for the seed container
├── backend/
│   ├── Dockerfile
│   ├── package.json            # includes `npm test`
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # Express app
│       ├── db/pool.ts          # Bounded pg pool
│       ├── middleware/moderator.ts
│       ├── routes/             # games, leaderboard, runs, queue, runners, moderators
│       └── utils/
│           ├── format.ts / format.test.ts
│           └── suspicion.ts / suspicion.test.ts
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts          # proxies /api → backend
    └── src/
        ├── App.tsx             # Shell + routing + mod switcher
        ├── lib/api.ts          # Typed API client
        ├── lib/format.ts
        ├── pages/              # Home, Board, Queue, Run, Runner
        └── styles.css
```

---

## API overview

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | DB ping |
| GET | `/api/moderators` | List moderators + assigned games |
| GET | `/api/moderators/me` | Current mod from header |
| GET | `/api/games` | All games + counts |
| GET | `/api/games/:slug` | Game + categories |
| GET | `/api/leaderboard/:slug` | Ranked PBs (`cat`, `q`, `platform`, `page`) |
| GET | `/api/leaderboard/:slug/export` | CSV export |
| GET | `/api/runs/:id` | Full run detail + splits + reviews + suspicion |
| POST | `/api/runs/:id/approve` | Requires mod header + game assignment |
| POST | `/api/runs/:id/reject` | Body: `{ note }` (required, min 3 chars) |
| POST | `/api/runs/:id/reopen` | Back to pending |
| GET | `/api/queue` | Pending runs (`assignedOnly`, `q`, `page`) |
| GET | `/api/runners/:id` | Profile, recent runs, ban history |
| POST | `/api/runners/:id/ban` | Body: `{ reason }` |
| POST | `/api/runners/:id/unban` | Body: `{ reason? }` |

---

## Design decisions

1. **Personal-best leaderboards via `DISTINCT ON`, not every verified run.**  
   One row per runner per category: best verified time, earliest submission as tie-break. Implemented with Postgres `DISTINCT ON (runner_id)` ordered by `(time_ms, submitted_at)`, backed by the partial index `runs_pb_idx`. That is cheaper than a window-function scan when we only need the first row per partition and a single page of results (`LIMIT`/`OFFSET` keeps response memory bounded).

2. **Bans are flags + history, not deletes.**  
   `runners.banned` drives leaderboard exclusion at read time. The `bans` table is append-only with a partial unique index enforcing at most one active ban. Lifting a ban restores times without rewriting run rows — important for appeals.

3. **Suspicion is a pure, weighted severity model.**  
   `computeSuspicion()` takes cheap scalars (WR ratio, prior-PB drop, frame-clone count within 16ms ≈ 1 NTSC frame, etc.) and returns structured flags. `suspicionScore` is a fixed weight sum (`crit=10`, `warn=4`, `info=1`) so the queue can sort in process without a persisted column. Thresholds are documented next to the constants and locked by unit tests.

4. **Header-based identity.**  
   Matches the brief (“identifying the current moderator with a request header is fine”). Write paths check `moderator_games` so a mod can only act on assigned boards.

5. **Seed is memory-bounded and distribution-aware.**  
   Multi-row `INSERT` batches of 2k keep client RSS O(batch) rather than O(N). Run times use a right-skewed power curve around each category’s reference WR so boards are dense near the front, like production leaderboards. Default is ~60k runs for a fast first boot; scale toward a few hundred thousand with `SEED_RUNS` / `SEED_RUNNERS` without code changes.

6. **Indexes match the hot paths only.**  
   Partial indexes on `status = 'verified'` / `'pending'` stay small. Functional `lower(name)` supports case-insensitive search. The active-ban unique index doubles as an invariant check without a trigger.

---

## What was prioritised (and what was not)

**Built (the parts that matter most for moderators)**
- Schema + seed with realistic, tunable volume
- Leaderboards with filter + search + CSV export
- Run detail (splits, review history, suspicion)
- Moderation queue with approve / reject
- Ban / unban with history
- Game-scoped moderator permissions
- Docker Compose one-command startup
- Unit tests for suspicion scoring and time formatting

**Intentionally unfinished / simplified**
- No real authentication or sessions (header identity only, as allowed)
- No image / VOD hosting (links are placeholders)
- Suspicion heuristics are rule-based, not ML
- Queue suspicion enrichment is N+1 queries (fine at demo scale; would batch or materialize at production volume)
- No API-level integration tests against a live Postgres yet
- Frontend is functional rather than design-system complete
- No WebSocket / live queue updates
- Default seed is ~60k runs (not hundreds of thousands) so `docker compose up` stays practical; volume is configurable

---

## Validation

The pure algorithmic core is covered by Node’s built-in test runner (no extra test framework):

```bash
cd backend && npm install && npm test
```

| Suite | What it locks in |
|-------|------------------|
| `suspicion.test.ts` | WR ratio bands (0.92 / 0.985), PB spike >22%, 16ms frame-clone, severity weights (10/4/1), cheat-comment regex, emu-on-console, reject history tiers |
| `format.test.ts` | Sub-minute / multi-hour rendering, millis padding, non-finite → "—", delta sign + WR sentinel |

These tests exist because the thresholds *are* the product behavior for the queue sort order — a silent change would re-rank every pending run. SQL paths (`DISTINCT ON` PBs, partial indexes) are documented against the schema rather than integration-tested in this timebox; that is called out under Next steps.

Manual checks performed while building:
- Page size hard-capped at 100 so a client cannot force an unbounded response
- Ban path uses a transaction (flag + ban row) so a mid-flight failure cannot leave `runners.banned` out of sync with `bans`
- Reject requires a note (≥3 chars) — empty rejects are refused at the API

---

## Next steps with more time

1. **Integration tests** — spin Postgres in CI, assert PB ranking SQL and ban/lift restore leaderboard membership.
2. **Auth** — proper sessions (or SSO) while keeping the same authorization model.
3. **Performance** — materialize suspicion scores, batch queue enrichment, connection pooling tuning, read replicas for leaderboards.
4. **Audit log** — immutable append-only log for every moderation action beyond the `reviews` table.
5. **Runner appeals flow** — UI for banned runners to submit an appeal that lands in a mod queue.
6. **Category rules engine** — encode glitchless vs any% constraints and surface automatic flags.
7. **Observability** — structured logging, request IDs, basic metrics (queue depth, time-to-verify).

---

## Local development without Docker (optional)

```bash
# Postgres must be running with the schema applied
export DATABASE_URL=postgresql://splitlock:splitlock@localhost:5432/splitlock
psql $DATABASE_URL -f db/schema.sql
node scripts/seed.mjs   # needs `pg` installed

# API
cd backend && npm install && npm test && npm run dev

# UI
cd frontend && npm install && npm run dev
# Vite proxies /api → backend (set VITE_API_PROXY if needed)
```

---

## Sample moderators

| ID | Name | Assigned games (examples) |
|----|------|---------------------------|
| `mod-alice` | Alice Chen | SM64, OoT, SMW, DKC |
| `mod-bob` | Bob Okonkwo | Celeste, Hollow Knight, Portal, HL2 |
| `mod-cara` | Cara Nguyen | Metroid Prime, Melee, SM64 |
| `mod-diego` | Diego Silva | Celeste, SMW |
| `mod-eva` | Eva Kowalski | OoT, Hollow Knight, Portal |

---

## License

MIT — use freely for interview / portfolio purposes.
