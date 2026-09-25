import { Request, Response } from 'express';
import { createUser, authenticateUser } from '../services/auth.service';
import { Role } from '../generated/prisma/enums';

// Bangladeshi phone: +880 followed by 10 digits, or local 01X with 9 more digits
const PHONE_REGEX = /^(\+880|0)1[3-9]\d{8}$/;
const VALID_ROLES: string[] = [Role.PASSENGER, Role.DRIVER];

export async function signup(req: Request, res: Response): Promise<void> {
    const { name, phone, password, role } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Name is required' });
        return;
    }

    if (!phone || typeof phone !== 'string') {
        res.status(400).json({ error: 'Phone is required' });
        return;
    }

    if (!PHONE_REGEX.test(phone)) {
        res.status(400).json({ error: 'Invalid phone format. Use +880XXXXXXXXXX or 01XXXXXXXXX' });
        return;
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
        return;
    }

    if (!role || !VALID_ROLES.includes(role)) {
        res.status(400).json({ error: 'Role must be PASSENGER or DRIVER' });
        return;
    }

    try {
        const user = await createUser({ name: name.trim(), phone, password, role });
        res.status(201).json({ user });
    } catch (err: any) {
        // Prisma unique constraint violation
        if (err?.code === 'P2002') {
            res.status(409).json({ error: 'Phone number already registered' });
            return;
        }
        throw err;
    }
}

export async function login(req: Request, res: Response): Promise<void> {
    const { phone, password } = req.body;

    if (!phone || typeof phone !== 'string') {
        res.status(400).json({ error: 'Phone is required' });
        return;
    }

    if (!password || typeof password !== 'string') {
        res.status(400).json({ error: 'Password is required' });
        return;
    }

    const result = await authenticateUser(phone, password);

    if (!result) {
        res.status(401).json({ error: 'Invalid phone or password' });
        return;
    }

    res.json({ token: result.token, user: result.user });
}
