# Rules — Dhaka Tesla Pool

> **Status:** Living document — this is the single source of truth for business logic.
> Code must match this file. If code and this file disagree, one of them is wrong;
> fix it and log why in `memory.md`.

## 1. Ride Lifecycle — State Machine

| From | To | Trigger | Who |
|---|---|---|---|
| — | `REQUESTED` | passenger submits a ride request | passenger |
| `REQUESTED` | `MATCHED` | driver accepts (solo or pooled) | driver |
| `REQUESTED` | `CANCELLED` | passenger cancels before match | passenger |
| `MATCHED` | `DRIVER_ARRIVED` | driver marks arrival | driver |
| `MATCHED` | `CANCELLED` | passenger or driver cancels | either |
| `DRIVER_ARRIVED` | `STARTED` | driver starts trip | driver |
| `DRIVER_ARRIVED` | `CANCELLED` | passenger no-show / cancel | either |
| `STARTED` | `COMPLETED` | driver marks complete | driver |

Rules:
- No transition may skip a stage (`REQUESTED` → `STARTED` directly is invalid).
- Once `STARTED`, cancellation is no longer allowed for either party (MVP simplification —
  revisit if time allows).
- Every transition is written to `STATUS_HISTORY` with actor + timestamp — this is
  the "hold onto history to explain what happened" requirement.

## 2. Pool & Capacity Rules

- `seats_occupied` on a `POOL` may never exceed the vehicle's `capacity`.
- A pool is created the moment a driver accepts a request; a second request can join
  the same pool if the matching rule (below) says yes AND there's remaining seat
  capacity.
- Enforced at the DB layer via the atomic conditional update (see `architecture.md`
  §5), not just application-layer checks — application checks are a UX nicety,
  the DB constraint is what actually prevents overbooking under concurrency.

## 3. Matching Rule (current version — see `memory.md` if this changes)

Two `REQUESTED` rides are poolable if:
1. Same `pickup_zone`, AND
2. Their `destination_zone`s are both members of the same predefined "corridor" set
   (a hardcoded map, e.g. `Banani → [Mohakhali, Gulshan-1, Gulshan-2]`)

Applied to the story: Nusrat (Banani→Mohakhali) and Rafiq (Banani→Gulshan-1) share a
pickup zone and both destinations sit in Banani's corridor set → poolable. Shirin
requesting a third seat is only accepted if `seats_occupied + shirin.seats ≤ 3`.

## 4. Fare Calculation

```
passengerFare = baseFare + distanceCharge − poolDiscount
```

- **baseFare**: flat constant per ride, e.g. 20 taka = 2000 poysha
- **distanceCharge**: constant-per-zone-hop lookup table (since we're not doing real
  distance) — e.g. adjacent zones = 1 hop = 3000 poysha, corridor-but-not-adjacent =
  2 hops = 5000 poysha
- **poolDiscount**: applied only if `pool.seats_occupied > 1` at fare-lock time —
  flat 25% of `distanceCharge`, applied per pooled passenger individually (not split
  evenly — each passenger's own distanceCharge gets its own discount)

**Worked example (Nusrat & Rafiq, pooled):**
- Nusrat: Banani→Mohakhali = 1 hop → base 2000 + distance 3000 − discount 750 = **4250 poysha (৳42.50)**
- Rafiq: Banani→Gulshan-1 = 1 hop → base 2000 + distance 3000 − discount 750 = **4250 poysha (৳42.50)**

Money is stored as **integer poysha** throughout the DB and business logic — only
converted to taka (`/100`) at display time — to avoid floating-point rounding errors
compounding across many fare calculations.

## 5. Cancellation Rules

- Allowed in `REQUESTED`, `MATCHED`, `DRIVER_ARRIVED`. Not allowed once `STARTED`.
- Cancelling a pooled ride removes only that passenger's seat from the pool
  (`seats_occupied -= n`) — does not cancel the other passenger's ride.

## 6. Authorization / Ownership Rules

- A passenger can only read/modify their **own** ride requests and fares.
- A driver can only read/modify rides assigned to **their own** vehicle.
- Enforced server-side on every request (never trust a client-supplied ID alone —
  always cross-check against the authenticated user from the JWT).

## 7. Concurrency Rule

See `architecture.md` §5 for the mechanism. Rule stated plainly: **seat capacity is
enforced by the database via an atomic conditional update inside a transaction**, not
by an application-layer "check then write" (which is exactly what breaks under a
race like Nusrat vs. Shirin). At larger scale, this would move toward
optimistic-locking with version numbers or a dedicated matching queue — noted as a
"what I'd change" talking point for the interview.

## 8. Validation Rules

- `seats_requested` must be `1 ≤ n ≤ vehicle.capacity`.
- Pickup/destination zones must be from the fixed enum list.
- A driver must be `online` to receive/accept requests.
- Password/auth: standard bcrypt hash, JWT expiry (e.g. 24h).