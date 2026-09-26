import { prisma } from '../lib/prisma';
import { RideStatus } from '../generated/prisma/enums';
import { isValidTransition } from '../utils/lifecycle';

export type LifecycleError =
    | { code: 'NOT_FOUND'; message: string }
    | { code: 'FORBIDDEN'; message: string }
    | { code: 'INVALID_TRANSITION'; message: string };

export interface LifecycleResult {
    rideRequest: {
        id: string;
        passengerId: string;
        pickupZone: string;
        destinationZone: string;
        seatsRequested: number;
        status: string;
        poolId: string | null;
    };
}

/**
 * Advances a ride request to a target status in the lifecycle.
 * Restricted to the driver owning the vehicle assigned to the ride.
 * Enforces the state machine and records StatusHistory with actor (userId + role).
 */
export async function advanceRide(
    driverId: string,
    rideRequestId: string,
    targetStatus: RideStatus,
): Promise<LifecycleResult | LifecycleError> {
    // 1. Fetch ride request with pool and vehicle
    const ride = await prisma.rideRequest.findUnique({
        where: { id: rideRequestId },
        include: {
            pool: {
                include: {
                    vehicle: true,
                },
            },
        },
    });

    if (!ride) {
        return { code: 'NOT_FOUND', message: 'Ride request not found' };
    }

    // 2. Ownership check: Driver must own the vehicle assigned to this ride's pool
    if (!ride.pool || ride.pool.vehicle?.driverId !== driverId) {
        return {
            code: 'FORBIDDEN',
            message: 'You do not have permission to advance this ride',
        };
    }

    // 3. State machine validation
    if (!isValidTransition(ride.status, targetStatus)) {
        return {
            code: 'INVALID_TRANSITION',
            message: `Cannot transition from ${ride.status} to ${targetStatus}`,
        };
    }

    // 4. Atomic transaction to update ride status, pool status, and record StatusHistory
    return await prisma.$transaction(async (tx) => {
        // Update ride request status
        const updatedRide = await tx.rideRequest.update({
            where: { id: rideRequestId },
            data: { status: targetStatus },
        });

        // Record StatusHistory with actor (userId + role)
        await tx.statusHistory.create({
            data: {
                rideRequestId,
                fromStatus: ride.status,
                toStatus: targetStatus,
                actor: `${driverId} (DRIVER)`,
                changedAt: new Date(),
            },
        });

        // Update pool status if applicable
        if (ride.poolId) {
            if (targetStatus === RideStatus.DRIVER_ARRIVED) {
                await tx.pool.update({
                    where: { id: ride.poolId },
                    data: { status: RideStatus.DRIVER_ARRIVED },
                });
            } else if (targetStatus === RideStatus.STARTED) {
                await tx.pool.update({
                    where: { id: ride.poolId },
                    data: { status: RideStatus.STARTED },
                });
            } else if (targetStatus === RideStatus.COMPLETED) {
                // If all rides in the pool are now COMPLETED or CANCELLED, mark pool COMPLETED
                const activeRides = await tx.rideRequest.findMany({
                    where: {
                        poolId: ride.poolId,
                        id: { not: rideRequestId },
                    },
                });

                const allCompletedOrCancelled = activeRides.every(
                    (r) => r.status === RideStatus.COMPLETED || r.status === RideStatus.CANCELLED,
                );

                if (allCompletedOrCancelled) {
                    await tx.pool.update({
                        where: { id: ride.poolId },
                        data: { status: RideStatus.COMPLETED },
                    });
                }
            }
        }

        return {
            rideRequest: {
                id: updatedRide.id,
                passengerId: updatedRide.passengerId,
                pickupZone: updatedRide.pickupZone,
                destinationZone: updatedRide.destinationZone,
                seatsRequested: updatedRide.seatsRequested,
                status: updatedRide.status,
                poolId: updatedRide.poolId,
            },
        };
    });
}

/**
 * Cancels a ride request.
 * Can be triggered by the passenger (owner) or the driver assigned to the ride's vehicle.
 * Permitted only from REQUESTED, MATCHED, or DRIVER_ARRIVED.
 * If ride was in a pool, decrements pool seatsOccupied.
 */
export async function cancelRide(
    userId: string,
    role: 'PASSENGER' | 'DRIVER',
    rideRequestId: string,
): Promise<LifecycleResult | LifecycleError> {
    const ride = await prisma.rideRequest.findUnique({
        where: { id: rideRequestId },
        include: {
            pool: {
                include: {
                    vehicle: true,
                },
            },
        },
    });

    if (!ride) {
        return { code: 'NOT_FOUND', message: 'Ride request not found' };
    }

    // Authorization: Passenger owns the ride, OR driver owns the vehicle assigned to the pool
    const isOwnerPassenger = role === 'PASSENGER' && ride.passengerId === userId;
    const isAssignedDriver = role === 'DRIVER' && ride.pool?.vehicle?.driverId === userId;

    if (!isOwnerPassenger && !isAssignedDriver) {
        return {
            code: 'FORBIDDEN',
            message: 'You do not have permission to cancel this ride',
        };
    }

    // State machine check
    if (!isValidTransition(ride.status, RideStatus.CANCELLED)) {
        return {
            code: 'INVALID_TRANSITION',
            message: `Cannot transition from ${ride.status} to CANCELLED`,
        };
    }

    return await prisma.$transaction(async (tx) => {
        // If ride was matched/arrived, release the seats from the pool
        if (
            ride.poolId &&
            (ride.status === RideStatus.MATCHED || ride.status === RideStatus.DRIVER_ARRIVED)
        ) {
            await tx.$executeRaw`
                UPDATE "Pool"
                SET "seatsOccupied" = GREATEST(0, "seatsOccupied" - ${ride.seatsRequested})
                WHERE id = ${ride.poolId}
            `;
        }

        // Update status to CANCELLED
        const updatedRide = await tx.rideRequest.update({
            where: { id: rideRequestId },
            data: { status: RideStatus.CANCELLED },
        });

        // Record StatusHistory with actor (userId + role)
        await tx.statusHistory.create({
            data: {
                rideRequestId,
                fromStatus: ride.status,
                toStatus: RideStatus.CANCELLED,
                actor: `${userId} (${role})`,
                changedAt: new Date(),
            },
        });

        return {
            rideRequest: {
                id: updatedRide.id,
                passengerId: updatedRide.passengerId,
                pickupZone: updatedRide.pickupZone,
                destinationZone: updatedRide.destinationZone,
                seatsRequested: updatedRide.seatsRequested,
                status: updatedRide.status,
                poolId: updatedRide.poolId,
            },
        };
    });
}
