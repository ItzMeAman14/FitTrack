import { Router } from 'express';
import { z } from 'zod';
import { prisma, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { exportUserData } from '../services/dataPortabilityService.js';
import { getUserProfile, updateUserProfile } from '../services/profileService.js';
import { asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

const optionalPositiveNumber = (max: number) =>
  z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().positive().max(max).nullable().optional()
  );

const optionalPositiveInt = (max: number) =>
  z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().int().positive().max(max).nullable().optional()
  );

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  age: optionalPositiveInt(120),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
  heightCm: optionalPositiveNumber(300),
  startingWeightKg: optionalPositiveNumber(400),
  currentWeightKg: optionalPositiveNumber(400),
  targetWeightKg: optionalPositiveNumber(400),
  targetWaistCm: optionalPositiveNumber(300),
  targetBodyFatPct: optionalPositiveNumber(80),
  fitnessGoal: z.enum(['FAT_LOSS', 'MUSCLE_GAIN', 'MAINTENANCE', 'RECOMPOSITION']).optional(),
  activityLevel: z
    .enum([
      'SEDENTARY',
      'LIGHTLY_ACTIVE',
      'MODERATELY_ACTIVE',
      'VERY_ACTIVE',
      'EXTREMELY_ACTIVE',
    ])
    .optional(),
  dailyCalorieTarget: optionalPositiveInt(12000),
  dailyProteinTargetG: optionalPositiveInt(1000),
  dailyCarbTargetG: optionalPositiveInt(1500),
  dailyFatTargetG: optionalPositiveInt(600),
  preferredWeightUnit: z.enum(['KG', 'LBS']).optional(),
  preferredMeasureUnit: z.enum(['CM', 'INCHES']).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  theme: z.enum(['dark']).optional(),
  geminiEnabled: z.boolean().optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await getUserProfile(req.user!.id);
    res.json({ success: true, data });
  })
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = updateProfileSchema.parse(req.body);
    const data = await updateUserProfile(req.user!.id, parsed);
    res.json({
      success: true,
      message: 'Profile & targets updated.',
      data,
    });
  })
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const payload = await exportUserData(
      req.user!.id,
      { id: req.user!.id, name: req.user!.name, email: req.user!.email },
      'FULL_BACKUP'
    );
    res.json({ success: true, data: payload });
  })
);

router.post(
  '/clear-logs',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    await withTransaction(async (tx) => {
      await tx.mealLog.deleteMany({ where: { userId } });
      await tx.workoutSession.deleteMany({ where: { userId } });
      await tx.bodyMeasurement.deleteMany({ where: { userId } });
      await tx.aiMessage.deleteMany({ where: { userId } });
      await tx.aiPendingProposal.deleteMany({ where: { userId } });
      await tx.aiAuditLog.deleteMany({ where: { userId } });
    });
    res.json({ success: true, message: 'All activity logs cleared.' });
  })
);

export default router;
