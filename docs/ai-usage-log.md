# AI Usage Log — Dhaka Tesla Pool

> **Purpose:** Running log of AI-assisted decisions during development.
> When writing the final README §AI Usage, pull one "accepted" and one
> "rejected/changed" example from this file and explain reasoning.

---

## Format

```
### [YYYY-MM-DD HH:MM] <short title>
- **Tool:** Gemini / Claude / Copilot / ChatGPT / etc.
- **What AI suggested:** <1–2 sentences>
- **Outcome:** ✅ Accepted | ✏️ Modified | ❌ Rejected
- **Why:** <1–2 sentences explaining reasoning>
- **Files affected:** <list>
```

---

## Log

### [2026-09-25 19:01] Auth module scaffolding
- **Tool:** Google Gemini (Antigravity IDE — Claude Opus 4.6)
- **What AI suggested:** Full auth implementation: service/controller/middleware/routes
  split, bcrypt hashing with 10 salt rounds, JWT with 24h expiry, BD phone regex
  `^(\+880|0)1[3-9]\d{8}$`, app.ts/index.ts split for testability, 13 Vitest+Supertest
  tests with Prisma mocked via `vi.hoisted()`.
- **Outcome:** ✅ Accepted
- **Why:** The generated structure followed our planned folder layout exactly, validation
  rules were correct for BD phone numbers, and the app/server split was a good call for
  test isolation. All 13 tests pass, TypeScript compiles clean.
- **Files affected:** `src/app.ts`, `src/index.ts`, `src/services/auth.service.ts`,
  `src/controllers/auth.controller.ts`, `src/routes/auth.routes.ts`,
  `src/middleware/auth.middleware.ts`, `src/__tests__/auth.test.ts`

### [2026-09-25 19:04] vi.mock hoisting fix
- **Tool:** Google Gemini (Antigravity IDE — Claude Opus 4.6)
- **What AI suggested:** Initially used a bare `const mockPrismaUser = { ... }` before
  `vi.mock()`, which failed because vi.mock factories are hoisted above variable
  declarations. AI self-corrected to `vi.hoisted()` pattern on second attempt.
- **Outcome:** ✏️ Modified (AI self-corrected after first failure)
- **Why:** First approach hit a Vitest hoisting error — `vi.hoisted()` is the documented
  pattern for making variables available inside hoisted mock factories.
- **Files affected:** `src/__tests__/auth.test.ts`

### [2026-09-25 19:16] Driver vehicle toggle & ride requests
- **Tool:** Google Gemini (Antigravity IDE)
- **What AI suggested:** Driver routes under `/driver` with `authMiddleware` enforcing `role === 'DRIVER'`. `PATCH /driver/online` updates `vehicle.online` scoped strictly by `req.user.userId` via 1:1 relation (inherently preventing cross-driver vehicle tampering and returning 403 if no vehicle exists). `GET /driver/requests` returns unmatched rides (`status: REQUESTED`) selecting only passenger name, pickup/dest zone, and seat count to prevent PII leakage. Comprehensive 11 Vitest+Supertest tests mocking Prisma.
- **Outcome:** ✅ Accepted
- **Why:** Complies strictly with PRD data-privacy constraints, role checks, and ownership validation without redundant queries. All 11 tests pass with zero type errors.
- **Files affected:** `src/app.ts`, `src/routes/driver.routes.ts`, `src/controllers/driver.controller.ts`, `src/services/driver.service.ts`, `src/__tests__/driver.test.ts`

<!-- Add more entries below as you work -->
