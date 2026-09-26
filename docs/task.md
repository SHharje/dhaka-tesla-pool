# Task Board — Dhaka Tesla Pool

> **Status:** Living checklist. Update statuses as we go. Add tasks we discover we need;
> don't just silently do extra work without logging it here. Legend: ⬜ todo · 🔄 in
> progress · ✅ done · ❌ cut (log why in memory.md).

Deadline: **2026-09-28**. Started: **2026-09-25**.

## Day 0 — Skeleton
- ✅ Install Docker Desktop, confirm `docker run hello-world` works
- ✅ Init git repo, create `master`
- ✅ Create `/frontend`, `/backend`, root `docker-compose.yml`, `.env.example`
- ✅ First `feature/*` branch: `feature/project-skeleton`
- ✅ Draft architecture diagram + ERD (done in `architecture.md` — refine as needed)
- ✅ `docker compose up` boots Postgres + a backend health-check endpoint successfully
- ✅ Merge skeleton into `master`

## Day 1 — Backend end-to-end
- ✅ Prisma schema: User, Vehicle, Pool, RideRequest, Fare, StatusHistory
- ✅ Migrations run inside Docker
- ✅ Seed script: Jashim/Bullet/Nusrat/Rafiq/Shirin
- ✅ Auth: signup/login (passenger + driver), JWT + bcrypt
- ✅ Ride request endpoint + matching logic (rules.md §3)
- ✅ Fare calculation (rules.md §4) + unit tests against the worked example
- ⬜ State transition endpoints + validation (rules.md §1)
- ✅ Concurrency-safe seat claim (rules.md §7) + a test that fires two claims at once
- ✅ Ownership/authorization checks + a test proving cross-user access is blocked
- ⬜ Feature branches merged into `master` as each piece passes its tests

## Day 2 — Frontend end-to-end
- ⬜ Passenger: request ride, status tracker, history, cancel
- ⬜ Driver: online/offline, incoming requests, active ride view, history
- ⬜ Loading/error/empty states on every screen (design.md §2)
- ⬜ Pool membership visible in UI
- ⬜ Wired to real backend, no mocked data left by end of day

## Day 3 — Deploy, docs, submit
- ⬜ Deploy frontend (Vercel) + backend/DB (Render/Railway) — or documented Docker fallback
- ⬜ Cut `pre-release`, fix integration issues
- ⬜ Cut `release/v1.0.0`
- ⬜ README: all required sections filled (see checklist below)
- ⬜ AI usage section written honestly (accepted example + rejected example)
- ⬜ Record 6-minute video
- ⬜ (If time) Bonus: viral-scale reasoning write-up
- ⬜ Run full submission checklist below

## Cross-Cutting Checklists

### Git
- ⬜ `master`, `pre-release`, `release/v1.0.0` all exist with real history
- ⬜ No single giant "initial commit"
- ⬜ No direct pushes to `master` for feature work
- ⬜ Commit messages follow `type(scope): description`

### Testing (from PRD §12)
- ✅ Capacity never exceeded (pool.test.ts TEST 3 — overflow returns 409)
- ⬜ Invalid state transitions rejected
- ✅ Nusrat/Rafiq pooled fare matches hand calculation (seed data + fare.ts)
- ✅ Cross-user access blocked (pool.test.ts TEST 5 — driver can't use another's vehicle)
- ⬜ Cancellation rules hold
- ✅ Concurrent seat claims don't corrupt capacity (pool.test.ts TEST 4 — Promise.all race)

### README (from PRD §12 / brief §12)
- ⬜ Summary, problem, features, screenshots/GIFs
- ⬜ Architecture diagram + ERD
- ⬜ Tech stack, structure, prerequisites
- ⬜ Env vars documented (`.env.example`)
- ⬜ Local + Docker setup, migrations/seed instructions
- ⬜ How to run frontend/backend/tests, demo credentials
- ⬜ Deployment URL, API overview, decisions/trade-offs, limitations, next steps
- ⬜ AI usage section
- ⬜ Video link

### Submission
- ⬜ Public repo accessible, working MVP
- ⬜ Docker setup, no secrets committed
- ⬜ Migrations + seed data with cast
- ⬜ Diagrams present
- ⬜ Three-branch history with real commits
- ⬜ Tests present
- ⬜ Video link in README

## Branch Tracker

| Branch | Purpose | Status |
|---|---|---|
| `master` | integration | 🔄 |
| `feature/project-skeleton` | Day 0 scaffolding | ✅ |
| `feature/passenger-auth` | auth endpoints | ✅ |
| `feature/tesla-pooling` | matching + pool + capacity | 🔄 |
| `feature/driver-vehicle` | driver vehicle & request endpoints | ✅ |
| `feature/fare-calculation` | pure fare model, calculation & recalculation | ✅ |
| `feature/frontend-passenger` | passenger UI | ⬜ |
| `feature/frontend-driver` | driver UI | ⬜ |
| `pre-release` | integration fixes | ⬜ |
| `release/v1.0.0` | submission tag | ⬜ |

### [2026-09-25] Test framework: Vitest, not Jest
- Decision: Vitest + Supertest for backend tests.
- Context/reason: Vitest is the current recommended default for new TS projects,
  shares esbuild with tsx (consistent toolchain), Supertest is test-runner-agnostic
  so it works identically either way.
- Status: Active — supersedes the "Jest" mentions in prompts.md/architecture.md