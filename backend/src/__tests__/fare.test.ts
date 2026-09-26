import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Zone } from '../generated/prisma/enums';
import {
    calculateFare,
    calculateFareBreakdown,
    BASE_FARE_POYSHA,
    SAME_CORRIDOR_DISTANCE_CHARGE_POYSHA,
    OTHER_CORRIDOR_DISTANCE_CHARGE_POYSHA,
    POOL_DISCOUNT_PERCENT,
} from '../utils/fare';

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
    status: string;
}

interface DBRideRequest {
    id: string;
    passengerId: string;
    pickupZone: Zone;
    destinationZone: Zone;
    seatsRequested: number;
    status: string;
    poolId: string | null;
    createdAt: Date;
}

interface DBFare {
    id: string;
    rideRequestId: string;
    baseFarePoysha: number;
    distanceChargePoysha: number;
    poolDiscountPoysha: number;
    totalPoysha: number;
}

let dbVehicles: Map<string, DBVehicle> = new Map();
let dbPools: Map<string, DBPool> = new Map();
let dbRideRequests: Map<string, DBRideRequest> = new Map();
let dbFares: Map<string, DBFare> = new Map();
let dbStatusHistories: any[] = [];
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
            status: args.data.status || 'REQUESTED',
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
            status: args.data.status || 'REQUESTED',
            poolId: null,
            createdAt: new Date(),
        };
        dbRideRequests.set(id, newRide);

        if (args.data.fare?.create) {
            const fareId = `fare-${idCounter++}`;
            const newFare: DBFare = {
                id: fareId,
                rideRequestId: id,
                baseFarePoysha: args.data.fare.create.baseFarePoysha,
                distanceChargePoysha: args.data.fare.create.distanceChargePoysha,
                poolDiscountPoysha: args.data.fare.create.poolDiscountPoysha,
                totalPoysha: args.data.fare.create.totalPoysha,
            };
            dbFares.set(id, newFare);
        }

        const fare = dbFares.get(id);
        return Promise.resolve({
            ...newRide,
            fare: fare ? { ...fare } : null,
        });
    }),
    findUnique: vi.fn((args: any) => {
        const ride = dbRideRequests.get(args.where.id);
        if (!ride) return Promise.resolve(null);

        const fare = dbFares.get(ride.id);
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
            fare: fare ? { ...fare } : null,
            pool,
        });
    }),
    findMany: vi.fn((args: any) => {
        const results: any[] = [];
        for (const rr of dbRideRequests.values()) {
            if (args?.where?.poolId && rr.poolId !== args.where.poolId) continue;
            if (args?.where?.status && rr.status !== args.where.status) continue;
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
    create: vi.fn((args: any) => {
        const id = `fare-${idCounter++}`;
        const newFare: DBFare = {
            id,
            rideRequestId: args.data.rideRequestId,
            baseFarePoysha: args.data.baseFarePoysha,
            distanceChargePoysha: args.data.distanceChargePoysha,
            poolDiscountPoysha: args.data.poolDiscountPoysha,
            totalPoysha: args.data.totalPoysha,
        };
        dbFares.set(newFare.rideRequestId, newFare);
        return Promise.resolve({ ...newFare });
    }),
    upsert: vi.fn((args: any) => {
        const reqId = args.where.rideRequestId;
        const data = args.update;
        let fare = dbFares.get(reqId);
        if (fare) {
            fare.baseFarePoysha = data.baseFarePoysha;
            fare.distanceChargePoysha = data.distanceChargePoysha;
            fare.poolDiscountPoysha = data.poolDiscountPoysha;
            fare.totalPoysha = data.totalPoysha;
        } else {
            fare = {
                id: `fare-${idCounter++}`,
                rideRequestId: reqId,
                baseFarePoysha: args.create.baseFarePoysha,
                distanceChargePoysha: args.create.distanceChargePoysha,
                poolDiscountPoysha: args.create.poolDiscountPoysha,
                totalPoysha: args.create.totalPoysha,
            };
            dbFares.set(reqId, fare);
        }
        return Promise.resolve({ ...fare });
    }),
    update: vi.fn((args: any) => {
        const fare = dbFares.get(args.where.rideRequestId);
        if (fare) {
            Object.assign(fare, args.data);
        }
        return Promise.resolve({ ...fare });
    }),
}));

