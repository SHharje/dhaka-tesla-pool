import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
    patchOnline,
    listRequests,
    acceptRide,
    arriveRide,
    startRide,
    completeRide,
    cancelDriverRide,
} from '../controllers/driver.controller';

const router = Router();

router.use(authMiddleware);

router.patch('/online', patchOnline);
router.get('/requests', listRequests);
router.post('/rides/:id/accept', acceptRide);
router.patch('/rides/:id/arrive', arriveRide);
router.patch('/rides/:id/start', startRide);
router.patch('/rides/:id/complete', completeRide);
router.patch('/rides/:id/cancel', cancelDriverRide);

export default router;
