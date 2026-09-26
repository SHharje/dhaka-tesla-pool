import express from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma';
import authRoutes from './routes/auth.routes';
import driverRoutes from './routes/driver.routes';
import rideRoutes from './routes/ride.routes';
import { authMiddleware } from './middleware/auth.middleware';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ok', db: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'error', db: 'unreachable' });
    }
});

// Auth routes
app.use('/auth', authRoutes);

// Driver routes
app.use('/driver', driverRoutes);

// Ride routes
app.use('/rides', rideRoutes);

// Protected test route
app.get('/protected', authMiddleware, (req, res) => {
    res.json({ message: 'Access granted', user: req.user });
});

export { app };
