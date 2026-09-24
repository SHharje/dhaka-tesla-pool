import 'dotenv/config';
import { PrismaClient, Role, Zone, RideStatus } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
    const passwordHash = await bcrypt.hash('password123', 10);

    const jashim = await prisma.user.create({
        data: { name: 'Jashim', phone: '01700000001', passwordHash, role: Role.DRIVER },
    });
    const nusrat = await prisma.user.create({
        data: { name: 'Nusrat', phone: '01700000002', passwordHash, role: Role.PASSENGER },
    });
    const rafiq = await prisma.user.create({
        data: { name: 'Rafiq', phone: '01700000003', passwordHash, role: Role.PASSENGER },
    });
    await prisma.user.create({
        data: { name: 'Shirin', phone: '01700000004', passwordHash, role: Role.PASSENGER },
    });

    const bullet = await prisma.vehicle.create({
        data: { driverId: jashim.id, name: 'Bullet', capacity: 3, online: true },
    });

    const pool = await prisma.pool.create({
        data: { vehicleId: bullet.id, status: RideStatus.COMPLETED, seatsOccupied: 2 },
    });

    const nusratRide = await prisma.rideRequest.create({
        data: {
            passengerId: nusrat.id, poolId: pool.id,
            pickupZone: Zone.BANANI, destinationZone: Zone.MOHAKHALI,
            seatsRequested: 1, status: RideStatus.COMPLETED,
        },
    });
    const rafiqRide = await prisma.rideRequest.create({
        data: {
            passengerId: rafiq.id, poolId: pool.id,
            pickupZone: Zone.BANANI, destinationZone: Zone.GULSHAN_1,
            seatsRequested: 1, status: RideStatus.COMPLETED,
        },
    });

    await prisma.fare.createMany({
        data: [
            { rideRequestId: nusratRide.id, baseFarePoysha: 2000, distanceChargePoysha: 3000, poolDiscountPoysha: 750, totalPoysha: 4250 },
            { rideRequestId: rafiqRide.id, baseFarePoysha: 2000, distanceChargePoysha: 3000, poolDiscountPoysha: 750, totalPoysha: 4250 },
        ],
    });

    console.log('Seed complete');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());