import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import {
  assertDatabaseConfigured,
  DAY_ORDER,
  prisma,
  toApiPlannedMeal,
  toApiSavedPlan,
  toApiWorkoutDaySplit,
  withTransaction,
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import type { PlannedMeal, WorkoutDaySplit } from '../types.js';
import { generateId } from '../utils/crypto.js';
import { AppError, asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

const createSavedPlanSchema = z.object({
  type: z.enum(['DIET', 'WORKOUT']),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).default(''),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const plans = await prisma.savedPlan.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: plans.map(toApiSavedPlan) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSavedPlanSchema.parse(req.body);
    const created = await withTransaction(async (tx) => {
      const userId = req.user!.id;
      let payload: unknown;

      if (parsed.type === 'DIET') {
        const meals = await tx.plannedMeal.findMany({
          where: { userId },
          orderBy: { time: 'asc' },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        });
        if (meals.length === 0) {
          throw new AppError('Create at least one planned meal before saving a Diet template.', 400);
        }
        payload = meals.map(toApiPlannedMeal);
      } else {
        const splitRows = await tx.workoutDaySplit.findMany({
          where: { userId },
          include: { exercises: { orderBy: { sortOrder: 'asc' } } },
        });
        if (splitRows.length === 0) {
          throw new AppError('Configure your workout split before saving a template.', 400);
        }
        payload = [...splitRows]
          .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
          .map(toApiWorkoutDaySplit);
      }

      const plan = await tx.savedPlan.create({
        data: {
          id: generateId('plan'),
          userId,
          type: parsed.type,
          name: parsed.name,
          description: parsed.description,
          payload: payload as Prisma.InputJsonValue,
          createdAt: new Date(),
        },
      });
      return toApiSavedPlan(plan);
    });

    res.status(201).json({ success: true, message: 'Plan template saved.', data: created });
  })
);

router.post(
  '/:id/apply',
  asyncHandler(async (req, res) => {
    await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const plan = await tx.savedPlan.findFirst({
        where: { id: String(req.params.id), userId },
      });
      if (!plan) throw new AppError('Saved plan not found.', 404);

      if (plan.type === 'DIET') {
        const templateMeals = (plan.payload as unknown as PlannedMeal[]) || [];
        await tx.plannedMeal.deleteMany({ where: { userId } });
        for (const m of templateMeals) {
          await tx.plannedMeal.create({
            data: {
              id: generateId('meal'),
              userId,
              name: m.name,
              time: m.time,
              items: {
                create: (m.items || []).map((it, idx) => ({
                  id: generateId('pmi'),
                  sortOrder: idx,
                  foodId: it.foodId,
                  foodName: it.foodName,
                  servings: it.servings,
                  servingLabel: it.servingLabel,
                  calories: it.calories,
                  proteinG: it.proteinG,
                  carbsG: it.carbsG,
                  fatG: it.fatG,
                  priceInr: it.priceInr,
                })),
              },
            },
          });
        }
      } else {
        const templateSplit = (plan.payload as unknown as WorkoutDaySplit[]) || [];
        await tx.workoutDaySplit.deleteMany({ where: { userId } });
        for (const day of templateSplit) {
          await tx.workoutDaySplit.create({
            data: {
              userId,
              day: day.day,
              focus: day.focus,
              isRestDay: day.isRestDay,
              exercises: {
                create: (day.exercises || []).map((ex, idx) => ({
                  id: generateId('spex'),
                  sortOrder: idx,
                  exerciseId: ex.exerciseId,
                  exerciseName: ex.exerciseName,
                  muscleGroup: ex.muscleGroup,
                  targetSets: ex.targetSets,
                  targetReps: ex.targetReps,
                  restSeconds: ex.restSeconds,
                  targetWeightKg: ex.targetWeightKg ?? null,
                  instructions: ex.instructions ?? '',
                  imageUrl: ex.imageUrl ?? null,
                  videoUrl: ex.videoUrl ?? null,
                })),
              },
            },
          });
        }
      }
    });

    res.json({ success: true, message: 'Saved plan applied to active schedule.' });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const deleted = await prisma.savedPlan.deleteMany({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (deleted.count === 0) throw new AppError('Saved plan not found.', 404);
    res.json({ success: true, message: 'Saved plan deleted.' });
  })
);

export default router;
