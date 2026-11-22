import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDashboardOverview } from '../services/dashboardService.js';
import { asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const range = typeof req.query.range === 'string' ? req.query.range : '30D';
    const data = await getDashboardOverview(req.user!.id, range);
    res.json({ success: true, data });
  })
);

export default router;
