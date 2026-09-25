# Memory — Decision Log

> **Status:** Append-only. Never delete an entry — if a decision changes, add a new
> entry that supersedes the old one and mark the old one `Superseded`. This file is
> the "why" behind everything in `prd.md` / `architecture.md` / `rules.md` / `design.md`,
> and it's the fastest way to answer "why did you assume that?" in the interview.

**Entry template:**
```
### [YYYY-MM-DD] Short title
- Decision:
- Context / reason:
- Alternatives considered:
- Status: Active | Superseded by [date/title]
```

---

### [2026-09-25] Backend framework: Express
- Decision: Use Express, not NestJS.
- Context/reason: No prior separate-backend experience; 3-day deadline. Express has
  minimal ceremony and the fastest path to a working, well-tested MVP.
- Alternatives considered: NestJS (more structure, but its DI/module/decorator system
  costs real learning time we don't have).
- Status: Active

### [2026-09-25] Database: Postgres + Prisma
- Decision: Postgres as the DB, Prisma as the ORM.
- Context/reason: Brief recommends a relational store given pooling/capacity
  constraints; Prisma gives fast migrations, type safety, and easy seed scripts —
  good fit for learning Docker + a real DB simultaneously.
- Alternatives considered: SQLite (simpler, but doesn't demonstrate the "real DB in
  Docker" skill the brief is implicitly testing); raw SQL/Knex (more control, more time cost).
- Status: Active

### [2026-09-25] Auth: JWT + bcrypt
- Decision: Stateless JWT auth, bcrypt password hashing.
- Context/reason: No need for server-side session revocation at MVP scale; simplest
  to implement and test correctly in the time available.
- Alternatives considered: Session cookies + server-side store.
- Status: Active

### [2026-09-25] Money storage: integer poysha
- Decision: All money fields stored as integers in poysha (1 taka = 100 poysha).
- Context/reason: Avoids floating-point rounding errors compounding across fare
  calculations; converted to taka only at display time.
- Alternatives considered: Decimal/float taka values (rejected — classic source of
  off-by-a-poysha bugs in financial systems).
- Status: Active

### [2026-09-25] Concurrency: atomic conditional update, no row locks/queue for MVP
- Decision: Seat capacity race (Nusrat vs Shirin) handled via a single
  `UPDATE ... WHERE seats_occupied + n <= capacity` inside a transaction, checking
  rows-affected.
- Context/reason: Simplest correct solution at MVP scale; demonstrates understanding
  of the race without over-engineering (brief explicitly says no need for a
  distributed solution).
- Alternatives considered: Row-level pessimistic locking; a dedicated matching queue
  (both are the "what I'd do at scale" answer, not the MVP answer).
- Status: Active

### [2026-09-25] Matching rule: same pickup zone + shared corridor set
- Decision: Two requests are poolable if same pickup zone and both destinations sit
  in a predefined "corridor" list for that pickup zone.
- Context/reason: Needs to apply consistently to Nusrat (→Mohakhali) and Rafiq
  (→Gulshan-1) from the same Banani pickup without real routing.
- Alternatives considered: Simple "same destination only" (too strict — brief
  specifically calls out overlapping-but-not-identical routes); real distance/route
  overlap calculation (out of scope, no real map API).
- Status: Active — **flagged as most likely to be revisited once we're building** (see
  Open Questions in `prd.md`).

---

## AI Usage Log (fill in as we build — needed for README)

| Date | Tool | What for | Accepted example | Rejected/changed example + why |
|---|---|---|---|---|
| | | | | |

## Open Questions Carried From PRD

- [ ] Final matching/corridor rule
- [ ] Cancellation fee after `DRIVER_ARRIVED`?
- [ ] Pool discount: flat % vs flat amount

### [2026-09-25] Database hosting: local Docker Postgres + Neon for deployment
- Decision: Local dev/evaluation uses the Docker Compose Postgres container (satisfies
  the brief's requirement for a self-contained DB container). Deployed backend points
  DATABASE_URL at a Neon (serverless Postgres) instance instead.
- Context/reason: Docker compose must work standalone for evaluators with zero
  external accounts; Neon's free tier is more durable than Render's free Postgres for
  the live deployment.
- Alternatives considered: Running Postgres in a container on the deploy host too
  (works, but Neon is simpler and free-tier-friendlier for a small API).
- Status: Active


### [2026-09-25] Backend language: TypeScript
- Decision: Express backend written in TypeScript, not plain JS.
- Context/reason: Matches Prisma's generated types end-to-end; fewer runtime bugs
  during a time-boxed build.
- Status: Active

### [2026-09-25] Prisma ORM 7, not 8
- Decision: Use Prisma ORM 7.x, not the newer Prisma 8.
- Context/reason: Prisma 8's headline features push toward Prisma's own hosted
  "Platform"/"Compute" deployment workflow. We're just using Prisma as an ORM
  against our own Postgres (Docker locally, Neon deployed) — Prisma 7 is still
  fully supported and is the documented path for exactly this "bring your own
  database" use case, without the extra platform complexity we don't need.
- Status: Active

### [2026-09-25] tsx instead of ts-node-dev
- Decision: Use `tsx` to run/watch the TypeScript backend in dev.
- Context/reason: ts-node-dev has effectively been superseded; tsx is faster,
  zero-config, and is what current guides use.
- Status: Active

### [2026-09-25] Pin Prisma to exact version 7.10.0
- Decision: Pin `prisma`, `@prisma/client`, and `@prisma/adapter-pg` to the exact
  version 7.10.0 in package.json, rather than a loose/unpinned install.
- Context/reason: An unpinned `npm install prisma` resolved into Prisma 8's
  release-candidate line, which pulls in `@prisma/composer-cli` → `alchemy`
  (Cloudflare deploy tooling) → `hono`/`@hono/node-server`/`valibot`/`lodash`,
  accounting for all 13 `npm audit` findings (8 high, 5 moderate). None of that
  tooling is used by our app — it's Prisma's own hosted-platform CLI, which we
  already decided against. Pinning avoids pulling it in at all.
- Alternatives considered: `npm audit fix --force` (works, but changes versions
  implicitly rather than deliberately, and doesn't explain *why* to a reader).
- Status: Active

### [2026-09-25] Prisma 7 setup fixes: pinned version + no url in schema.prisma
- Decision: Pinned prisma/@prisma/client/@prisma/adapter-pg to 7.10.0 exactly, and
  removed `url` entirely from schema.prisma's datasource block (kept only in
  prisma.config.ts).
- Context/reason: Unpinned `prisma@latest` resolved into a Prisma 8 RC line
  bundling unrelated deploy-platform tooling (13 npm audit findings, unused by us).
  Separately, Prisma 7.10 rejects any `url` in schema.prisma at all (P1012) —
  the connection string must live solely in prisma.config.ts, with the client
  constructed via a driver adapter instead.
- Status: Active