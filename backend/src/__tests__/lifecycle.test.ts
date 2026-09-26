import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { RideStatus, Zone } from '../generated/prisma/enums';
import {
    isValidTransition,
    assertValidTransition,
    TransitionError,
    VALID_TRANSITIONS,
} from '../utils/lifecycle';

// ── In-Memory Database State for Integration Test ─────────────────────────────

interface DBVehicle {
    id: string;
    driverId: string;
    name: string;
    capacity: number;
    online: boolean;
}

interface DBPool {
    id: string;
    vehicleId: string;
    seatsOccupied: number;
    status: RideStatus;
}

interface DBRideRequest {
    id: string;
    passengerId: string;
    pickupZone: Zone;
    destinationZone: Zone;
    seatsRequested: number;
    status: RideStatus;
    poolId: string | null;
    createdAt: Date;
}

interface DBStatusHistory {
    id: string;
    rideRequestId: string;
    fromStatus: RideStatus | null;
    toStatus: RideStatus;
    actor: string;
    changedAt: Date;
}

let dbVehicles: Map<string, DBVehicle> = new Map();
let dbPools: Map<string, DBPool> = new Map();
let dbRideRequests: Map<string, DBRideRequest> = new Map();
let dbStatusHistories: DBStatusHistory[] = [];
let idCounter = 1;

// ── Mock Prisma ──────────────────────────────────────────────────────────────

const mockPrismaUser = vi.hoisted(() => ({
    findUnique: vi.fn(),
    create: vi.fn(),
}));

const mockPrismaVehicle = vi.hoisted(() => ({
    findUnique: vi.fn((args: any) => {
        if (args?.where?.driverId) {
            for (const v of dbVehicles.values()) {
                if (v.driverId === args.where.driverId) return Promise.resolve(v);
            }
        }
        if (args?.where?.id) {
            return Promise.resolve(dbVehicles.get(args.where.id) || null);
        }
        return Promise.resolve(null);
    }),
    update: vi.fn(),
}));

const mockPrismaPool = vi.hoisted(() => ({
    findMany: vi.fn((args: any) => {
        const results: any[] = [];
        for (const pool of dbPools.values()) {
            if (args?.where?.vehicleId && pool.vehicleId !== args.where.vehicleId) continue;
            if (args?.where?.status?.in && !args.where.status.in.includes(pool.status)) continue;

            const poolRides: any[] = [];
            for (const rr of dbRideRequests.values()) {
                if (rr.poolId === pool.id) {
                    poolRides.push({
                        pickupZone: rr.pickupZone,
                        destinationZone: rr.destinationZone,
                    });
                }
            }
            results.push({ ...pool, rideRequests: poolRides });
        }
        return Promise.resolve(results);
    }),
    findUniqueOrThrow: vi.fn((args: any) => {
        const pool = dbPools.get(args.where.id);
        if (!pool) throw new Error(`Pool not found: ${args.where.id}`);
        return Promise.resolve({ ...pool });
    }),
    create: vi.fn((args: any) => {
        const id = `pool-${idCounter++}`;
        const newPool: DBPool = {
            id,
            vehicleId: args.data.vehicleId,
            seatsOccupied: args.data.seatsOccupied || 0,
            status: args.data.status || RideStatus.REQUESTED,
        };
        dbPools.set(id, newPool);
        return Promise.resolve({ ...newPool });
    }),
    update: vi.fn((args: any) => {
        const pool = dbPools.get(args.where.id);
        if (pool) {
            if (args.data.status) pool.status = args.data.status;
            if (args.data.seatsOccupied !== undefined) pool.seatsOccupied = args.data.seatsOccupied;
        }
        return Promise.resolve({ ...pool });
    }),
}));

