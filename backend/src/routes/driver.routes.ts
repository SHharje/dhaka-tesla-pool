import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { patchOnline, listRequests, acceptRide } from '../controllers/driver.controller';

const router = Router();

router.use(authMiddleware);

router.patch('/online', patchOnline);
router.get('/requests', listRequests);
router.post('/rides/:id/accept', acceptRide);

export default router;
