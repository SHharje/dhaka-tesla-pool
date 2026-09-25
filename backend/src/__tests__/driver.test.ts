import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// --- Hoisted mocks ---
const mockVehicle = vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
}));

const mockRideRequest = vi.hoisted(() => ({
    findMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
    prisma: {
        vehicle: mockVehicle,
        rideRequest: mockRideRequest,
        user: { create: vi.fn(), findUnique: vi.fn() },
        $queryRaw: vi.fn(),
    },
}));

import { app } from '../app';

const TEST_SECRET = 'test_jwt_secret';

function makeToken(userId: string, role: 'DRIVER' | 'PASSENGER') {
    return jwt.sign({ userId, role }, TEST_SECRET, { expiresIn: '1h' });
}

describe('Driver Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.JWT_SECRET = TEST_SECRET;
    });

    // ─── PATCH /driver/online ─────────────────────────────────────

    describe('PATCH /driver/online', () => {
        it('driver can toggle their own vehicle online', async () => {
            const vehicle = { id: 'v-1', driverId: 'driver-1', name: 'Model 3', online: false };
            mockVehicle.findUnique.mockResolvedValue(vehicle);
            mockVehicle.update.mockResolvedValue({ ...vehicle, online: true });

            const res = await request(app)
                .patch('/driver/online')
                .set('Authorization', `Bearer ${makeToken('driver-1', 'DRIVER')}`)
                .send({ online: true });

            expect(res.status).toBe(200);
            expect(res.body.vehicle.online).toBe(true);

            // Verify we queried/updated by the authenticated user's ID
            expect(mockVehicle.findUnique).toHaveBeenCalledWith({
                where: { driverId: 'driver-1' },
            });
            expect(mockVehicle.update).toHaveBeenCalledWith({
                where: { driverId: 'driver-1' },
                data: { online: true },
            });
        });

        it('driver can toggle their own vehicle offline', async () => {
            const vehicle = { id: 'v-1', driverId: 'driver-1', name: 'Model 3', online: true };
            mockVehicle.findUnique.mockResolvedValue(vehicle);
            mockVehicle.update.mockResolvedValue({ ...vehicle, online: false });

            const res = await request(app)
                .patch('/driver/online')
                .set('Authorization', `Bearer ${makeToken('driver-1', 'DRIVER')}`)
                .send({ online: false });

            expect(res.status).toBe(200);
            expect(res.body.vehicle.online).toBe(false);
        });

        it('rejects driver with no vehicle (403)', async () => {
            mockVehicle.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .patch('/driver/online')
                .set('Authorization', `Bearer ${makeToken('driver-no-car', 'DRIVER')}`)
                .send({ online: true });

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/no vehicle/i);
        });

        it('driver cannot toggle another driver\'s vehicle (403) — enforced by driverId lookup', async () => {
            // Driver-2 tries to go online, but service uses req.user.userId (driver-2),
            // and driver-2 has no vehicle → 403. The driverId-based lookup inherently
            // prevents cross-driver access.
            mockVehicle.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .patch('/driver/online')
                .set('Authorization', `Bearer ${makeToken('driver-2', 'DRIVER')}`)
                .send({ online: true });

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/no vehicle/i);
        });

        it('rejects PASSENGER role (403)', async () => {
            const res = await request(app)
                .patch('/driver/online')
                .set('Authorization', `Bearer ${makeToken('passenger-1', 'PASSENGER')}`)
                .send({ online: true });

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/only drivers/i);
        });

        it('rejects invalid body (400)', async () => {
            const res = await request(app)
                .patch('/driver/online')
                .set('Authorization', `Bearer ${makeToken('driver-1', 'DRIVER')}`)
                .send({ online: 'yes' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/online/i);
        });

        it('rejects unauthenticated request (401)', async () => {
            const res = await request(app)
                .patch('/driver/online')
                .send({ online: true });

            expect(res.status).toBe(401);
        });
    });

    // ─── GET /driver/requests ─────────────────────────────────────

    describe('GET /driver/requests', () => {
        it('returns only REQUESTED-status rides with passenger name', async () => {
            mockRideRequest.findMany.mockResolvedValue([
                {
                    id: 'rr-1',
                    pickupZone: 'GULSHAN_1',
                    destinationZone: 'BANANI',
                    seatsRequested: 2,
                    createdAt: new Date('2026-09-25T10:00:00Z'),
                    passenger: { name: 'Nusrat' },
                },
                {
                    id: 'rr-2',
                    pickupZone: 'DHANMONDI',
                    destinationZone: 'FARMGATE',
                    seatsRequested: 1,
                    createdAt: new Date('2026-09-25T10:05:00Z'),
                    passenger: { name: 'Rafiq' },
                },
            ]);

            const res = await request(app)
                .get('/driver/requests')
                .set('Authorization', `Bearer ${makeToken('driver-1', 'DRIVER')}`);

            expect(res.status).toBe(200);
            expect(res.body.rides).toHaveLength(2);

            // Verify shape — passenger name present, no phone/id leaked
            const ride = res.body.rides[0];
            expect(ride).toHaveProperty('passengerName');
            expect(ride).toHaveProperty('pickupZone');
            expect(ride).toHaveProperty('destinationZone');
            expect(ride).toHaveProperty('seatsRequested');
            expect(ride).not.toHaveProperty('passengerId');
            expect(ride).not.toHaveProperty('passenger');

            // Verify Prisma was queried with status filter
            expect(mockRideRequest.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { status: 'REQUESTED' },
                }),
            );
        });

        it('excludes matched/completed rides (only REQUESTED returned)', async () => {
            // The service passes { status: 'REQUESTED' } to Prisma,
            // so matched/completed are filtered at the DB level.
            mockRideRequest.findMany.mockResolvedValue([]);

            const res = await request(app)
                .get('/driver/requests')
                .set('Authorization', `Bearer ${makeToken('driver-1', 'DRIVER')}`);

            expect(res.status).toBe(200);
            expect(res.body.rides).toHaveLength(0);

            // Confirm the where clause only asks for REQUESTED
            const call = mockRideRequest.findMany.mock.calls[0][0];
            expect(call.where).toEqual({ status: 'REQUESTED' });
        });

        it('rejects PASSENGER role (403)', async () => {
            const res = await request(app)
                .get('/driver/requests')
                .set('Authorization', `Bearer ${makeToken('passenger-1', 'PASSENGER')}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/only drivers/i);
        });

        it('rejects unauthenticated request (401)', async () => {
            const res = await request(app).get('/driver/requests');

            expect(res.status).toBe(401);
        });
    });
});