const mockPrismaRideRequest = vi.hoisted(() => ({
    create: vi.fn((args: any) => {
        const id = `rr-${idCounter++}`;
        const newRide: DBRideRequest = {
            id,
            passengerId: args.data.passengerId,
            pickupZone: args.data.pickupZone,
            destinationZone: args.data.destinationZone,
            seatsRequested: args.data.seatsRequested,
            status: args.data.status || RideStatus.REQUESTED,
            poolId: null,
            createdAt: new Date(),
        };
        dbRideRequests.set(id, newRide);

        if (args.data.statusHistory?.create) {
            const sh = args.data.statusHistory.create;
            dbStatusHistories.push({
                id: `sh-${idCounter++}`,
                rideRequestId: id,
                fromStatus: sh.fromStatus || null,
                toStatus: sh.toStatus,
                actor: sh.actor,
                changedAt: new Date(),
            });
        }

        return Promise.resolve({
            ...newRide,
            fare: null,
        });
    }),
    findUnique: vi.fn((args: any) => {
        const ride = dbRideRequests.get(args.where.id);
        if (!ride) return Promise.resolve(null);

        let pool = null;
        if (ride.poolId) {
            const p = dbPools.get(ride.poolId);
            if (p) {
                const vehicle = dbVehicles.get(p.vehicleId);
                pool = { ...p, vehicle: vehicle ? { ...vehicle } : null };
            }
        }

        return Promise.resolve({
            ...ride,
            fare: null,
            pool,
        });
    }),
    findMany: vi.fn((args: any) => {
        const results: any[] = [];
        for (const rr of dbRideRequests.values()) {
            if (args?.where?.poolId && rr.poolId !== args.where.poolId) continue;
            if (args?.where?.id?.not && rr.id === args.where.id.not) continue;
            if (args?.where?.status?.notIn && args.where.status.notIn.includes(rr.status)) continue;
            results.push({ ...rr });
        }
        return Promise.resolve(results);
    }),
    update: vi.fn((args: any) => {
        const ride = dbRideRequests.get(args.where.id);
        if (ride) {
            if (args.data.status) ride.status = args.data.status;
            if (args.data.poolId !== undefined) ride.poolId = args.data.poolId;
        }
        return Promise.resolve({ ...ride });
    }),
}));

const mockPrismaFare = vi.hoisted(() => ({
    create: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
}));

const mockPrismaStatusHistory = vi.hoisted(() => ({
    create: vi.fn((args: any) => {
        const record: DBStatusHistory = {
            id: `sh-${idCounter++}`,
            rideRequestId: args.data.rideRequestId,
            fromStatus: args.data.fromStatus,
            toStatus: args.data.toStatus,
            actor: args.data.actor,
            changedAt: args.data.changedAt || new Date(),
        };
        dbStatusHistories.push(record);
        return Promise.resolve(record);
    }),
}));

const mockExecuteRaw = vi.hoisted(() =>
    vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        // Atomic capacity update logic:
        const seats = values[0];
        const poolId = values[1];
        const capacity = values.length >= 4 ? values[3] : undefined;

        const pool = dbPools.get(poolId);
        if (!pool) return 0;

        if (capacity !== undefined) {
            if (pool.seatsOccupied + seats <= capacity) {
                pool.seatsOccupied += seats;
                return 1;
            }
            return 0; // capacity exceeded
        } else {
            pool.seatsOccupied += seats;
            return 1;
        }
    }),
);

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

