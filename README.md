# 🛺 Dhaka Tesla Pool

> **"Share a seat. Split the fare. Survive Dhaka traffic."**
>
> A ride-pooling MVP for Dhaka's iconic battery-powered rickshaws ("Teslas"). Passengers request rides, the system pools compatible trips along shared corridors into 3-seat vehicles, calculates fair individual split fares, and tracks every ride through an immutable lifecycle state machine.

[![Backend](https://img.shields.io/badge/Backend-Express%20%2B%20TypeScript-blue)](backend/)
[![Database](https://img.shields.io/badge/Database-PostgreSQL%2016-336791)](docker-compose.yml)
[![ORM](https://img.shields.io/badge/ORM-Prisma%207.10.0-2D3748)](backend/prisma/)
[![Frontend](https://img.shields.io/badge/Frontend-Next.js%20(App%20Router)-black)](frontend/)
[![Architecture](https://img.shields.io/badge/Architecture-Living%20Specs-success)](docs/)

---

## 📋 Table of Contents

1. [Executive Summary](#-executive-summary)
2. [Problem Statement & The Story](#-problem-statement--the-story)
3. [Features Implemented (Current Progress)](#-features-implemented-current-progress)
4. [Screenshots & Visual Evidence](#-screenshots--visual-evidence)
5. [System Architecture & Database Diagram (ERD)](#-system-architecture--database-diagram-erd)
6. [Tech Stack & Justification](#-tech-stack--justification)
7. [Project Structure](#-project-structure)
8. [Prerequisites & Environment Variables](#-prerequisites--environment-variables)
9. [Local Setup & Docker Guide](#-local-setup--docker-guide)
10. [Database Migrations & Seeding](#-database-migrations--seeding)
11. [Running the Application & Tests](#-running-the-application--tests)
12. [Demo Credentials](#-demo-credentials)
13. [API Overview](#-api-overview)
14. [Key Architectural Decisions & Trade-Offs](#-key-architectural-decisions--trade-offs)
15. [Known Limitations & Next Improvements](#-known-limitations--next-improvements)
16. [AI Usage Transparency](#-ai-usage-transparency)
17. [Deployment & Demo Video](#-deployment--demo-video)

---

## 📌 Executive Summary

**Dhaka Tesla Pool** simulates real-world urban transit optimization in Dhaka, Bangladesh. Instead of high-end autonomous cars, Dhaka's informal electric battery rickshaws are universally nicknamed **"Teslas"**. These lightweight, 3-passenger vehicles navigate congested corridors where standard public transit stalls.

This system provides:
- **Corridor-Based Matching**: Pools passengers traveling from the same origin zone along common traffic arteries without requiring heavyweight routing engines.
- **Fair Fare Splitting**: Calculates dynamic discounts (storing currency in integer *poysha*) so passengers save money while drivers maximize seat utilization.
- **Atomic Concurrency Control**: Prevents overbooking the strict 3-passenger capacity even during simultaneous booking attempts.
- **Full State Auditability**: Retains complete lifecycle status histories for post-ride verification.

---

## 🎯 Problem Statement & The Story

### The Problem
During peak hours at Banani, multiple passengers head south toward Mohakhali and Gulshan-1. Hailing individual rickshaws inflates costs and triples road congestion. If a single 3-seat vehicle can pick up passengers along an overlapping route, both riders save money and the driver earns higher total revenue per trip. 

However, ride pooling introduces complex software challenges:
1. **Seat Capacity Limits**: A battery rickshaw strictly holds **3 passengers**. Overbooking by even one seat fails in the real world.
2. **Fare Fairness & Transparency**: Each passenger must see **only their own** fare, computed transparently with individual corridor distance charges and pool discounts.
3. **Auditable Lifecycle**: Rides must transition linearly without skipping phases (`REQUESTED` → `MATCHED` → `DRIVER_ARRIVED` → `STARTED` → `COMPLETED`), maintaining an immutable audit log.

### The Story (Canonical Cast)
To ensure clarity across tests, database seeds, and demos, our domain uses real personas rather than abstract IDs:

| Name | Role | Profile & Scenario |
|---|---|---|
| **Jashim** | Driver | Drives **"Bullet"**, an unaffiliated 3-seat electric battery rickshaw |
| **Bullet** | Vehicle | Fixed capacity: **3 seats**, driver seat excluded |
| **Nusrat** | Passenger | Books first: **Banani → Mohakhali** |
| **Rafiq** | Passenger | Books ~2 minutes later: **Banani → Gulshan-1** (overlapping corridor, poolable with Nusrat) |
| **Shirin** | Passenger | Tries to claim the remaining seat 30s after Rafiq (tests atomic capacity and race conditions) |

---

## 🚀 Features Implemented (Current Progress)

### Completed Foundation (Day 0 & Day 1 Scaffolding)
- [x] **Containerized PostgreSQL 16**: Fully isolated database service configured via `docker-compose.yml` with health checks and persistent volume storage.
- [x] **Express + TypeScript Backend**: Strict TypeScript backend architecture with compiled build pipelines (`tsc`) and hot-reloading development server (`tsx watch`).
- [x] **Prisma 7 ORM Schema**: Production-ready relational schema modeling `User`, `Vehicle`, `Pool`, `RideRequest`, `Fare`, and `StatusHistory` with native PostgreSQL enums (`Role`, `RideStatus`, `Zone`).
- [x] **Database Migrations (`20260924231619_init`)**: Migration lock files and SQL definitions applied cleanly to the database.
- [x] **Realistic Database Seeding**: Pre-populates the canonical cast (Jashim, Bullet, Nusrat, Rafiq, Shirin), complete with hashed credentials (`bcrypt`), active vehicle records, and initial pooled fares.
- [x] **Live Health Check Endpoint (`GET /health`)**: Verifies end-to-end API-to-database connectivity with raw query checks (`SELECT 1`).
- [x] **Prisma 7 Configuration (`prisma7.config.ts`)**: Custom config with native driver adapter support (`@prisma/adapter-pg`) and registered migration seed runners.
- [x] **Specification Documentation (`docs/`)**: Six living engineering documents (`prd.md`, `architecture.md`, `design.md`, `rules.md`, `memory.md`, `task.md`) maintained in lockstep with the codebase.

---

## 📸 Screenshots & Visual Evidence

*Terminal sessions and system outputs captured during development:*

### 1. Database Health Check (`GET /health`)
```bash
$ curl http://localhost:4000/health
{"status":"ok","db":"connected"}
```

### 2. Database Migration & Seed Output
```text
Loaded Prisma config from prisma7.config.ts.
Applying migration `20260924231619_init`
Your database is now in sync with your schema.

Running seed command `npx tsx prisma/seed.ts` ...
Seed complete
```

### 3. Docker Compose Services
```text
[+] Running 2/2
 ✔ Network dhaka-tesla-pool_default  Created
 ✔ Container dhaka-tesla-pool-postgres-1  Healthy
```

*(UI screenshots and interaction GIFs will be embedded here as the Next.js frontend is assembled in Day 2).*

---

## 🏛 System Architecture & Database Diagram (ERD)

### System Architecture
The application follows a clean separation of concerns with independent frontend and backend processes as mandated:

```mermaid
flowchart LR
    Browser["Client Browser\n(Passenger / Driver)"] 
    -->|HTTP / REST / JWT| FE["Next.js (App Router)\nfrontend/ (Port 3000)"]
    FE -->|JSON REST API| API["Express + TypeScript API\nbackend/ (Port 4000)"]
    API -->|Prisma 7 ORM\n(@prisma/adapter-pg)| DB[("PostgreSQL 16\n(Port 5432)")]
```

### Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    USER ||--o| VEHICLE : "drives (1:1)"
    USER ||--o{ RIDE_REQUEST : "books (1:N)"
    VEHICLE ||--o{ POOL : "operates (1:N)"
    POOL ||--o{ RIDE_REQUEST : "contains (1:N)"
    RIDE_REQUEST ||--|| FARE : "billed with (1:1)"
    RIDE_REQUEST ||--o{ STATUS_HISTORY : "tracks (1:N)"

    USER {
        uuid id PK
        string name "e.g. Jashim, Nusrat"
        string phone UK "Unique login identifier"
        string passwordHash "Bcrypt hash"
        enum role "PASSENGER | DRIVER"
        datetime createdAt
    }

    VEHICLE {
        uuid id PK
        uuid driverId FK,UK
        string name "e.g. Bullet"
        int capacity "Default: 3"
        boolean online "Driver availability"
    }

    POOL {
        uuid id PK
        uuid vehicleId FK
        enum status "REQUESTED | MATCHED | STARTED | COMPLETED"
        int seatsOccupied "0 to 3"
        datetime createdAt
    }

    RIDE_REQUEST {
        uuid id PK
        uuid passengerId FK
        uuid poolId FK "Nullable until pooled"
        enum pickupZone "BANANI, GULSHAN_1, etc."
        enum destinationZone "MOHAKHALI, etc."
        int seatsRequested "1 to 3"
        enum status "REQUESTED | MATCHED | DRIVER_ARRIVED | STARTED | COMPLETED | CANCELLED"
        datetime createdAt
    }

    FARE {
        uuid id PK
        uuid rideRequestId FK,UK
        int baseFarePoysha "e.g. 2000 (৳20.00)"
        int distanceChargePoysha "Zone hop charge"
        int poolDiscountPoysha "25% discount if pooled"
        int totalPoysha "Total in poysha"
    }

    STATUS_HISTORY {
        uuid id PK
        uuid rideRequestId FK
        enum fromStatus "Previous status"
        enum toStatus "New status"
        string actor "PASSENGER | DRIVER | SYSTEM"
        datetime changedAt
    }
```

---

## 🛠 Tech Stack & Justification

| Layer | Technology | Version | Rationale & Alternatives Considered |
|---|---|---|---|
| **Backend** | Express + TypeScript | Express `5.2`, TS `6.0` | Minimal ceremony, lightning-fast setup, massive documentation coverage. Chosen over NestJS to focus on domain correctness rather than complex DI boilerplate during a 3-day build. |
| **Database** | PostgreSQL | `16-alpine` | Strictly enforces relational integrity, foreign keys, and atomic check constraints required for pool seat limits. Evaluated SQLite, but PostgreSQL in Docker satisfies real-world production expectations. |
| **ORM** | Prisma ORM | `7.10.0` (Pinned) | Type-safe auto-generated client, robust migration versioning, and clean database seeding. Pinned to `7.10.0` to avoid premature platform/cloud-deploy tooling in Prisma 8 RC. |
| **Frontend** | Next.js (App Router) | React 19 / Next 15 | Modern UI layout system, native fetch caching, clean route handlers. Tailwind CSS handles utility styling with zero bloat. |
| **Auth** | JWT + Bcrypt | `jsonwebtoken`, `bcrypt` | Stateless token authentication with standard salt rounds. Eliminates server session state and matches mobile/browser REST client patterns. |
| **Money Model** | Integer Poysha | Math logic | All monetary values are handled as 64-bit integers representing *poysha* (1 Taka = 100 Poysha). Eliminates IEEE 754 floating-point rounding errors in fare calculations. |

---

## 📂 Project Structure

```text
dhaka-tesla-pool/
├── .env.example               # Root template for container & database environment
├── docker-compose.yml         # Container definitions (Postgres 16, backend, frontend)
├── docs/                      # Living engineering documents & specifications
│   ├── architecture.md        # Detailed diagrams, component flows & concurrency design
│   ├── design.md              # Frontend UI screens, component states & UX guidelines
│   ├── memory.md              # Append-only architectural decision log (ADR)
│   ├── prd.md                 # Product requirements, domain rules & user personas
│   ├── rules.md               # Fare math, corridor sets & state transition tables
│   └── task.md                # Task tracker, milestone burndown & branch tracker
├── backend/                   # Express + TypeScript API
│   ├── prisma/
│   │   ├── migrations/        # Timestamped SQL migrations
│   │   ├── schema.prisma      # Prisma database schema definition
│   │   └── seed.ts            # Test cast database seeder
│   ├── src/
│   │   ├── generated/         # Generated Prisma Client
│   │   ├── lib/
│   │   │   └── prisma.ts      # Singleton Prisma Client with pg adapter
│   │   └── index.ts           # Express server entrypoint & routes
│   ├── package.json           # Dependencies, scripts & build pipelines
│   ├── prisma7.config.ts      # Prisma 7 driver adapter & seed configuration
│   └── tsconfig.json          # TypeScript compiler options (target: ES2020)
└── frontend/                  # Next.js App Router Client (Day 2 Milestone)
```

---

## ⚙ Prerequisites & Environment Variables

### Prerequisites
- **Node.js**: v20.x or higher
- **npm**: v10.x or higher
- **Docker Desktop**: v4.25+ (with Docker Compose support)
- **Git**

### Environment Variables
Copy `.env.example` to `.env` in the root and in `backend/`:

```bash
# Root and Backend Environment Variables
POSTGRES_USER=tesla_admin
POSTGRES_PASSWORD=changeme_dev_password
POSTGRES_DB=dhaka_tesla_pool
DATABASE_URL=postgresql://tesla_admin:changeme_dev_password@localhost:5432/dhaka_tesla_pool
PORT=4000
JWT_SECRET=super_secret_jwt_key_change_in_production
```

> ⚠️ **Security Warning**: Real `.env` files are ignored in `.gitignore` and must never be committed to source control.

---

## 🐳 Local Setup & Docker Guide

### 1. Clone & Setup Environment
```bash
git clone https://github.com/your-username/dhaka-tesla-pool.git
cd dhaka-tesla-pool
cp .env.example .env
cp .env.example backend/.env
```

### 2. Boot PostgreSQL with Docker
Start the database service in the background:
```bash
docker compose up -d postgres
```
Verify the container is healthy:
```bash
docker compose ps
```

---

## 🗄 Database Migrations & Seeding

### 1. Install Backend Dependencies
```bash
cd backend
npm install
```

### 2. Apply Database Migrations
Apply the initial schema migration to create all tables and enums:
```bash
npx prisma migrate dev
```

### 3. Seed the Database
Populate the database with the official cast (Jashim, Bullet, Nusrat, Rafiq, Shirin):
```bash
npx prisma db seed
```

### 4. Inspect Data (Prisma Studio)
Launch Prisma's visual data browser:
```bash
npm run prisma:studio
```
Open [http://localhost:5555](http://localhost:5555) to view records in real time.

---

## 🏃 Running the Application & Tests

### Start the Backend in Development Mode
```bash
cd backend
npm run dev
```
The server will boot with hot-reload via `tsx watch`:
```text
◇ injected env from .env
API running on port 4000
```

### Verify Server Health
```bash
curl http://localhost:4000/health
# Response: {"status":"ok","db":"connected"}
```

### Build for Production
```bash
npm run build
npm start
```

### Run Tests
```bash
npm test
```

---

## 🔑 Demo Credentials

All seed users share the password: **`password123`**

| Persona | Role | Phone Number | Password | Context |
|---|---|---|---|---|
| **Jashim** | Driver | `01700000001` | `password123` | Drives vehicle "Bullet" (Capacity: 3) |
| **Nusrat** | Passenger | `01700000002` | `password123` | Initial requester (Banani → Mohakhali) |
| **Rafiq** | Passenger | `01700000003` | `password123` | Pooled passenger (Banani → Gulshan-1) |
| **Shirin** | Passenger | `01700000004` | `password123` | Additional rider (Concurrency test case) |

---

## 🔌 API Overview

### Implemented Endpoints
- `GET /health` — Verifies server uptime and live PostgreSQL connectivity.

### Planned Endpoints (Specification Defined in `docs/architecture.md`)
```text
AUTH:
  POST   /auth/signup               # Register new passenger or driver
  POST   /auth/login                # Authenticate and receive JWT

PASSENGER RIDES:
  POST   /rides                     # Create ride request (pickup, destination, seats)
  GET    /rides/:id                 # Get ride request details & individual fare
  GET    /rides/mine                # Passenger's personal ride history
  PATCH  /rides/:id/cancel          # Cancel before ride starts

DRIVER DISPATCH:
  GET    /driver/requests           # View pending requests matching driver's zone
  POST   /driver/rides/:id/accept   # Accept and pool compatible requests
  PATCH  /driver/rides/:id/arrive   # Mark driver arrived at pickup
  PATCH  /driver/rides/:id/start    # Start trip
  PATCH  /driver/rides/:id/complete # Complete trip & finalize fare
  GET    /driver/rides              # Driver's completed trip history
  GET    /vehicles/mine             # Current vehicle & online status
```

---

## 💡 Key Architectural Decisions & Trade-Offs

Detailed logs are tracked in [`docs/memory.md`](docs/memory.md):

1. **Integer Poysha for Currency**:
   - *Decision*: Store all fares as integer *poysha* (1 Taka = 100 Poysha).
   - *Trade-off*: Requires frontend division `/ 100` at display time, but eliminates fractional currency drift and rounding errors.
2. **Atomic Conditional Updates for Concurrency**:
   - *Decision*: Seat claims check and update capacity in a single atomic SQL transaction (`UPDATE pool SET seats_occupied = seats_occupied + :n WHERE id = :id AND seats_occupied + :n <= capacity`).
   - *Trade-off*: Avoids heavyweight distributed locking (Redis/Redlock) or message brokers for the MVP while guaranteeing that 3-seat limits are never breached under race conditions.
3. **Fixed Zone Corridors vs. Map Routing**:
   - *Decision*: Hardcoded Dhaka zone centroids (Banani, Gulshan-1, Gulshan-2, Mohakhali) and corridor adjacency matrices.
   - *Trade-off*: No real-time Google Maps / OpenStreetMap routing costs, but deterministic and easily verifiable pooling logic.
4. **Pinning Prisma to 7.10.0**:
   - *Decision*: Strictly lock `@prisma/client` and `prisma` to `7.10.0`.
   - *Trade-off*: Avoided pulling Prisma 8 release candidate dependencies (which pull Cloudflare/Hono CLI packages into local microservices), keeping dependencies minimal and clean.

---

## ⚠️ Known Limitations & Next Improvements

- **Fixed Geographic Enums**: Zones are currently modeled as categorical enums. Future versions can introduce latitude/longitude polygons for dynamic geofencing.
- **Single Vehicle Per Driver**: The current data model pairs one driver with one vehicle. Fleet owner modeling is a candidate for future extension.
- **No In-Trip Drop-offs**: Both passengers in a pooled ride are marked complete in a single pool lifecycle; intermediate stage drop-offs can be added in v2.
- **WebSockets / Live Polling**: Day 2 will implement client polling for status changes; WebSockets can provide push-based driver location updates in later iterations.

---

## 🤖 AI Usage Transparency

In accordance with process integrity and development standards, AI tooling was used as a pair-programming partner during development:

| Date | Tool / Model | Task / Prompt | Accepted Recommendation | Altered / Rejected Recommendation |
|---|---|---|---|---|
| **2026-09-25** | Gemini / Antigravity | Prisma 7 datasource config migration | Relocated database URL configuration to `prisma7.config.ts` using `defineConfig` and `@prisma/adapter-pg`. | Rejected Prisma 8 RC automated update suggestion to maintain stable local Postgres workflows. |
| **2026-09-25** | Gemini / Antigravity | `package.json` syntax & script merge | Consolidated duplicate `"scripts"` blocks and fixed missing comma before `"prisma"` configuration. | Kept standard npm scripts (`build`, `dev`, `start`, `prisma:studio`) intact. |
| **2026-09-25** | Gemini / Antigravity | TypeScript `TS6059` rootDir error | Removed `"prisma"` from `"include"` in `tsconfig.json` so `tsc` compiles `src/` cleanly into `dist/`. | Rejected setting `rootDir: "."` which would have mangled the compiled directory output to `dist/src/index.js`. |
| **2026-09-25** | Gemini / Antigravity | Dotenv initialization hoisting | Added `import 'dotenv/config'` at the top of `src/lib/prisma.ts` and `src/index.ts`. | Discarded delayed `dotenv.config()` call which executed after module import hoisting. |

---

## 🎥 Deployment & Demo Video

- **Live Deployment URL**: *(Deployment to Render / Vercel + Neon Postgres scheduled for Day 3)*
- **Demo Video (6-Minute Walkthrough)**: `[Link will be added upon Day 3 recording]`

---

*Dhaka Tesla Pool — Built with discipline, test integrity, and respect for Dhaka traffic.*
