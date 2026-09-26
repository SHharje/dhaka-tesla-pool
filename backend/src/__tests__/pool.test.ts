import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
// These must be created via vi.hoisted() so they're available inside the factory.

const mockPrismaUser = vi.hoisted(() => ({
    create: vi.fn(),
    findUnique: vi.fn(),
}));

const mockPrismaVehicle = vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
}));

const mockPrismaPool = vi.hoisted(() => ({
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
}));

const mockPrismaRideRequest = vi.hoisted(() => ({
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
}));

const mockPrismaFare = vi.hoisted(() => ({
    create: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
}));

const mockPrismaStatusHistory = vi.hoisted(() => ({
    create: vi.fn(),
}));

// Track $executeRaw calls for atomic seat updates
const mockExecuteRaw = vi.hoisted(() => vi.fn());

// The $transaction mock captures the transactional callback and runs it
// with a "tx" proxy that delegates to the same mocks but tracks $executeRaw.
const mockTransaction = vi.hoisted(() =>
    vi.fn(async (fn: (tx: any) => Promise<any>) => {
        const txProxy = {
            user: mockPrismaUser,
            vehicle: mockPrismaVehicle,
            pool: mockPrismaPool,
            rideRequest: mockPrismaRideRequest,
            fare: mockPrismaFare,
            statusHistory: mockPrismaStatusHistory,
            $executeRaw: mockExecuteRaw,
        };
        return fn(txProxy);
    }),
);

vi.mock('../lib/prisma', () => ({
    prisma: {
        user: mockPrismaUser,
        vehicle: mockPrismaVehicle,
        pool: mockPrismaPool,
        rideRequest: mockPrismaRideRequest,
        fare: mockPrismaFare,
        statusHistory: mockPrismaStatusHistory,
        $queryRaw: vi.fn(),
        $executeRaw: mockExecuteRaw,
        $transaction: mockTransaction,
    },
}));

import { app } from '../app';

const TEST_SECRET = 'test_jwt_secret';

function makeToken(userId: string, role: 'DRIVER' | 'PASSENGER') {
    return jwt.sign({ userId, role }, TEST_SECRET, { expiresIn: '1h' });
}

// ── Test Data ────────────────────────────────────────────────────────────────

const DRIVER_1_ID = 'driver-1';
const DRIVER_2_ID = 'driver-2';
const VEHICLE_1 = { id: 'v-1', driverId: DRIVER_1_ID, name: 'Bullet', capacity: 3, online: true };
const VEHICLE_2 = { id: 'v-2', driverId: DRIVER_2_ID, name: 'Flash', capacity: 3, online: true };

function makeRideRequest(overrides: Record<string, any> = {}) {
    return {
        id: 'rr-1',
        passengerId: 'passenger-1',
        pickupZone: 'BANANI',
        destinationZone: 'MOHAKHALI',
        seatsRequested: 1,
        status: 'REQUESTED',
        poolId: null,
        createdAt: new Date(),
        ...overrides,
    };
}

