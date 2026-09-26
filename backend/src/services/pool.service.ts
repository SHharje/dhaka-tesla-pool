import { prisma } from '../lib/prisma';
import { Zone } from '../generated/prisma/enums';
import { areInSameCorridor } from '../utils/corridor';
import { calculateFareBreakdown } from '../utils/fare';

/**
 * POOL ACCEPTANCE LOGIC:
 *
 * When a driver accepts a ride request, we:
 * 1. Verify the driver owns a vehicle
 * 2. Verify the ride request exists and is in REQUESTED status
 * 3. Look for an existing ACTIVE pool on the driver's vehicle where:
 *    a. The pool shares the same pickupZone as the request
 *    b. At least one existing request in the pool has a destinationZone in the
 *       same corridor as the new request's destinationZone
 *    c. There are enough seats remaining
 * 4. If a compatible pool exists → join it (atomic seat update)
 * 5. If no compatible pool exists → create a new pool
 *
 * CRITICAL: Seat capacity is enforced via a SINGLE ATOMIC CONDITIONAL UPDATE:
 *   UPDATE "Pool" SET "seatsOccupied" = "seatsOccupied" + $seats
 *   WHERE id = $poolId AND "seatsOccupied" + $seats <= $capacity
 * If 0 rows updated → 409 Conflict (race condition or full)
 */

export interface AcceptResult {
    pool: {
        id: string;
        vehicleId: string;
        seatsOccupied: number;
        status: string;
    };
    rideRequest: {
        id: string;
        status: string;
    };
}

export type AcceptError =
    | { code: 'NO_VEHICLE'; message: string }
    | { code: 'NOT_FOUND'; message: string }
    | { code: 'ALREADY_MATCHED'; message: string }
    | { code: 'NOT_YOUR_VEHICLE'; message: string }
    | { code: 'NOT_POOLABLE'; message: string }
    | { code: 'NO_SEATS'; message: string };

export async function acceptRideRequest(
    driverId: string,
    rideRequestId: string,
): Promise<AcceptResult | AcceptError> {
    // 1. Get the driver's vehicle
    const vehicle = await prisma.vehicle.findUnique({
        where: { driverId },
    });

    if (!vehicle) {
        return { code: 'NO_VEHICLE', message: 'No vehicle registered for this driver' };
    }

    // 2. Get the ride request
    const rideRequest = await prisma.rideRequest.findUnique({
        where: { id: rideRequestId },
    });

    if (!rideRequest) {
        return { code: 'NOT_FOUND', message: 'Ride request not found' };
    }

    if (rideRequest.status !== 'REQUESTED') {
        return { code: 'ALREADY_MATCHED', message: `Cannot transition from ${rideRequest.status} to MATCHED` };
    }

    // 3. Look for an existing compatible pool on this driver's vehicle.
    //    A pool is compatible if:
    //    - It's on the driver's own vehicle (enforced by vehicleId filter)
    //    - It's in REQUESTED or MATCHED status (active pool, not completed/cancelled)
    //    - It shares pickupZone with the new request
    //    - At least one existing ride in the pool has a destinationZone in the same corridor
    const existingPools = await prisma.pool.findMany({
        where: {
            vehicleId: vehicle.id,
            status: { in: ['REQUESTED', 'MATCHED'] },
        },
        include: {
            rideRequests: {
                select: {
                    pickupZone: true,
                    destinationZone: true,
                },
            },
        },
    });

    let compatiblePoolId: string | null = null;

    for (const pool of existingPools) {
        // Check if any existing ride in this pool shares pickupZone
        // AND has a destination in the same corridor
        const isCompatible = pool.rideRequests.some(
            (existingRide) =>
                existingRide.pickupZone === rideRequest.pickupZone &&
                areInSameCorridor(existingRide.destinationZone, rideRequest.destinationZone),
        );

        if (isCompatible) {
            compatiblePoolId = pool.id;
            break;
        }
    }

    if (compatiblePoolId) {
        // ── JOIN EXISTING POOL ───────────────────────────────────────
        // CRITICAL: Atomic conditional update to prevent exceeding capacity.
        // This is a single SQL statement — no read-then-write race.
        return await joinExistingPool(
            compatiblePoolId,
            vehicle.id,
            vehicle.capacity,
            rideRequest,
            driverId,
        );
    } else {
        // ── CREATE NEW POOL ──────────────────────────────────────────
        // Check if the new request even fits in the vehicle
        if (rideRequest.seatsRequested > vehicle.capacity) {
            return { code: 'NO_SEATS', message: 'Not enough seats available' };
        }

        return await createNewPool(
            vehicle.id,
            vehicle.capacity,
            rideRequest,
            driverId,
        );
    }
}

/**
 * Atomically join an existing pool using a conditional UPDATE.
 * The UPDATE only succeeds if seatsOccupied + requestedSeats <= capacity.
 * If 0 rows updated, the pool is full (or was filled by a concurrent request).
 */
