# PRD — Dhaka Tesla Pool

> **Status:** Living document. This is our working spec, not the original assignment brief.
> When something here changes during the build, log it in `memory.md` with the date and
> reason, then update this file to match. Don't silently drift — leave a trail.

**Origin:** Based on the RoBenDevs internship challenge brief ("Dhaka Tesla Pool").
See that PDF for the full evaluation rubric — this file is our own restatement + decisions.

---

## 1. One-liner

Share a seat. Split the fare. Survive Dhaka traffic.

A ride-pooling MVP where a passenger requests a ride, the system decides when two
passengers can share one "Tesla" (a 3-seat battery rickshaw), splits the fare fairly,
and tracks the ride through a clear lifecycle — with correct state, not real routing.

## 2. The Story (cast — keep consistent everywhere: seed data, tests, demo, README)

| Name | Role | Detail |
|---|---|---|
| **Jashim** | Driver | Owns Bullet |
| **Bullet** | Vehicle | 3-seat, battery-powered, unaffiliated "Tesla" |
| **Nusrat** | Passenger | Banani → Mohakhali, books first |
| **Rafiq** | Passenger | Banani → Gulshan 1, books ~2 min later, overlapping-but-not-identical route |
| **Shirin** | Passenger | Tries to grab the last seat 30s after Rafiq — the concurrency case |

No `user1` / `driver1` anywhere, ever.

## 3. Problem Statement

Nusrat wants Banani → Mohakhali. Rafiq wants Banani → Gulshan 1. Jashim's Bullet has
three seats. The system must:
- let passengers request rides and, when it makes sense, pool them into one vehicle
- let the driver see who's assigned and what stage the ride is at
- let each passenger see **only their own** fare and status
- retain enough history after completion to reconstruct exactly what happened

## 4. Actors & Goals

**Passenger** — sign up/in, request ride (pickup, destination, seats), see estimated
fare, track status, view history, cancel while valid.

**Driver / Tesla** — sign in, go online/offline, own a vehicle with fixed capacity,
see relevant requests, accept a ride/pool, mark arrival/start/complete, see current
passengers+seats and ride history.

**Ride / Pool** — multiple requests may share one vehicle; occupied seats never exceed
capacity; each passenger gets an individual fare; clear lifecycle; obvious pool
membership.

## 5. Ride Lifecycle

```
REQUESTED → MATCHED/ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED
                                                          ↘ CANCELLED (from any pre-STARTED state)
```

Full transition table, who can trigger what, and validation → **`rules.md`**.

## 6. Geography & Matching

No real map APIs. Predefined Dhaka zone list (Banani, Gulshan, Mohakhali, Dhanmondi,
Mirpur, Uttara, Farmgate, Bashundhara, …), each zone a fixed lat/long centroid.

Matching rule (draft — see `rules.md` for the authoritative, current version; this is
one of the things most likely to be refined once we're actually building):
> Two requests are poolable if their pickup zone is the same AND their destination
> zones are both reachable via a shared "corridor" (a hardcoded list of
> zone-pairs-that-are-roughly-on-the-way, e.g. `Banani → {Mohakhali, Gulshan-1}` share
> a corridor). Applied consistently to Nusrat/Rafiq.

## 7. Fare Model

```
passengerFare = baseFare + distanceCharge − poolDiscount
```

Money stored as **integer poysha** (1 taka = 100 poysha) — avoids floating-point
rounding bugs in financial math; formatted to taka only at display time. Full formula,
constants, and a worked example using Nusrat & Rafiq → `rules.md`.

Payment: cash or simulated TeslaPay wallet balance. No real payment gateway.

## 8. Non-Goals (explicitly out of scope)

- Real routing / real map distance calculation
- Real payment gateway integration
- Microservices, Kafka, Kubernetes, Redis, message queues (unless justified later)
- Push notifications / native apps
- Driver ratings system (unless time allows as a stretch)

## 9. Assumptions Log (append as they're made; each needs a one-line "why")

- Money is integer poysha, not decimal — avoids float rounding in fare math.
- A "pool" can currently only be 2–3 passengers (Bullet's capacity is 3, driver seat
  excluded).
- One driver = one vehicle for MVP (no fleet management).
- Zones are a fixed enum, not free-text or geocoded addresses.
- *(more will be added here as we hit ambiguous spots — see `memory.md` for the
  full dated log; this section just mirrors the current, active assumptions.)*

## 10. Open Questions (resolve during build, log the resolution in `memory.md`)

- [ ] Exact matching/corridor rule — finalize once schema is in place
- [ ] Whether cancellation after `DRIVER_ARRIVED` incurs a fee (probably no for MVP)
- [ ] Whether pool discount is a flat amount or % of shared-distance-charge

## 11. Evaluation Criteria (from the brief, kept here as our own checklist)

Product understanding · Process/git discipline · Backend/DB integrity · Frontend
flows/states · Docker/Deploy reliability · Testing of risky behavior · Ownership
(can explain and change own code). "Following instructions" is explicitly scored.