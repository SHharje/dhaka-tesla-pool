import { prisma } from '../lib/prisma';
import { Zone } from '../generated/prisma/enums';
import { calculateFareBreakdown, FareBreakdown } from '../utils/fare';

export interface CreateRideInput {
    passengerId: string;
    pickupZone: Zone;
    destinationZone: Zone;
    seats: number;
}

export interface RideRequestResult {
    id: string;
    pickupZone: Zone;
    destinationZone: Zone;
    seatsRequested: number;
    status: string;
    createdAt: Date;
    fare: FareBreakdown;
}

/**
 * Creates a new ride request for an authenticated passenger.
 * Calculates an estimated fare (solo, poolDiscount=0) and persists both the RideRequest and Fare.
 */
export async function createRideRequest(input: CreateRideInput): Promise<RideRequestResult> {
    const fare = calculateFareBreakdown(input.pickupZone, input.destinationZone, false);

    const rideRequest = await prisma.rideRequest.create({
        data: {
            passengerId: input.passengerId,
            pickupZone: input.pickupZone,
            destinationZone: input.destinationZone,
            seatsRequested: input.seats,
            status: 'REQUESTED',
            fare: {
                create: {
                    baseFarePoysha: fare.baseFarePoysha,
                    distanceChargePoysha: fare.distanceChargePoysha,
                    poolDiscountPoysha: fare.poolDiscountPoysha,
                    totalPoysha: fare.totalPoysha,
                },
            },
            statusHistory: {
                create: {
                    fromStatus: null,
                    toStatus: 'REQUESTED',
                    actor: `${input.passengerId} (PASSENGER)`,
                },
            },
        },
        include: {
            fare: true,
        },
    });

    return {
        id: rideRequest.id,
        pickupZone: rideRequest.pickupZone,
        destinationZone: rideRequest.destinationZone,
        seatsRequested: rideRequest.seatsRequested,
        status: rideRequest.status,
        createdAt: rideRequest.createdAt,
        fare: {
            baseFarePoysha: fare.baseFarePoysha,
            distanceChargePoysha: fare.distanceChargePoysha,
            poolDiscountPoysha: fare.poolDiscountPoysha,
            totalPoysha: fare.totalPoysha,
        },
    };
}
