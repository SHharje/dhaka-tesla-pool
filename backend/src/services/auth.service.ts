import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import type { Role } from '../generated/prisma/enums';

const SALT_ROUNDS = 10;

function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is not set');
    }
    return secret;
}

export interface SignupInput {
    name: string;
    phone: string;
    password: string;
    role: Role;
}

export interface AuthPayload {
    userId: string;
    role: Role;
}

export async function createUser(input: SignupInput) {
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    const user = await prisma.user.create({
        data: {
            name: input.name,
            phone: input.phone,
            passwordHash,
            role: input.role,
        },
    });

    return { id: user.id, name: user.name, phone: user.phone, role: user.role };
}

export async function authenticateUser(phone: string, password: string) {
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
        return null;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        return null;
    }

    const payload: AuthPayload = { userId: user.id, role: user.role };
    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '24h' });

    return { token, user: { id: user.id, name: user.name, role: user.role } };
}

export function verifyToken(token: string): AuthPayload {
    return jwt.verify(token, getJwtSecret()) as AuthPayload;
}
