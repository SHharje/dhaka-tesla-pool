import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { patchOnline, listRequests } from '../controllers/driver.controller';

const router = Router();

router.use(authMiddleware);

router.patch('/online', patchOnline);
router.get('/requests', listRequests);

export default router;
