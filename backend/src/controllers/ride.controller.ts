import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { createRideRequest } from '../services/ride.service';
import { cancelRide } from '../services/lifecycle.service';
import { Zone } from '../generated/prisma/enums';

const VALID_ZONES = Object.values(Zone);

export async function createRide(req: Request, res: Response): Promise<void> {
    const user = req.user!;

    if (user.role !== 'PASSENGER') {
        res.status(403).json({ error: 'Only passengers can create ride requests' });
        return;
    }

    const { pickupZone, destinationZone, seats } = req.body;

    // Validate pickupZone
    if (!pickupZone || !VALID_ZONES.includes(pickupZone)) {
        res.status(400).json({
            error: `pickupZone must be one of: ${VALID_ZONES.join(', ')}`,
        });
        return;
    }

    // Validate destinationZone
    if (!destinationZone || !VALID_ZONES.includes(destinationZone)) {
        res.status(400).json({
            error: `destinationZone must be one of: ${VALID_ZONES.join(', ')}`,
        });
        return;
    }

    // Validate seats
    if (!seats || typeof seats !== 'number' || seats < 1 || !Number.isInteger(seats)) {
        res.status(400).json({ error: 'seats must be a positive integer' });
        return;
    }

    const result = await createRideRequest({
        passengerId: user.userId,
        pickupZone,
        destinationZone,
        seats,
    });

    res.status(201).json({ rideRequest: result });
}

export async function getRide(req: Request, res: Response): Promise<void> {
    const user = req.user!;
    const id = req.params.id as string;

    if (!id) {
        res.status(400).json({ error: 'Ride request ID is required' });
        return;
    }

    const rideRequest = await prisma.rideRequest.findUnique({
        where: { id },
        include: {
            fare: true,
            pool: {
                include: {
                    vehicle: true,
                },
            },
        },
    });

    if (!rideRequest) {
        res.status(404).json({ error: 'Ride request not found' });
        return;
    }

    // Authorization: passenger can only view their own ride
    if (user.role === 'PASSENGER' && rideRequest.passengerId !== user.userId) {
        res.status(403).json({ error: 'Access denied: You can only view your own ride requests' });
        return;
    }

    // Authorization: driver can only view rides assigned to their vehicle
    if (user.role === 'DRIVER') {
        if (!rideRequest.pool || rideRequest.pool.vehicle?.driverId !== user.userId) {
            res.status(403).json({ error: 'Access denied: You can only view rides assigned to your vehicle' });
            return;
        }
    }

    res.json({
        rideRequest: {
            id: rideRequest.id,
            passengerId: rideRequest.passengerId,
            pickupZone: rideRequest.pickupZone,
            destinationZone: rideRequest.destinationZone,
            seatsRequested: rideRequest.seatsRequested,
            status: rideRequest.status,
            poolId: rideRequest.poolId,
            createdAt: rideRequest.createdAt,
            fare: rideRequest.fare ? {
                id: rideRequest.fare.id,
                baseFarePoysha: rideRequest.fare.baseFarePoysha,
                distanceChargePoysha: rideRequest.fare.distanceChargePoysha,
                poolDiscountPoysha: rideRequest.fare.poolDiscountPoysha,
                totalPoysha: rideRequest.fare.totalPoysha,
            } : null,
        },
    });
}

export async function cancelRideHandler(req: Request, res: Response): Promise<void> {
    const user = req.user!;
    const id = req.params.id as string;

    if (!id) {
        res.status(400).json({ error: 'Ride request ID is required' });
        return;
    }

    const result = await cancelRide(user.userId, user.role, id);

    if ('code' in result) {
        const statusMap: Record<string, number> = {
            NOT_FOUND: 404,
            FORBIDDEN: 403,
            INVALID_TRANSITION: 409,
        };
        res.status(statusMap[result.code] || 500).json({ error: result.message });
        return;
    }

    res.json(result);
}