describe('Pool Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.JWT_SECRET = TEST_SECRET;
    });

    // ─── POST /rides ──────────────────────────────────────────────

    describe('POST /rides', () => {
        it('passenger can create a ride request with estimated fare', async () => {
            const fakeRide = {
                id: 'rr-new',
                passengerId: 'passenger-1',
                pickupZone: 'BANANI',
                destinationZone: 'MOHAKHALI',
                seatsRequested: 1,
                status: 'REQUESTED',
                createdAt: new Date(),
                fare: {
                    id: 'fare-1',
                    rideRequestId: 'rr-new',
                    baseFarePoysha: 2000,
                    distanceChargePoysha: 3000,
                    poolDiscountPoysha: 750,
                    totalPoysha: 4250,
                },
            };
            mockPrismaRideRequest.create.mockResolvedValue(fakeRide);

            const res = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('passenger-1', 'PASSENGER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'MOHAKHALI',
                    seats: 1,
                });

            expect(res.status).toBe(201);
            expect(res.body.rideRequest).toMatchObject({
                id: 'rr-new',
                pickupZone: 'BANANI',
                destinationZone: 'MOHAKHALI',
                seatsRequested: 1,
                status: 'REQUESTED',
            });
            expect(res.body.rideRequest.fare).toBeDefined();
            expect(res.body.rideRequest.fare.totalPoysha).toBeGreaterThan(0);
        });

        it('rejects drivers from creating rides (403)', async () => {
            const res = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('driver-1', 'DRIVER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'MOHAKHALI',
                    seats: 1,
                });

            expect(res.status).toBe(403);
        });

        it('rejects invalid pickupZone (400)', async () => {
            const res = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('passenger-1', 'PASSENGER')}`)
                .send({
                    pickupZone: 'INVALID_ZONE',
                    destinationZone: 'MOHAKHALI',
                    seats: 1,
                });

            expect(res.status).toBe(400);
        });

        it('rejects missing seats (400)', async () => {
            const res = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('passenger-1', 'PASSENGER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'MOHAKHALI',
                });

            expect(res.status).toBe(400);
        });
    });

    // ─── CORRIDOR POOLING ─────────────────────────────────────────

    describe('POST /driver/rides/:id/accept — corridor pooling', () => {
        it('TEST 1: Nusrat (Banani→Mohakhali) and Rafiq (Banani→Gulshan_1) can be pooled', async () => {
            // Setup: Nusrat's ride already exists and was accepted into a pool
            const nusratRide = makeRideRequest({
                id: 'rr-nusrat',
                passengerId: 'nusrat-id',
                pickupZone: 'BANANI',
                destinationZone: 'MOHAKHALI',
                seatsRequested: 1,
            });

            const rafiqRide = makeRideRequest({
                id: 'rr-rafiq',
                passengerId: 'rafiq-id',
                pickupZone: 'BANANI',
                destinationZone: 'GULSHAN_1',
                seatsRequested: 1,
                status: 'REQUESTED',
            });

            // Driver 1 has a vehicle
            mockPrismaVehicle.findUnique.mockResolvedValue(VEHICLE_1);

            // Rafiq's ride request is REQUESTED
            mockPrismaRideRequest.findUnique.mockResolvedValue(rafiqRide);

            // An existing pool already has Nusrat's ride (Banani → Mohakhali)
            mockPrismaPool.findMany.mockResolvedValue([
                {
                    id: 'pool-1',
                    vehicleId: VEHICLE_1.id,
                    status: 'MATCHED',
                    seatsOccupied: 1,
                    rideRequests: [
                        { pickupZone: 'BANANI', destinationZone: 'MOHAKHALI' },
                    ],
                },
            ]);

            // Atomic seat update succeeds (1 row updated)
            mockExecuteRaw.mockResolvedValue(1);

            // After update, pool has 2 seats occupied
            mockPrismaPool.findUniqueOrThrow.mockResolvedValue({
                id: 'pool-1',
                vehicleId: VEHICLE_1.id,
                status: 'MATCHED',
                seatsOccupied: 2,
            });

            mockPrismaRideRequest.update.mockResolvedValue({ ...rafiqRide, status: 'MATCHED', poolId: 'pool-1' });
            mockPrismaPool.update.mockResolvedValue({ id: 'pool-1', status: 'MATCHED' });
            mockPrismaStatusHistory.create.mockResolvedValue({});

            const res = await request(app)
                .post('/driver/rides/rr-rafiq/accept')
                .set('Authorization', `Bearer ${makeToken(DRIVER_1_ID, 'DRIVER')}`);

            expect(res.status).toBe(200);
            expect(res.body.pool.id).toBe('pool-1');
            expect(res.body.pool.seatsOccupied).toBe(2);
            expect(res.body.rideRequest.status).toBe('MATCHED');
        });

        it('TEST 2: request outside shared corridor is rejected from pooling — creates new pool', async () => {
            // Nusrat is in a pool (Banani → Mohakhali)
            // A request going Banani → UTTARA should NOT be poolable with that pool
            // (UTTARA is not in BANANI or MOHAKHALI corridor)
            const uttaraRide = makeRideRequest({
                id: 'rr-uttara',
                pickupZone: 'BANANI',
                destinationZone: 'UTTARA',
                seatsRequested: 1,
                status: 'REQUESTED',
            });

            mockPrismaVehicle.findUnique.mockResolvedValue(VEHICLE_1);
            mockPrismaRideRequest.findUnique.mockResolvedValue(uttaraRide);

            // Existing pool has rides going Banani → Mohakhali
            mockPrismaPool.findMany.mockResolvedValue([
                {
                    id: 'pool-1',
                    vehicleId: VEHICLE_1.id,
                    status: 'MATCHED',
                    seatsOccupied: 1,
                    rideRequests: [
                        { pickupZone: 'BANANI', destinationZone: 'MOHAKHALI' },
                    ],
                },
            ]);

            // The new pool creation path
            mockPrismaPool.create.mockResolvedValue({
                id: 'pool-new',
                vehicleId: VEHICLE_1.id,
                status: 'MATCHED',
                seatsOccupied: 0,
            });
            mockExecuteRaw.mockResolvedValue(1);
            mockPrismaRideRequest.update.mockResolvedValue({ ...uttaraRide, status: 'MATCHED', poolId: 'pool-new' });
            mockPrismaStatusHistory.create.mockResolvedValue({});

            const res = await request(app)
                .post('/driver/rides/rr-uttara/accept')
                .set('Authorization', `Bearer ${makeToken(DRIVER_1_ID, 'DRIVER')}`);

            expect(res.status).toBe(200);
            // Should be in a NEW pool, not pool-1
            expect(res.body.pool.id).toBe('pool-new');
            expect(res.body.pool.id).not.toBe('pool-1');
        });
    });

    // ─── CAPACITY ENFORCEMENT ─────────────────────────────────────

    describe('POST /driver/rides/:id/accept — capacity enforcement', () => {
        it('TEST 3: accepting requests that overflow capacity returns 409', async () => {
            // Vehicle has capacity 3, pool already has 2 seats occupied
            // Trying to add a 2-seat request should fail
            const bigRide = makeRideRequest({
                id: 'rr-big',
                seatsRequested: 2,
                status: 'REQUESTED',
            });

            mockPrismaVehicle.findUnique.mockResolvedValue(VEHICLE_1);
            mockPrismaRideRequest.findUnique.mockResolvedValue(bigRide);

            // Existing pool with 2 seats occupied
            mockPrismaPool.findMany.mockResolvedValue([
                {
                    id: 'pool-1',
                    vehicleId: VEHICLE_1.id,
                    status: 'MATCHED',
                    seatsOccupied: 2,
                    rideRequests: [
                        { pickupZone: 'BANANI', destinationZone: 'MOHAKHALI' },
                    ],
                },
            ]);

            // Atomic update fails — 0 rows affected because 2 + 2 > 3
            mockExecuteRaw.mockResolvedValue(0);

            const res = await request(app)
                .post('/driver/rides/rr-big/accept')
                .set('Authorization', `Bearer ${makeToken(DRIVER_1_ID, 'DRIVER')}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/not enough seats/i);
        });

        it('TEST 4: CONCURRENCY — two simultaneous accepts for last seat, exactly one succeeds', async () => {
            // Vehicle capacity = 3, pool has 2 seats occupied (1 remaining)
            // Two rides each requesting 1 seat fire concurrently

            const ride1 = makeRideRequest({
                id: 'rr-race-1',
                seatsRequested: 1,
                status: 'REQUESTED',
            });

            const ride2 = makeRideRequest({
                id: 'rr-race-2',
                seatsRequested: 1,
                status: 'REQUESTED',
            });

            // Both calls get the same vehicle
            mockPrismaVehicle.findUnique.mockResolvedValue(VEHICLE_1);

            // Each call finds the ride request in REQUESTED status
            mockPrismaRideRequest.findUnique
                .mockResolvedValueOnce(ride1)
                .mockResolvedValueOnce(ride2);

            // Both calls see the same pool with compatible rides
            mockPrismaPool.findMany.mockResolvedValue([
                {
                    id: 'pool-1',
                    vehicleId: VEHICLE_1.id,
                    status: 'MATCHED',
                    seatsOccupied: 2,
                    rideRequests: [
                        { pickupZone: 'BANANI', destinationZone: 'MOHAKHALI' },
                    ],
                },
            ]);

            // CRITICAL: The atomic $executeRaw should succeed for the first
            // accept (returns 1 = row updated) and fail for the second
            // (returns 0 = no rows updated because 3 + 1 > 3)
            mockExecuteRaw
                .mockResolvedValueOnce(1)  // First accept: success
                .mockResolvedValueOnce(0); // Second accept: capacity full

            // Mock remaining operations for the successful path
            mockPrismaPool.findUniqueOrThrow.mockResolvedValue({
                id: 'pool-1',
                vehicleId: VEHICLE_1.id,
                status: 'MATCHED',
                seatsOccupied: 3,
            });
            mockPrismaRideRequest.update.mockResolvedValue({});
            mockPrismaPool.update.mockResolvedValue({});
            mockPrismaStatusHistory.create.mockResolvedValue({});

            // Fire both accepts simultaneously
            const [res1, res2] = await Promise.all([
                request(app)
                    .post('/driver/rides/rr-race-1/accept')
                    .set('Authorization', `Bearer ${makeToken(DRIVER_1_ID, 'DRIVER')}`),
                request(app)
                    .post('/driver/rides/rr-race-2/accept')
                    .set('Authorization', `Bearer ${makeToken(DRIVER_1_ID, 'DRIVER')}`),
            ]);

            const statuses = [res1.status, res2.status].sort();

            // Exactly one 200 and one 409
            expect(statuses).toEqual([200, 409]);

            // The successful one should show seatsOccupied = 3 (capacity)
            const successRes = res1.status === 200 ? res1 : res2;
            expect(successRes.body.pool.seatsOccupied).toBe(3);

            // The failed one should show "Not enough seats" error
            const failRes = res1.status === 409 ? res1 : res2;
            expect(failRes.body.error).toMatch(/not enough seats/i);

            // seatsOccupied never exceeds capacity
            expect(successRes.body.pool.seatsOccupied).toBeLessThanOrEqual(VEHICLE_1.capacity);
        });
    });

    // ─── DRIVER OWNERSHIP ─────────────────────────────────────────

    describe('POST /driver/rides/:id/accept — driver ownership', () => {
        it('TEST 5: a driver cannot accept a ride onto another driver\'s vehicle', async () => {
            // Driver 2 tries to accept a ride, but their vehicle lookup returns
            // THEIR vehicle (vehicle-2), not vehicle-1 where the pool is.
            // Since pool matching is scoped to the authenticated driver's vehicle,
            // driver-2's accept will create a separate pool on their own vehicle,
            // NOT join driver-1's pool.

            const rideReq = makeRideRequest({
                id: 'rr-ownership',
                status: 'REQUESTED',
            });

            // Driver 2 has their own vehicle
            mockPrismaVehicle.findUnique.mockResolvedValue(VEHICLE_2);
            mockPrismaRideRequest.findUnique.mockResolvedValue(rideReq);

            // Driver 2's vehicle has NO existing pools
            mockPrismaPool.findMany.mockResolvedValue([]);

            // Creates a new pool on driver-2's vehicle
            mockPrismaPool.create.mockResolvedValue({
                id: 'pool-driver2',
                vehicleId: VEHICLE_2.id,
                status: 'MATCHED',
                seatsOccupied: 0,
            });
            mockExecuteRaw.mockResolvedValue(1);
            mockPrismaRideRequest.update.mockResolvedValue({});
            mockPrismaStatusHistory.create.mockResolvedValue({});

            const res = await request(app)
                .post('/driver/rides/rr-ownership/accept')
                .set('Authorization', `Bearer ${makeToken(DRIVER_2_ID, 'DRIVER')}`);

            expect(res.status).toBe(200);
            // The pool is on driver-2's vehicle, NOT driver-1's
            expect(res.body.pool.vehicleId).toBe(VEHICLE_2.id);
            expect(res.body.pool.vehicleId).not.toBe(VEHICLE_1.id);
        });

        it('driver without a vehicle gets 403', async () => {
            mockPrismaVehicle.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .post('/driver/rides/rr-1/accept')
                .set('Authorization', `Bearer ${makeToken('driver-no-car', 'DRIVER')}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/no vehicle/i);
        });

        it('passenger cannot accept rides (403)', async () => {
            const res = await request(app)
                .post('/driver/rides/rr-1/accept')
                .set('Authorization', `Bearer ${makeToken('passenger-1', 'PASSENGER')}`);

            expect(res.status).toBe(403);
        });

        it('accepting non-existent ride returns 404', async () => {
            mockPrismaVehicle.findUnique.mockResolvedValue(VEHICLE_1);
            mockPrismaRideRequest.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .post('/driver/rides/nonexistent/accept')
                .set('Authorization', `Bearer ${makeToken(DRIVER_1_ID, 'DRIVER')}`);

            expect(res.status).toBe(404);
        });

        it('accepting already-matched ride returns 409', async () => {
            mockPrismaVehicle.findUnique.mockResolvedValue(VEHICLE_1);
            mockPrismaRideRequest.findUnique.mockResolvedValue(
                makeRideRequest({ id: 'rr-already', status: 'MATCHED' }),
            );

            const res = await request(app)
                .post('/driver/rides/rr-already/accept')
                .set('Authorization', `Bearer ${makeToken(DRIVER_1_ID, 'DRIVER')}`);

            expect(res.status).toBe(409);
        });
    });
});
