import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import {
  assertDatabaseConfigured,
  prisma,
  toApiBodyMeasurement,
  withTransaction,
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateId } from '../utils/crypto.js';
import { getLocalDateInfo } from '../utils/date.js';
import { AppError, asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

const optNum = (max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number().positive().max(max).nullable().optional()
  );

const customMeasurementSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1).max(60),
  valueCm: z.coerce.number().positive().max(350),
});

const measurementSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weightKg: optNum(400),
  bodyFatPct: optNum(80),
  waistCm: optNum(300),
  chestCm: optNum(300),
  hipsCm: optNum(300),
  armsCm: optNum(150),
  thighsCm: optNum(200),
  neckCm: optNum(120),
  calvesCm: optNum(150),
  customMeasurements: z.array(customMeasurementSchema).max(15).optional(),
  photoDataUrl: z.string().max(4_000_000).nullable().optional(),
  notes: z.string().trim().max(500).default(''),
});

async function syncLatestWeightToProfile(tx: Prisma.TransactionClient, userId: string) {
  const profile = await tx.fitnessProfile.findUnique({ where: { userId } });
  if (!profile) return;

  const userMeasurements = await tx.bodyMeasurement.findMany({
    where: { userId, weightKg: { not: null } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: { weightKg: true },
  });

  if (userMeasurements.length > 0) {
    const latestWeight = userMeasurements[0].weightKg;
    const earliestWeight = userMeasurements[userMeasurements.length - 1].weightKg;
    await tx.fitnessProfile.update({
      where: { userId },
      data: {
        currentWeightKg: latestWeight,
        ...(profile.startingWeightKg === null ? { startingWeightKg: earliestWeight } : {}),
        updatedAt: new Date(),
      },
    });
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const list = await prisma.bodyMeasurement.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: list.map(toApiBodyMeasurement) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = measurementSchema.parse(req.body);
    const created = await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const profile = await tx.fitnessProfile.findUnique({
        where: { userId },
        select: { timezone: true },
      });
      const todayIso = getLocalDateInfo(profile?.timezone || 'Asia/Kolkata').isoDate;
      const custom = (parsed.customMeasurements || []).map((c) => ({
        id: c.id || generateId('cmeas'),
        label: c.label,
        valueCm: Number(c.valueCm.toFixed(2)),
      }));

      const entry = await tx.bodyMeasurement.create({
        data: {
          id: generateId('meas'),
          userId,
          date: parsed.date || todayIso,
          weightKg: parsed.weightKg ?? null,
          bodyFatPct: parsed.bodyFatPct ?? null,
          waistCm: parsed.waistCm ?? null,
          chestCm: parsed.chestCm ?? null,
          hipsCm: parsed.hipsCm ?? null,
          armsCm: parsed.armsCm ?? null,
          thighsCm: parsed.thighsCm ?? null,
          neckCm: parsed.neckCm ?? null,
          calvesCm: parsed.calvesCm ?? null,
          customMeasurements: custom as unknown as Prisma.InputJsonValue,
          photoDataUrl: parsed.photoDataUrl ?? null,
          notes: parsed.notes,
          createdAt: new Date(),
        },
      });
      await syncLatestWeightToProfile(tx, userId);
      return toApiBodyMeasurement(entry);
    });

    res.status(201).json({ success: true, message: 'Measurement logged.', data: created });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = measurementSchema.parse(req.body);
    const updated = await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const existing = await tx.bodyMeasurement.findFirst({
        where: { id: String(req.params.id), userId },
      });
      if (!existing) throw new AppError('Measurement not found.', 404);

      const nextCustom =
        parsed.customMeasurements === undefined
          ? existing.customMeasurements
          : (parsed.customMeasurements.map((c) => ({
              id: c.id || generateId('cmeas'),
              label: c.label,
              valueCm: Number(c.valueCm.toFixed(2)),
            })) as unknown as Prisma.InputJsonValue);

      const next = await tx.bodyMeasurement.update({
        where: { id: existing.id },
        data: {
          date: parsed.date || existing.date,
          weightKg: parsed.weightKg === undefined ? existing.weightKg : parsed.weightKg,
          bodyFatPct: parsed.bodyFatPct === undefined ? existing.bodyFatPct : parsed.bodyFatPct,
          waistCm: parsed.waistCm === undefined ? existing.waistCm : parsed.waistCm,
          chestCm: parsed.chestCm === undefined ? existing.chestCm : parsed.chestCm,
          hipsCm: parsed.hipsCm === undefined ? existing.hipsCm : parsed.hipsCm,
          armsCm: parsed.armsCm === undefined ? existing.armsCm : parsed.armsCm,
          thighsCm: parsed.thighsCm === undefined ? existing.thighsCm : parsed.thighsCm,
          neckCm: parsed.neckCm === undefined ? existing.neckCm : parsed.neckCm,
          calvesCm: parsed.calvesCm === undefined ? existing.calvesCm : parsed.calvesCm,
          customMeasurements: nextCustom as Prisma.InputJsonValue,
          photoDataUrl:
            parsed.photoDataUrl === undefined ? existing.photoDataUrl : parsed.photoDataUrl,
          notes: parsed.notes,
        },
      });
      await syncLatestWeightToProfile(tx, userId);
      return toApiBodyMeasurement(next);
    });

    res.json({ success: true, message: 'Measurement updated.', data: updated });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const deleted = await tx.bodyMeasurement.deleteMany({
        where: { id: String(req.params.id), userId },
      });
      if (deleted.count === 0) throw new AppError('Measurement not found.', 404);
      await syncLatestWeightToProfile(tx, userId);
    });
    res.json({ success: true, message: 'Measurement deleted.' });
  })
);

export default router;
