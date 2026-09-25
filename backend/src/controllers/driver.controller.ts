import { Request, Response } from 'express';
import { toggleVehicleOnline, getRequestedRides } from '../services/driver.service';

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