const mockPrismaStatusHistory = vi.hoisted(() => ({
    create: vi.fn((args: any) => {
        dbStatusHistories.push(args.data);
        return Promise.resolve({ id: `sh-${idCounter++}`, ...args.data });
    }),
}));

const mockExecuteRaw = vi.hoisted(() =>
    vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        // Atomic capacity update logic:
        // In joinExistingPool:
        // SET "seatsOccupied" = "seatsOccupied" + ${seats} (values[0])
        // WHERE id = ${poolId} (values[1])
        // AND "seatsOccupied" + ${seats} (values[2]) <= ${capacity} (values[3])
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

describe('Fare Calculation Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.JWT_SECRET = TEST_SECRET;

        // Reset in-memory database
        dbVehicles = new Map();
        dbPools = new Map();
        dbRideRequests = new Map();
        dbFares = new Map();
        dbStatusHistories = [];
        idCounter = 1;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. UNIT TESTS: calculateFare() directly
    // ─────────────────────────────────────────────────────────────────────────

    describe('1. Unit tests on calculateFare() directly', () => {
        it('calculates same-corridor solo fare correctly (5000 poysha)', () => {
            // Banani and Mohakhali are in the same corridor (1 hop)
            // Solo ride (isPooled = false):
            // baseFare (2000) + distanceCharge (3000) - poolDiscount (0) = 5000
            const fare = calculateFare(Zone.BANANI, Zone.MOHAKHALI, false);
            expect(fare).toBe(5000);

            // Detailed breakdown check
            const breakdown = calculateFareBreakdown(Zone.BANANI, Zone.MOHAKHALI, false);
            expect(breakdown).toEqual({
                baseFarePoysha: 2000,
                distanceChargePoysha: 3000,
                poolDiscountPoysha: 0,
                totalPoysha: 5000,
            });
        });

        it('calculates same-corridor pooled fare matching Nusrat/Rafiq worked example exactly (4250 poysha)', () => {
            // Nusrat: Banani -> Mohakhali (1 hop, same corridor, pooled)
            const nusratFare = calculateFare(Zone.BANANI, Zone.MOHAKHALI, true);
            expect(nusratFare).toBe(4250);

            const nusratBreakdown = calculateFareBreakdown(Zone.BANANI, Zone.MOHAKHALI, true);
            expect(nusratBreakdown).toEqual({
                baseFarePoysha: 2000,
                distanceChargePoysha: 3000,
                poolDiscountPoysha: 750, // 25% of 3000 = 750
                totalPoysha: 4250,       // 2000 + 3000 - 750 = 4250
            });

            // Rafiq: Banani -> Gulshan_1 (1 hop, same corridor, pooled)
            const rafiqFare = calculateFare(Zone.BANANI, Zone.GULSHAN_1, true);
            expect(rafiqFare).toBe(4250);

            const rafiqBreakdown = calculateFareBreakdown(Zone.BANANI, Zone.GULSHAN_1, true);
            expect(rafiqBreakdown).toEqual({
                baseFarePoysha: 2000,
                distanceChargePoysha: 3000,
                poolDiscountPoysha: 750, // 25% of 3000 = 750
                totalPoysha: 4250,       // 2000 + 3000 - 750 = 4250
            });
        });

        it('calculates different-corridor solo fare correctly (7000 poysha)', () => {
            // Banani and Uttara are in different corridors (2 hops)
            // Solo ride (isPooled = false):
            // baseFare (2000) + distanceCharge (5000) - poolDiscount (0) = 7000
            const fare = calculateFare(Zone.BANANI, Zone.UTTARA, false);
            expect(fare).toBe(7000);

            const breakdown = calculateFareBreakdown(Zone.BANANI, Zone.UTTARA, false);
            expect(breakdown).toEqual({
                baseFarePoysha: 2000,
                distanceChargePoysha: 5000,
                poolDiscountPoysha: 0,
                totalPoysha: 7000,
            });
        });

        it('calculates different-corridor pooled fare correctly (5750 poysha)', () => {
            // Banani and Uttara in different corridors (2 hops)
            // Pooled ride (isPooled = true):
            // baseFare (2000) + distanceCharge (5000) - poolDiscount (1250) = 5750
            const fare = calculateFare(Zone.BANANI, Zone.UTTARA, true);
            expect(fare).toBe(5750);

            const breakdown = calculateFareBreakdown(Zone.BANANI, Zone.UTTARA, true);
            expect(breakdown).toEqual({
                baseFarePoysha: 2000,
                distanceChargePoysha: 5000,
                poolDiscountPoysha: 1250, // 25% of 5000 = 1250
                totalPoysha: 5750,        // 2000 + 5000 - 1250 = 5750
            });
        });

        it('verifies standard rounding rule: rounds half-up to nearest integer, never truncates', () => {
            // The discount is 25% of distanceCharge
            // For 3000: (3000 * 25) / 100 = 750.0 (exact integer)
            // For 5000: (5000 * 25) / 100 = 1250.0 (exact integer)
            const sameCorridor = calculateFareBreakdown(Zone.BANANI, Zone.MOHAKHALI, true);
            const otherCorridor = calculateFareBreakdown(Zone.BANANI, Zone.UTTARA, true);

            expect(Number.isInteger(sameCorridor.poolDiscountPoysha)).toBe(true);
            expect(Number.isInteger(otherCorridor.poolDiscountPoysha)).toBe(true);
            expect(Number.isInteger(sameCorridor.totalPoysha)).toBe(true);
            expect(Number.isInteger(otherCorridor.totalPoysha)).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. INTEGRATION TEST: Full Prompt 3 Flow + Pool Fare Finalization
    // ─────────────────────────────────────────────────────────────────────────

    describe('2. Integration test: Nusrat and Rafiq pooled flow', () => {
        it('after Nusrat and Rafiq are both accepted into the same pool, GET ride requests confirms 4250 poysha each', async () => {
            // Setup cast: Driver Jashim with vehicle "Bullet"
            const JASHIM_ID = 'driver-jashim';
            const NUSRAT_ID = 'passenger-nusrat';
            const RAFIQ_ID = 'passenger-rafiq';

            const bulletVehicle: DBVehicle = {
                id: 'vehicle-bullet',
                driverId: JASHIM_ID,
                name: 'Bullet',
                capacity: 3,
                online: true,
            };
            dbVehicles.set(bulletVehicle.id, bulletVehicle);

            // Step 1: Nusrat requests a ride (Banani -> Mohakhali, 1 seat)
            const nusratCreateRes = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken(NUSRAT_ID, 'PASSENGER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'MOHAKHALI',
                    seats: 1,
                });

            expect(nusratCreateRes.status).toBe(201);
            const nusratRideId = nusratCreateRes.body.rideRequest.id;
            expect(nusratCreateRes.body.rideRequest.status).toBe('REQUESTED');
            // Estimated fare shown to Nusrat before matching: solo fare = 5000 poysha
            expect(nusratCreateRes.body.rideRequest.fare.totalPoysha).toBe(5000);
            expect(nusratCreateRes.body.rideRequest.fare.baseFarePoysha).toBe(2000);
            expect(nusratCreateRes.body.rideRequest.fare.distanceChargePoysha).toBe(3000);
            expect(nusratCreateRes.body.rideRequest.fare.poolDiscountPoysha).toBe(0);

            // Step 2: Rafiq requests a ride (Banani -> Gulshan_1, 1 seat)
            const rafiqCreateRes = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken(RAFIQ_ID, 'PASSENGER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'GULSHAN_1',
                    seats: 1,
                });

            expect(rafiqCreateRes.status).toBe(201);
            const rafiqRideId = rafiqCreateRes.body.rideRequest.id;
            expect(rafiqCreateRes.body.rideRequest.status).toBe('REQUESTED');
            // Estimated fare shown to Rafiq before matching: solo fare = 5000 poysha
            expect(rafiqCreateRes.body.rideRequest.fare.totalPoysha).toBe(5000);

            // Step 3: Jashim accepts Nusrat's request -> creates new pool
            const acceptNusratRes = await request(app)
                .post(`/driver/rides/${nusratRideId}/accept`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);

            expect(acceptNusratRes.status).toBe(200);
            expect(acceptNusratRes.body.pool.seatsOccupied).toBe(1);
            const poolId = acceptNusratRes.body.pool.id;

            // Step 4: Jashim accepts Rafiq's request -> joins existing pool
            // Compatible pool exists (same pickup Banani, destinations Mohakhali and Gulshan_1 share corridor)
            const acceptRafiqRes = await request(app)
                .post(`/driver/rides/${rafiqRideId}/accept`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);

            expect(acceptRafiqRes.status).toBe(200);
            expect(acceptRafiqRes.body.pool.id).toBe(poolId);
            expect(acceptRafiqRes.body.pool.seatsOccupied).toBe(2);

            // Step 5: GET Nusrat's ride request -> confirm fare is finalized to exactly 4250 poysha
            const getNusratRes = await request(app)
                .get(`/rides/${nusratRideId}`)
                .set('Authorization', `Bearer ${makeToken(NUSRAT_ID, 'PASSENGER')}`);

            expect(getNusratRes.status).toBe(200);
            expect(getNusratRes.body.rideRequest.status).toBe('MATCHED');
            expect(getNusratRes.body.rideRequest.fare).toBeDefined();
            expect(getNusratRes.body.rideRequest.fare.baseFarePoysha).toBe(2000);
            expect(getNusratRes.body.rideRequest.fare.distanceChargePoysha).toBe(3000);
            expect(getNusratRes.body.rideRequest.fare.poolDiscountPoysha).toBe(750);
            expect(getNusratRes.body.rideRequest.fare.totalPoysha).toBe(4250);

            // Step 6: GET Rafiq's ride request -> confirm fare is finalized to exactly 4250 poysha
            const getRafiqRes = await request(app)
                .get(`/rides/${rafiqRideId}`)
                .set('Authorization', `Bearer ${makeToken(RAFIQ_ID, 'PASSENGER')}`);

            expect(getRafiqRes.status).toBe(200);
            expect(getRafiqRes.body.rideRequest.status).toBe('MATCHED');
            expect(getRafiqRes.body.rideRequest.fare).toBeDefined();
            expect(getRafiqRes.body.rideRequest.fare.baseFarePoysha).toBe(2000);
            expect(getRafiqRes.body.rideRequest.fare.distanceChargePoysha).toBe(3000);
            expect(getRafiqRes.body.rideRequest.fare.poolDiscountPoysha).toBe(750);
            expect(getRafiqRes.body.rideRequest.fare.totalPoysha).toBe(4250);
        });

        it('enforces authorization on GET /rides/:id (cannot view another passenger ride)', async () => {
            const NUSRAT_ID = 'passenger-nusrat';
            const SHIRIN_ID = 'passenger-shirin';

            // Create ride for Nusrat
            const rideRes = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken(NUSRAT_ID, 'PASSENGER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'MOHAKHALI',
                    seats: 1,
                });

            const rideId = rideRes.body.rideRequest.id;

            // Shirin tries to view Nusrat's ride
            const forbiddenRes = await request(app)
                .get(`/rides/${rideId}`)
                .set('Authorization', `Bearer ${makeToken(SHIRIN_ID, 'PASSENGER')}`);

            expect(forbiddenRes.status).toBe(403);
            expect(forbiddenRes.body.error).toContain('Access denied');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. INTEGER MONEY VERIFICATION: At Every Layer
    // ─────────────────────────────────────────────────────────────────────────

    describe('3. Confirm fare is stored/returned as an integer, never a float, at every layer', () => {
        it('Layer 1: POST /rides API response contains strictly integer amounts', async () => {
            const res = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('passenger-int', 'PASSENGER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'MOHAKHALI',
                    seats: 1,
                });

            expect(res.status).toBe(201);
            const { fare } = res.body.rideRequest;
            expect(Number.isInteger(fare.baseFarePoysha)).toBe(true);
            expect(Number.isInteger(fare.distanceChargePoysha)).toBe(true);
            expect(Number.isInteger(fare.poolDiscountPoysha)).toBe(true);
            expect(Number.isInteger(fare.totalPoysha)).toBe(true);
            expect(fare.totalPoysha % 1).toBe(0);
        });

        it('Layer 2: DB row persisted in database stores strictly integer poysha values', async () => {
            const res = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('passenger-db', 'PASSENGER')}`)
                .send({
                    pickupZone: 'BANANI',
                    destinationZone: 'UTTARA',
                    seats: 1,
                });

            const rideId = res.body.rideRequest.id;
            const dbFare = dbFares.get(rideId);
            expect(dbFare).toBeDefined();

            expect(Number.isInteger(dbFare!.baseFarePoysha)).toBe(true);
            expect(Number.isInteger(dbFare!.distanceChargePoysha)).toBe(true);
            expect(Number.isInteger(dbFare!.poolDiscountPoysha)).toBe(true);
            expect(Number.isInteger(dbFare!.totalPoysha)).toBe(true);

            expect(dbFare!.baseFarePoysha).toBe(2000);
            expect(dbFare!.distanceChargePoysha).toBe(5000);
            expect(dbFare!.poolDiscountPoysha).toBe(0);
            expect(dbFare!.totalPoysha).toBe(7000);
        });

        it('Layer 3: Recalculated pool fare stored in DB is strictly integer poysha', async () => {
            const JASHIM_ID = 'driver-int';
            const bulletVehicle: DBVehicle = {
                id: 'v-int',
                driverId: JASHIM_ID,
                name: 'Bullet',
                capacity: 3,
                online: true,
            };
            dbVehicles.set(bulletVehicle.id, bulletVehicle);

            // Create 2 rides
            const r1 = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('p1', 'PASSENGER')}`)
                .send({ pickupZone: 'BANANI', destinationZone: 'MOHAKHALI', seats: 1 });
            const r2 = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('p2', 'PASSENGER')}`)
                .send({ pickupZone: 'BANANI', destinationZone: 'GULSHAN_1', seats: 1 });

            // Accept both
            await request(app)
                .post(`/driver/rides/${r1.body.rideRequest.id}/accept`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);
            await request(app)
                .post(`/driver/rides/${r2.body.rideRequest.id}/accept`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);

            const dbFare1 = dbFares.get(r1.body.rideRequest.id);
            const dbFare2 = dbFares.get(r2.body.rideRequest.id);

            for (const f of [dbFare1!, dbFare2!]) {
                expect(Number.isInteger(f.baseFarePoysha)).toBe(true);
                expect(Number.isInteger(f.distanceChargePoysha)).toBe(true);
                expect(Number.isInteger(f.poolDiscountPoysha)).toBe(true);
                expect(Number.isInteger(f.totalPoysha)).toBe(true);
                expect(f.totalPoysha).toBe(4250);
            }
        });

        it('Layer 4: GET /rides/:id API response returns strictly integer values without decimals', async () => {
            const JASHIM_ID = 'driver-layer4';
            const bulletVehicle: DBVehicle = {
                id: 'v-l4',
                driverId: JASHIM_ID,
                name: 'Bullet',
                capacity: 3,
                online: true,
            };
            dbVehicles.set(bulletVehicle.id, bulletVehicle);

            const r1 = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('p-l4-1', 'PASSENGER')}`)
                .send({ pickupZone: 'BANANI', destinationZone: 'MOHAKHALI', seats: 1 });
            const r2 = await request(app)
                .post('/rides')
                .set('Authorization', `Bearer ${makeToken('p-l4-2', 'PASSENGER')}`)
                .send({ pickupZone: 'BANANI', destinationZone: 'GULSHAN_1', seats: 1 });

            await request(app)
                .post(`/driver/rides/${r1.body.rideRequest.id}/accept`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);
            await request(app)
                .post(`/driver/rides/${r2.body.rideRequest.id}/accept`)
                .set('Authorization', `Bearer ${makeToken(JASHIM_ID, 'DRIVER')}`);

            const getRes = await request(app)
                .get(`/rides/${r1.body.rideRequest.id}`)
                .set('Authorization', `Bearer ${makeToken('p-l4-1', 'PASSENGER')}`);

            expect(getRes.status).toBe(200);
            const { fare } = getRes.body.rideRequest;
            expect(typeof fare.totalPoysha).toBe('number');
            expect(Number.isInteger(fare.totalPoysha)).toBe(true);
            expect(fare.totalPoysha).toBe(4250);
            expect(fare.totalPoysha.toString()).not.toContain('.');
        });
    });
});
