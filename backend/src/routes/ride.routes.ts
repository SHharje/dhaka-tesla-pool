import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { createRide, getRide } from '../controllers/ride.controller';

const router = Router();

router.use(authMiddleware);

router.post('/', createRide);
router.get('/:id', getRide);

export default router;
