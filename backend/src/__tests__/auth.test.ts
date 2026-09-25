import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// --- Must use vi.hoisted() so the variable is available inside the hoisted vi.mock factory ---
const mockPrismaUser = vi.hoisted(() => ({
    create: vi.fn(),
    findUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
    prisma: {
        user: mockPrismaUser,
        $queryRaw: vi.fn(),
    },
}));

// Import app AFTER mocks are established
import { app } from '../app';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test_jwt_secret';

describe('Auth Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.JWT_SECRET = TEST_SECRET;
    });

    // ─── SIGNUP ───────────────────────────────────────────────────

    describe('POST /auth/signup', () => {
        const validPayload = {
            name: 'Farhan Ahmed',
            phone: '+8801712345678',
            password: 'securePass123',
            role: 'PASSENGER',
        };

        it('creates a user and returns 201', async () => {
            const fakeUser = {
                id: 'uuid-1',
                name: validPayload.name,
                phone: validPayload.phone,
                passwordHash: 'hashed',
                role: 'PASSENGER',
                createdAt: new Date(),
            };
            mockPrismaUser.create.mockResolvedValue(fakeUser);

            const res = await request(app)
                .post('/auth/signup')
                .send(validPayload);

            expect(res.status).toBe(201);
            expect(res.body.user).toMatchObject({
                id: 'uuid-1',
                name: 'Farhan Ahmed',
                phone: '+8801712345678',
                role: 'PASSENGER',
            });

            // Verify password was hashed (not stored as plaintext)
            const createCall = mockPrismaUser.create.mock.calls[0][0];
            expect(createCall.data.passwordHash).not.toBe(validPayload.password);
        });

        it('rejects duplicate phone with 409', async () => {
            const prismaError: any = new Error('Unique constraint failed');
            prismaError.code = 'P2002';
            mockPrismaUser.create.mockRejectedValue(prismaError);

            const res = await request(app)
                .post('/auth/signup')
                .send(validPayload);

            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/already registered/i);
        });

        it('rejects missing name with 400', async () => {
            const res = await request(app)
                .post('/auth/signup')
                .send({ ...validPayload, name: '' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/name/i);
        });

        it('rejects invalid phone format with 400', async () => {
            const res = await request(app)
                .post('/auth/signup')
                .send({ ...validPayload, phone: '12345' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/phone/i);
        });

        it('rejects short password with 400', async () => {
            const res = await request(app)
                .post('/auth/signup')
                .send({ ...validPayload, password: '123' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/password/i);
        });

        it('rejects invalid role with 400', async () => {
            const res = await request(app)
                .post('/auth/signup')
                .send({ ...validPayload, role: 'ADMIN' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/role/i);
        });
    });

    // ─── LOGIN ────────────────────────────────────────────────────

    describe('POST /auth/login', () => {
        const loginPayload = { phone: '+8801712345678', password: 'securePass123' };

        it('returns a JWT on valid credentials', async () => {
            const hashedPw = await bcrypt.hash(loginPayload.password, 10);
            mockPrismaUser.findUnique.mockResolvedValue({
                id: 'uuid-1',
                name: 'Farhan Ahmed',
                phone: loginPayload.phone,
                passwordHash: hashedPw,
                role: 'PASSENGER',
            });

            const res = await request(app)
                .post('/auth/login')
                .send(loginPayload);

            expect(res.status).toBe(200);
            expect(res.body.token).toBeDefined();

            // Decode and verify token contents
            const decoded = jwt.verify(res.body.token, TEST_SECRET) as any;
            expect(decoded.userId).toBe('uuid-1');
            expect(decoded.role).toBe('PASSENGER');
        });

        it('rejects wrong password with 401', async () => {
            const hashedPw = await bcrypt.hash('correctPassword', 10);
            mockPrismaUser.findUnique.mockResolvedValue({
                id: 'uuid-1',
                name: 'Farhan Ahmed',
                phone: loginPayload.phone,
                passwordHash: hashedPw,
                role: 'PASSENGER',
            });

            const res = await request(app)
                .post('/auth/login')
                .send({ phone: loginPayload.phone, password: 'wrongPassword' });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid/i);
        });

        it('rejects non-existent user with 401', async () => {
            mockPrismaUser.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .post('/auth/login')
                .send(loginPayload);

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid/i);
        });
    });

    // ─── PROTECTED ROUTE / AUTH MIDDLEWARE ─────────────────────────

    describe('GET /protected (authMiddleware)', () => {
        it('grants access with a valid token', async () => {
            const token = jwt.sign(
                { userId: 'uuid-1', role: 'PASSENGER' },
                TEST_SECRET,
                { expiresIn: '24h' },
            );

            const res = await request(app)
                .get('/protected')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.user).toMatchObject({
                userId: 'uuid-1',
                role: 'PASSENGER',
            });
        });

        it('rejects request with no token (401)', async () => {
            const res = await request(app).get('/protected');

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/authentication/i);
        });

        it('rejects request with invalid token (401)', async () => {
            const res = await request(app)
                .get('/protected')
                .set('Authorization', 'Bearer totally.invalid.token');

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid/i);
        });

        it('rejects request with expired token (401)', async () => {
            const token = jwt.sign(
                { userId: 'uuid-1', role: 'PASSENGER' },
                TEST_SECRET,
                { expiresIn: '0s' },
            );

            // Tiny delay to ensure token is expired
            await new Promise((r) => setTimeout(r, 10));

            const res = await request(app)
                .get('/protected')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(401);
        });
    });
});
