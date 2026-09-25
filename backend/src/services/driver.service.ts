import { prisma } from '../lib/prisma';

export async function toggleVehicleOnline(driverId: string, online: boolean) {
    const vehicle = await prisma.vehicle.findUnique({
        where: { driverId },
    });

    if (!vehicle) {
        return null;
    }

    const updated = await prisma.vehicle.update({
        where: { driverId },
        data: { online },
    });

    return {
        id: updated.id,
        name: updated.name,
        online: updated.online,
    };
}

export async function getRequestedRides() {
    const rides = await prisma.rideRequest.findMany({
        where: { status: 'REQUESTED' },
        select: {
            id: true,
            pickupZone: true,
            destinationZone: true,
            seatsRequested: true,
            createdAt: true,
            passenger: {
                select: { name: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    return rides.map((r) => ({
        id: r.id,
        passengerName: r.passenger.name,
        pickupZone: r.pickupZone,
        destinationZone: r.destinationZone,
        seatsRequested: r.seatsRequested,
        createdAt: r.createdAt,
    }));
}