async function joinExistingPool(
    poolId: string,
    vehicleId: string,
    vehicleCapacity: number,
    rideRequest: { id: string; pickupZone: Zone; destinationZone: Zone; seatsRequested: number },
    driverId: string,
): Promise<AcceptResult | AcceptError> {
    return await prisma.$transaction(async (tx) => {
        // ATOMIC conditional update — the WHERE clause prevents overflow.
        // This is the ONLY way to safely enforce capacity under concurrency.
        const updatedCount: number = await tx.$executeRaw`
            UPDATE "Pool"
            SET "seatsOccupied" = "seatsOccupied" + ${rideRequest.seatsRequested}
            WHERE id = ${poolId}
              AND "seatsOccupied" + ${rideRequest.seatsRequested} <= ${vehicleCapacity}
        `;

        if (updatedCount === 0) {
            // Either pool is full or was filled by a concurrent accept
            return { code: 'NO_SEATS' as const, message: 'Not enough seats available' };
        }

        // Link ride request to the pool and set status to MATCHED
        await tx.rideRequest.update({
            where: { id: rideRequest.id },
            data: {
                poolId,
                status: 'MATCHED',
            },
        });

        // Update pool status to MATCHED
        await tx.pool.update({
            where: { id: poolId },
            data: { status: 'MATCHED' },
        });

        // Write status history
        await tx.statusHistory.create({
            data: {
                rideRequestId: rideRequest.id,
                fromStatus: 'REQUESTED',
                toStatus: 'MATCHED',
                actor: `${driverId} (DRIVER)`,
            },
        });

        // Fetch updated pool for response
        const pool = await tx.pool.findUniqueOrThrow({
            where: { id: poolId },
        });

        // Recalculate / finalize fares for all rides in this pool
        // A pool discount applies ONLY if seatsOccupied > 1 at calculation time
        const isPooled = pool.seatsOccupied > 1;

        // Fetch all rides in this pool to update their fares
        const poolRides = await tx.rideRequest.findMany({
            where: { poolId },
        });

        const ridesToUpdate = poolRides && poolRides.length > 0 ? poolRides : [rideRequest];
        for (const ride of ridesToUpdate) {
            const fareBreakdown = calculateFareBreakdown(
                ride.pickupZone,
                ride.destinationZone,
                isPooled,
            );
            await tx.fare.upsert({
                where: { rideRequestId: ride.id },
                create: {
                    rideRequestId: ride.id,
                    baseFarePoysha: fareBreakdown.baseFarePoysha,
                    distanceChargePoysha: fareBreakdown.distanceChargePoysha,
                    poolDiscountPoysha: fareBreakdown.poolDiscountPoysha,
                    totalPoysha: fareBreakdown.totalPoysha,
                },
                update: {
                    baseFarePoysha: fareBreakdown.baseFarePoysha,
                    distanceChargePoysha: fareBreakdown.distanceChargePoysha,
                    poolDiscountPoysha: fareBreakdown.poolDiscountPoysha,
                    totalPoysha: fareBreakdown.totalPoysha,
                },
            });
        }

        return {
            pool: {
                id: pool.id,
                vehicleId: pool.vehicleId,
                seatsOccupied: pool.seatsOccupied,
                status: pool.status,
            },
            rideRequest: {
                id: rideRequest.id,
                status: 'MATCHED',
            },
        };
    });
}

/**
 * Creates a new pool with the ride request as its first member.
 * Uses an atomic conditional approach: creates pool, then does an atomic
 * seat update to make the pattern consistent.
 */
async function createNewPool(
    vehicleId: string,
    vehicleCapacity: number,
    rideRequest: { id: string; pickupZone: Zone; destinationZone: Zone; seatsRequested: number },
    driverId: string,
): Promise<AcceptResult | AcceptError> {
    return await prisma.$transaction(async (tx) => {
        // Create the pool with seatsOccupied = 0 initially
        const pool = await tx.pool.create({
            data: {
                vehicleId,
                status: 'MATCHED',
                seatsOccupied: 0,
            },
        });

        // Atomically set the seats using the same conditional pattern
        // (WHERE seatsOccupied + requestedSeats <= capacity)
        const updatedCount: number = await tx.$executeRaw`
            UPDATE "Pool"
            SET "seatsOccupied" = "seatsOccupied" + ${rideRequest.seatsRequested}
            WHERE id = ${pool.id}
              AND "seatsOccupied" + ${rideRequest.seatsRequested} <= ${vehicleCapacity}
        `;

        if (updatedCount === 0) {
            return { code: 'NO_SEATS' as const, message: 'Not enough seats available' };
        }

        // Link ride request to pool and set status
        await tx.rideRequest.update({
            where: { id: rideRequest.id },
            data: {
                poolId: pool.id,
                status: 'MATCHED',
            },
        });

        // Write status history
        await tx.statusHistory.create({
            data: {
                rideRequestId: rideRequest.id,
                fromStatus: 'REQUESTED',
                toStatus: 'MATCHED',
                actor: `${driverId} (DRIVER)`,
            },
        });

        // Recalculate / finalize fare for this newly pooled ride
        // Pool discount applies ONLY if seatsOccupied > 1 at calculation time
        const isPooled = rideRequest.seatsRequested > 1;
        const fareBreakdown = calculateFareBreakdown(
            rideRequest.pickupZone,
            rideRequest.destinationZone,
            isPooled,
        );

        await tx.fare.upsert({
            where: { rideRequestId: rideRequest.id },
            create: {
                rideRequestId: rideRequest.id,
                baseFarePoysha: fareBreakdown.baseFarePoysha,
                distanceChargePoysha: fareBreakdown.distanceChargePoysha,
                poolDiscountPoysha: fareBreakdown.poolDiscountPoysha,
                totalPoysha: fareBreakdown.totalPoysha,
            },
            update: {
                baseFarePoysha: fareBreakdown.baseFarePoysha,
                distanceChargePoysha: fareBreakdown.distanceChargePoysha,
                poolDiscountPoysha: fareBreakdown.poolDiscountPoysha,
                totalPoysha: fareBreakdown.totalPoysha,
            },
        });

        return {
            pool: {
                id: pool.id,
                vehicleId,
                seatsOccupied: rideRequest.seatsRequested,
                status: 'MATCHED',
            },
            rideRequest: {
                id: rideRequest.id,
                status: 'MATCHED',
            },
        };
    });
}