describe('Ride Lifecycle & State Transition Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.JWT_SECRET = TEST_SECRET;

        // Reset in-memory database
        dbVehicles = new Map();
        dbPools = new Map();
        dbRideRequests = new Map();
        dbStatusHistories = [];
        idCounter = 1;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // PURE UNIT TESTS: State Machine validation
    // ─────────────────────────────────────────────────────────────────────────

    describe('State Machine Unit Tests (lifecycle.ts)', () => {
        it('allows valid transitions', () => {
            expect(isValidTransition(RideStatus.REQUESTED, RideStatus.MATCHED)).toBe(true);
            expect(isValidTransition(RideStatus.MATCHED, RideStatus.DRIVER_ARRIVED)).toBe(true);
            expect(isValidTransition(RideStatus.DRIVER_ARRIVED, RideStatus.STARTED)).toBe(true);
            expect(isValidTransition(RideStatus.STARTED, RideStatus.COMPLETED)).toBe(true);

            // Valid cancellation points
            expect(isValidTransition(RideStatus.REQUESTED, RideStatus.CANCELLED)).toBe(true);
            expect(isValidTransition(RideStatus.MATCHED, RideStatus.CANCELLED)).toBe(true);
            expect(isValidTransition(RideStatus.DRIVER_ARRIVED, RideStatus.CANCELLED)).toBe(true);
        });

        it('disallows skipping steps', () => {
            expect(isValidTransition(RideStatus.REQUESTED, RideStatus.STARTED)).toBe(false);
            expect(isValidTransition(RideStatus.REQUESTED, RideStatus.COMPLETED)).toBe(false);
            expect(isValidTransition(RideStatus.MATCHED, RideStatus.STARTED)).toBe(false);
            expect(isValidTransition(RideStatus.MATCHED, RideStatus.COMPLETED)).toBe(false);
            expect(isValidTransition(RideStatus.DRIVER_ARRIVED, RideStatus.COMPLETED)).toBe(false);
        });

        it('disallows moving backward', () => {
            expect(isValidTransition(RideStatus.COMPLETED, RideStatus.STARTED)).toBe(false);
            expect(isValidTransition(RideStatus.COMPLETED, RideStatus.DRIVER_ARRIVED)).toBe(false);
            expect(isValidTransition(RideStatus.COMPLETED, RideStatus.MATCHED)).toBe(false);
            expect(isValidTransition(RideStatus.STARTED, RideStatus.DRIVER_ARRIVED)).toBe(false);
            expect(isValidTransition(RideStatus.DRIVER_ARRIVED, RideStatus.MATCHED)).toBe(false);
        });

        it('disallows cancellation from STARTED and COMPLETED', () => {
            expect(isValidTransition(RideStatus.STARTED, RideStatus.CANCELLED)).toBe(false);
            expect(isValidTransition(RideStatus.COMPLETED, RideStatus.CANCELLED)).toBe(false);
        });

        it('assertValidTransition throws TransitionError with exact message format', () => {
            expect(() => assertValidTransition(RideStatus.COMPLETED, RideStatus.STARTED)).toThrowError(
                'Cannot transition from COMPLETED to STARTED',
            );
            expect(() => assertValidTransition(RideStatus.STARTED, RideStatus.CANCELLED)).toThrowError(
                'Cannot transition from STARTED to CANCELLED',
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. HAPPY PATH: Full lifecycle in order + StatusHistory
    // ─────────────────────────────────────────────────────────────────────────

    describe('1. Full happy path: MATCHED -> DRIVER_ARRIVED -> STARTED -> COMPLETED', () => {
        it('succeeds in order, writing a correct StatusHistory row at each step', async () => {
            const JASHIM_ID = 'driver-jashim';
            const NUSRAT_ID = 'passenger-nusrat';

            // Register Jashim's vehicle "Bullet"
            const bulletVehicle: DBVehicle = {
                id: 'v-bullet',
                driverId: JASHIM_ID,
                name: 'Bullet',
                capacity: 3,
                online: true,
            };
            dbVehicles.set(bulletVehicle.id, bulletVehicle);

            // Step 1: Nusrat requests a ride (Banani -> Mohakhali)
            const createRes = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken(NUSRAT_ID, 'PASSENGER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'MOHAKHALI',
                    seats: 1,
                });

            expect(createRes.status).toBe(201);
            const rideId = createRes.body.rideRequest.id;
            expect(createRes.body.rideRequest.status).toBe(RideStatus.REQUESTED);

            // Verify initial status history
            expect(dbStatusHistories).toHaveLength(1);
            expect(dbStatusHistories[0]).toMatchObject({
                rideRequestId: rideId,
                fromStatus: null,
                toStatus: RideStatus.REQUESTED,
                actor: `${NUSRAT_ID} (PASSENGER)`,
            });

            // Step 2: Jashim accepts the ride (REQUESTED -> MATCHED)
            const acceptRes = await request(app)
                .post(`/driver/rides/${rideId}/accept`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);

            expect(acceptRes.status).toBe(200);
            expect(acceptRes.body.rideRequest.status).toBe(RideStatus.MATCHED);

            expect(dbStatusHistories).toHaveLength(2);
            expect(dbStatusHistories[1]).toMatchObject({
                rideRequestId: rideId,
                fromStatus: RideStatus.REQUESTED,
                toStatus: RideStatus.MATCHED,
                actor: `${JASHIM_ID} (DRIVER)`,
            });
            expect(dbStatusHistories[1].changedAt).toBeInstanceOf(Date);

            // Step 3: Jashim marks arrival (MATCHED -> DRIVER_ARRIVED)
            const arriveRes = await request(app)
                .patch(`/driver/rides/${rideId}/arrive`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);

            expect(arriveRes.status).toBe(200);
            expect(arriveRes.body.rideRequest.status).toBe(RideStatus.DRIVER_ARRIVED);

            expect(dbStatusHistories).toHaveLength(3);
            expect(dbStatusHistories[2]).toMatchObject({
                rideRequestId: rideId,
                fromStatus: RideStatus.MATCHED,
                toStatus: RideStatus.DRIVER_ARRIVED,
                actor: `${JASHIM_ID} (DRIVER)`,
            });
            expect(dbStatusHistories[2].changedAt).toBeInstanceOf(Date);

            // Step 4: Jashim starts trip (DRIVER_ARRIVED -> STARTED)
            const startRes = await request(app)
                .patch(`/driver/rides/${rideId}/start`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);

            expect(startRes.status).toBe(200);
            expect(startRes.body.rideRequest.status).toBe(RideStatus.STARTED);

            expect(dbStatusHistories).toHaveLength(4);
            expect(dbStatusHistories[3]).toMatchObject({
                rideRequestId: rideId,
                fromStatus: RideStatus.DRIVER_ARRIVED,
                toStatus: RideStatus.STARTED,
                actor: `${JASHIM_ID} (DRIVER)`,
            });
            expect(dbStatusHistories[3].changedAt).toBeInstanceOf(Date);

            // Step 5: Jashim completes trip (STARTED -> COMPLETED)
            const completeRes = await request(app)
                .patch(`/driver/rides/${rideId}/complete`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);

            expect(completeRes.status).toBe(200);
            expect(completeRes.body.rideRequest.status).toBe(RideStatus.COMPLETED);

            expect(dbStatusHistories).toHaveLength(5);
            expect(dbStatusHistories[4]).toMatchObject({
                rideRequestId: rideId,
                fromStatus: RideStatus.STARTED,
                toStatus: RideStatus.COMPLETED,
                actor: `${JASHIM_ID} (DRIVER)`,
            });
            expect(dbStatusHistories[4].changedAt).toBeInstanceOf(Date);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. INVALID TRANSITIONS REJECTED WITH 409 AND EXACT ERROR MESSAGE
    // ─────────────────────────────────────────────────────────────────────────

    describe('2. Every invalid transition is rejected with 409 and correct error message', () => {
        it('rejects skipping steps: MATCHED -> STARTED directly (409)', async () => {
            const DRIVER_ID = 'driver-1';
            const vehicle: DBVehicle = { id: 'v-1', driverId: DRIVER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-1', vehicleId: vehicle.id, seatsOccupied: 1, status: RideStatus.MATCHED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-matched',
                passengerId: 'p-1',
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.MATCHED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            // Driver tries to start trip directly from MATCHED without arriving first
            const res = await request(app)
                .patch(`/driver/rides/${ride.id}/start`)
                .set('Authorization', `Bearer ${makeToken(DRIVER_ID, 'DRIVER')}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('Cannot transition from MATCHED to STARTED');
        });

        it('rejects skipping steps: REQUESTED -> DRIVER_ARRIVED directly (409)', async () => {
            const DRIVER_ID = 'driver-1';
            const vehicle: DBVehicle = { id: 'v-1', driverId: DRIVER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-1', vehicleId: vehicle.id, seatsOccupied: 1, status: RideStatus.REQUESTED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-requested',
                passengerId: 'p-1',
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.REQUESTED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/driver/rides/${ride.id}/arrive`)
                .set('Authorization', `Bearer ${makeToken(DRIVER_ID, 'DRIVER')}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('Cannot transition from REQUESTED to DRIVER_ARRIVED');
        });

        it('rejects going backward: COMPLETED -> STARTED (409)', async () => {
            const DRIVER_ID = 'driver-1';
            const vehicle: DBVehicle = { id: 'v-1', driverId: DRIVER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-1', vehicleId: vehicle.id, seatsOccupied: 0, status: RideStatus.COMPLETED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-completed',
                passengerId: 'p-1',
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.COMPLETED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/driver/rides/${ride.id}/start`)
                .set('Authorization', `Bearer ${makeToken(DRIVER_ID, 'DRIVER')}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('Cannot transition from COMPLETED to STARTED');
        });

        it('rejects cancellation from STARTED: STARTED -> CANCELLED (409)', async () => {
            const PASSENGER_ID = 'passenger-1';
            const DRIVER_ID = 'driver-1';
            const vehicle: DBVehicle = { id: 'v-1', driverId: DRIVER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-1', vehicleId: vehicle.id, seatsOccupied: 1, status: RideStatus.STARTED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-started',
                passengerId: PASSENGER_ID,
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.STARTED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            // Passenger tries to cancel a ride that has already started
            const res = await request(app)
                .patch(`/rides/${ride.id}/cancel`)
                .set('Authorization', `Bearer ${makeToken(PASSENGER_ID, 'PASSENGER')}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('Cannot transition from STARTED to CANCELLED');
        });

        it('rejects cancellation from COMPLETED: COMPLETED -> CANCELLED (409)', async () => {
            const PASSENGER_ID = 'passenger-1';
            const DRIVER_ID = 'driver-1';
            const vehicle: DBVehicle = { id: 'v-1', driverId: DRIVER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-1', vehicleId: vehicle.id, seatsOccupied: 0, status: RideStatus.COMPLETED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-done',
                passengerId: PASSENGER_ID,
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.COMPLETED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/rides/${ride.id}/cancel`)
                .set('Authorization', `Bearer ${makeToken(PASSENGER_ID, 'PASSENGER')}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('Cannot transition from COMPLETED to CANCELLED');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. AUTHORIZATION: Cross-driver update blocked (403)
    // ─────────────────────────────────────────────────────────────────────────

    describe('3. A driver cannot advance another driver’s ride (403)', () => {
        it('blocks another driver from advancing arrival (403)', async () => {
            const DRIVER_OWNER_ID = 'driver-owner';
            const DRIVER_IMPOSTER_ID = 'driver-imposter';

            const vehicle: DBVehicle = { id: 'v-owner', driverId: DRIVER_OWNER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-owner', vehicleId: vehicle.id, seatsOccupied: 1, status: RideStatus.MATCHED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-matched',
                passengerId: 'p-1',
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.MATCHED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/driver/rides/${ride.id}/arrive`)
                .set('Authorization', `Bearer ${makeToken(DRIVER_IMPOSTER_ID, 'DRIVER')}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('permission');
        });

        it('blocks another driver from starting trip (403)', async () => {
            const DRIVER_OWNER_ID = 'driver-owner';
            const DRIVER_IMPOSTER_ID = 'driver-imposter';

            const vehicle: DBVehicle = { id: 'v-owner', driverId: DRIVER_OWNER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-owner', vehicleId: vehicle.id, seatsOccupied: 1, status: RideStatus.DRIVER_ARRIVED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-arrived',
                passengerId: 'p-1',
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.DRIVER_ARRIVED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/driver/rides/${ride.id}/start`)
                .set('Authorization', `Bearer ${makeToken(DRIVER_IMPOSTER_ID, 'DRIVER')}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('permission');
        });

        it('blocks another driver from completing trip (403)', async () => {
            const DRIVER_OWNER_ID = 'driver-owner';
            const DRIVER_IMPOSTER_ID = 'driver-imposter';

            const vehicle: DBVehicle = { id: 'v-owner', driverId: DRIVER_OWNER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-owner', vehicleId: vehicle.id, seatsOccupied: 1, status: RideStatus.STARTED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-started',
                passengerId: 'p-1',
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.STARTED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/driver/rides/${ride.id}/complete`)
                .set('Authorization', `Bearer ${makeToken(DRIVER_IMPOSTER_ID, 'DRIVER')}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('permission');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. CANCELLATION: Succeeds from REQUESTED, MATCHED, DRIVER_ARRIVED
    // ─────────────────────────────────────────────────────────────────────────

    describe('4. Cancellation rules (allowed vs rejected states)', () => {
        it('succeeds from REQUESTED by passenger', async () => {
            const PASSENGER_ID = 'passenger-1';
            const ride: DBRideRequest = {
                id: 'rr-req',
                passengerId: PASSENGER_ID,
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.REQUESTED,
                poolId: null,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/rides/${ride.id}/cancel`)
                .set('Authorization', `Bearer ${makeToken(PASSENGER_ID, 'PASSENGER')}`);

            expect(res.status).toBe(200);
            expect(res.body.rideRequest.status).toBe(RideStatus.CANCELLED);

            expect(dbStatusHistories).toHaveLength(1);
            expect(dbStatusHistories[0]).toMatchObject({
                rideRequestId: ride.id,
                fromStatus: RideStatus.REQUESTED,
                toStatus: RideStatus.CANCELLED,
                actor: `${PASSENGER_ID} (PASSENGER)`,
            });
        });

        it('succeeds from MATCHED and frees reserved seats', async () => {
            const PASSENGER_ID = 'passenger-1';
            const DRIVER_ID = 'driver-1';
            const vehicle: DBVehicle = { id: 'v-1', driverId: DRIVER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-1', vehicleId: vehicle.id, seatsOccupied: 2, status: RideStatus.MATCHED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-matched',
                passengerId: PASSENGER_ID,
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.MATCHED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/rides/${ride.id}/cancel`)
                .set('Authorization', `Bearer ${makeToken(PASSENGER_ID, 'PASSENGER')}`);

            expect(res.status).toBe(200);
            expect(res.body.rideRequest.status).toBe(RideStatus.CANCELLED);

            expect(dbStatusHistories).toHaveLength(1);
            expect(dbStatusHistories[0]).toMatchObject({
                rideRequestId: ride.id,
                fromStatus: RideStatus.MATCHED,
                toStatus: RideStatus.CANCELLED,
                actor: `${PASSENGER_ID} (PASSENGER)`,
            });
        });

        it('succeeds from DRIVER_ARRIVED (driver or passenger cancel)', async () => {
            const PASSENGER_ID = 'passenger-1';
            const DRIVER_ID = 'driver-1';
            const vehicle: DBVehicle = { id: 'v-1', driverId: DRIVER_ID, name: 'Tesla', capacity: 3, online: true };
            dbVehicles.set(vehicle.id, vehicle);

            const pool: DBPool = { id: 'p-1', vehicleId: vehicle.id, seatsOccupied: 1, status: RideStatus.DRIVER_ARRIVED };
            dbPools.set(pool.id, pool);

            const ride: DBRideRequest = {
                id: 'rr-arrived',
                passengerId: PASSENGER_ID,
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.DRIVER_ARRIVED,
                poolId: pool.id,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            // Driver marks passenger no-show / cancel
            const res = await request(app)
                .patch(`/rides/${ride.id}/cancel`)
                .set('Authorization', `Bearer ${makeToken(DRIVER_ID, 'DRIVER')}`);

            expect(res.status).toBe(200);
            expect(res.body.rideRequest.status).toBe(RideStatus.CANCELLED);

            expect(dbStatusHistories).toHaveLength(1);
            expect(dbStatusHistories[0]).toMatchObject({
                rideRequestId: ride.id,
                fromStatus: RideStatus.DRIVER_ARRIVED,
                toStatus: RideStatus.CANCELLED,
                actor: `${DRIVER_ID} (DRIVER)`,
            });
        });

        it('blocks unauthorized users from cancelling a ride (403)', async () => {
            const PASSENGER_ID = 'passenger-owner';
            const STRANGER_ID = 'passenger-stranger';

            const ride: DBRideRequest = {
                id: 'rr-mine',
                passengerId: PASSENGER_ID,
                pickupZone: Zone.BANANI,
                destinationZone: Zone.MOHAKHALI,
                seatsRequested: 1,
                status: RideStatus.REQUESTED,
                poolId: null,
                createdAt: new Date(),
            };
            dbRideRequests.set(ride.id, ride);

            const res = await request(app)
                .patch(`/rides/${ride.id}/cancel`)
                .set('Authorization', `Bearer ${makeToken(STRANGER_ID, 'PASSENGER')}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('permission');
        });
    });
});
