import { Request, Response } from 'express';
import { toggleVehicleOnline, getRequestedRides } from '../services/driver.service';
import { acceptRideRequest } from '../services/pool.service';
import { advanceRide, cancelRide } from '../services/lifecycle.service';
import { RideStatus } from '../generated/prisma/enums';

export async function patchOnline(req: Request, res: Response): Promise<void> {
    const user = req.user!;

    if (user.role !== 'DRIVER') {
        res.status(403).json({ error: 'Only drivers can access this route' });
        return;
    }

    const { online } = req.body;

    if (typeof online !== 'boolean') {
        res.status(400).json({ error: 'Body must include { online: true|false }' });
        return;
    }

    const vehicle = await toggleVehicleOnline(user.userId, online);

    if (!vehicle) {
        res.status(403).json({ error: 'No vehicle registered for this driver' });
        return;
    }

    res.json({ vehicle });
}

export async function listRequests(req: Request, res: Response): Promise<void> {
    const user = req.user!;

    if (user.role !== 'DRIVER') {
        res.status(403).json({ error: 'Only drivers can access this route' });
        return;
    }

    const rides = await getRequestedRides();
    res.json({ rides });
}

export async function acceptRide(req: Request, res: Response): Promise<void> {
    const user = req.user!;

    if (user.role !== 'DRIVER') {
        res.status(403).json({ error: 'Only drivers can access this route' });
        return;
    }

    const rideRequestId = req.params.id as string;

    if (!rideRequestId) {
        res.status(400).json({ error: 'Ride request ID is required' });
        return;
    }

    const result = await acceptRideRequest(user.userId, rideRequestId);

    // Map error codes to HTTP status codes
    if ('code' in result) {
        const statusMap: Record<string, number> = {
            NO_VEHICLE: 403,
            NOT_FOUND: 404,
            ALREADY_MATCHED: 409,
            NOT_YOUR_VEHICLE: 403,
            NOT_POOLABLE: 400,
            NO_SEATS: 409,
        };
        const status = statusMap[result.code] || 500;
        res.status(status).json({ error: result.message });
        return;
    }

    res.json(result);
}

export async function arriveRide(req: Request, res: Response): Promise<void> {
    const user = req.user!;

    if (user.role !== 'DRIVER') {
        res.status(403).json({ error: 'Only drivers can access this route' });
        return;
    }

    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: 'Ride request ID is required' });
        return;
    }

    const result = await advanceRide(user.userId, id as string, RideStatus.DRIVER_ARRIVED);

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

export async function startRide(req: Request, res: Response): Promise<void> {
    const user = req.user!;

    if (user.role !== 'DRIVER') {
        res.status(403).json({ error: 'Only drivers can access this route' });
        return;
    }

    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: 'Ride request ID is required' });
        return;
    }

    const result = await advanceRide(user.userId, id as string, RideStatus.STARTED);

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

export async function completeRide(req: Request, res: Response): Promise<void> {
    const user = req.user!;

    if (user.role !== 'DRIVER') {
        res.status(403).json({ error: 'Only drivers can access this route' });
        return;
    }

    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: 'Ride request ID is required' });
        return;
    }

    const result = await advanceRide(user.userId, id as string, RideStatus.COMPLETED);

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

export async function cancelDriverRide(req: Request, res: Response): Promise<void> {
    const user = req.user!;

    if (user.role !== 'DRIVER') {
        res.status(403).json({ error: 'Only drivers can access this route' });
        return;
    }

    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: 'Ride request ID is required' });
        return;
    }

    const result = await cancelRide(user.userId, 'DRIVER', id as string);

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
