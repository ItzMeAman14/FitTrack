import { Router } from 'express';
import { z } from 'zod';
import {
  assertDatabaseConfigured,
  prisma,
  toApiFood,
  toApiMealLog,
  toApiPlannedMeal,
  withTransaction,
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateId } from '../utils/crypto.js';
import { getLocalDateInfo } from '../utils/date.js';
import { AppError, asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

const foodSchema = z.object({
  name: z.string().trim().min(1, 'Food name is required').max(120),
  category: z.enum(['VEG', 'NON_VEG', 'VEGAN', 'SUPPLEMENT']),
  servingLabel: z.string().trim().min(1, 'Serving unit label is required').max(60),
  servingGrams: z.coerce.number().positive().max(5000),
  calories: z.coerce.number().min(0).max(5000),
  proteinG: z.coerce.number().min(0).max(500),
  carbsG: z.coerce.number().min(0).max(500),
  fatG: z.coerce.number().min(0).max(500),
  priceInr: z.coerce.number().min(0).max(50000),
});

const plannedMealSchema = z.object({
  name: z.string().trim().min(1, 'Meal name is required').max(80),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'),
  items: z
    .array(
      z.object({
        foodId: z.string().min(1),
        servings: z.coerce.number().positive().max(50),
      })
    )
    .default([]),
});

const mealLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mealName: z.string().trim().min(1).max(80),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  foodId: z.string().min(1),
  servings: z.coerce.number().positive().max(50),
  plannedMealId: z.string().nullable().optional(),
});

// --- FOOD LIBRARY ---
router.get(
  '/foods',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const foods = await prisma.foodItem.findMany({
      where: { userId: req.user!.id },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: foods.map(toApiFood) });
  })
);

router.post(
  '/foods',
  asyncHandler(async (req, res) => {
    const parsed = foodSchema.parse(req.body);
    assertDatabaseConfigured();
    const created = await prisma.foodItem.create({
      data: {
        id: generateId('food'),
        userId: req.user!.id,
        ...parsed,
        isDefault: false,
        createdAt: new Date(),
      },
    });
    res.status(201).json({ success: true, message: 'Food added to library.', data: toApiFood(created) });
  })
);

router.put(
  '/foods/:id',
  asyncHandler(async (req, res) => {
    const parsed = foodSchema.parse(req.body);
    const updated = await withTransaction(async (tx) => {
      const existing = await tx.foodItem.findFirst({
        where: { id: String(req.params.id), userId: req.user!.id },
      });
      if (!existing) throw new AppError('Food item not found.', 404);
      const row = await tx.foodItem.update({
        where: { id: existing.id },
        data: parsed,
      });
      return toApiFood(row);
    });
    res.json({ success: true, message: 'Food updated.', data: updated });
  })
);

router.delete(
  '/foods/:id',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const deleted = await prisma.foodItem.deleteMany({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (deleted.count === 0) throw new AppError('Food item not found.', 404);
    res.json({ success: true, message: 'Food deleted.' });
  })
);

// --- DIET PLAN (CUSTOM MEAL SLOTS) ---
router.get(
  '/diet/plan',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const meals = await prisma.plannedMeal.findMany({
      where: { userId: req.user!.id },
      orderBy: { time: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json({ success: true, data: meals.map(toApiPlannedMeal) });
  })
);

router.post(
  '/diet/meals',
  asyncHandler(async (req, res) => {
    const parsed = plannedMealSchema.parse(req.body);
    const created = await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const foodIds = [...new Set(parsed.items.map((it) => it.foodId))];
      const foods =
        foodIds.length > 0
          ? await tx.foodItem.findMany({
              where: { userId, id: { in: foodIds } },
            })
          : [];
      const foodMap = new Map(foods.map((f) => [f.id, f]));

      const itemsData = parsed.items.map((it, idx) => {
        const food = foodMap.get(it.foodId);
        if (!food) throw new AppError('Referenced food item not found.', 404);
        return {
          id: generateId('pmi'),
          sortOrder: idx,
          foodId: food.id,
          foodName: food.name,
          servings: it.servings,
          servingLabel: food.servingLabel,
          calories: Math.round(food.calories * it.servings),
          proteinG: Math.round(food.proteinG * it.servings * 10) / 10,
          carbsG: Math.round(food.carbsG * it.servings * 10) / 10,
          fatG: Math.round(food.fatG * it.servings * 10) / 10,
          priceInr: Math.round(food.priceInr * it.servings * 10) / 10,
        };
      });

      const meal = await tx.plannedMeal.create({
        data: {
          id: generateId('meal'),
          userId,
          name: parsed.name,
          time: parsed.time,
          items: { create: itemsData },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      return toApiPlannedMeal(meal);
    });
    res.status(201).json({ success: true, message: 'Meal slot added.', data: created });
  })
);

router.post(
  '/diet/meals/:id/items',
  asyncHandler(async (req, res) => {
    const itemSchema = z.object({
      foodId: z.string().min(1),
      servings: z.coerce.number().positive().max(50),
    });
    const parsed = itemSchema.parse(req.body);

    const updated = await withTransaction(async (tx) => {
      const meal = await tx.plannedMeal.findFirst({
        where: { id: String(req.params.id), userId: req.user!.id },
        include: { items: true },
      });
      if (!meal) throw new AppError('Planned meal not found.', 404);

      const food = await tx.foodItem.findFirst({
        where: { id: parsed.foodId, userId: req.user!.id },
      });
      if (!food) throw new AppError('Food item not found.', 404);

      const maxSort = meal.items.reduce((max, it) => Math.max(max, it.sortOrder), -1);
      await tx.plannedMealItem.create({
        data: {
          id: generateId('pmi'),
          mealId: meal.id,
          sortOrder: maxSort + 1,
          foodId: food.id,
          foodName: food.name,
          servings: parsed.servings,
          servingLabel: food.servingLabel,
          calories: Math.round(food.calories * parsed.servings),
          proteinG: Math.round(food.proteinG * parsed.servings * 10) / 10,
          carbsG: Math.round(food.carbsG * parsed.servings * 10) / 10,
          fatG: Math.round(food.fatG * parsed.servings * 10) / 10,
          priceInr: Math.round(food.priceInr * parsed.servings * 10) / 10,
        },
      });

      const reloaded = await tx.plannedMeal.findUniqueOrThrow({
        where: { id: meal.id },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      return toApiPlannedMeal(reloaded);
    });

    res.json({ success: true, message: 'Food added to planned meal.', data: updated });
  })
);

router.delete(
  '/diet/meals/:id/items/:itemId',
  asyncHandler(async (req, res) => {
    const updated = await withTransaction(async (tx) => {
      const meal = await tx.plannedMeal.findFirst({
        where: { id: String(req.params.id), userId: req.user!.id },
      });
      if (!meal) throw new AppError('Planned meal not found.', 404);

      await tx.plannedMealItem.deleteMany({
        where: { id: String(req.params.itemId), mealId: meal.id },
      });

      const reloaded = await tx.plannedMeal.findUniqueOrThrow({
        where: { id: meal.id },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      return toApiPlannedMeal(reloaded);
    });
    res.json({ success: true, message: 'Item removed from meal.', data: updated });
  })
);

router.delete(
  '/diet/meals/:id',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const deleted = await prisma.plannedMeal.deleteMany({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (deleted.count === 0) throw new AppError('Planned meal not found.', 404);
    res.json({ success: true, message: 'Meal slot deleted.' });
  })
);

// --- DAILY MEAL LOGS (ACTUAL CONSUMPTION) ---
router.get(
  '/diet/logs',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const profile = await prisma.fitnessProfile.findUnique({
      where: { userId: req.user!.id },
      select: { timezone: true },
    });
    const todayIso = getLocalDateInfo(profile?.timezone || 'Asia/Kolkata').isoDate;
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : todayIso;

    const logs = await prisma.mealLog.findMany({
      where: { userId: req.user!.id, date },
      orderBy: { time: 'asc' },
    });

    res.json({ success: true, data: { date, logs: logs.map(toApiMealLog) } });
  })
);

function getRemainingPlannedItems<T extends { foodId: string }>(
  plannedItems: T[],
  existingPlannedLogs: Array<{ foodId: string | null }>
): T[] {
  const loggedFoodCounts = new Map<string, number>();
  for (const log of existingPlannedLogs) {
    if (!log.foodId) continue;
    loggedFoodCounts.set(log.foodId, (loggedFoodCounts.get(log.foodId) ?? 0) + 1);
  }

  const remaining: T[] = [];
  for (const item of plannedItems) {
    const count = loggedFoodCounts.get(item.foodId) ?? 0;
    if (count > 0) {
      loggedFoodCounts.set(item.foodId, count - 1);
    } else {
      remaining.push(item);
    }
  }
  return remaining;
}

router.post(
  '/diet/logs',
  asyncHandler(async (req, res) => {
    const parsed = mealLogSchema.parse(req.body);
    const created = await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const profile = await tx.fitnessProfile.findUnique({
        where: { userId },
        select: { timezone: true },
      });
      const todayIso = getLocalDateInfo(profile?.timezone || 'Asia/Kolkata').isoDate;
      const targetDate = parsed.date || todayIso;
      const food = await tx.foodItem.findFirst({
        where: { id: parsed.foodId, userId },
      });
      if (!food) throw new AppError('Food item not found.', 404);

      const plannedMealId = parsed.plannedMealId?.trim() || null;
      if (plannedMealId) {
        const meal = await tx.plannedMeal.findFirst({
          where: { id: plannedMealId, userId },
          include: { items: true },
        });
        if (!meal) throw new AppError('Planned meal not found.', 404);

        const plannedOccurrences = meal.items.filter((it) => it.foodId === food.id).length;
        const existingPlannedCount = await tx.mealLog.count({
          where: {
            userId,
            date: targetDate,
            plannedMealId: meal.id,
            foodId: food.id,
          },
        });

        if (existingPlannedCount >= Math.max(1, plannedOccurrences)) {
          throw new AppError(
            `"${food.name}" has already been logged in "${meal.name}" for ${targetDate}. Use Log Extra Food to add an extra serving.`,
            409
          );
        }
      }

      const log = await tx.mealLog.create({
        data: {
          id: generateId('mlog'),
          userId,
          date: targetDate,
          mealName: parsed.mealName,
          time: parsed.time || new Date().toTimeString().slice(0, 5),
          foodId: food.id,
          foodName: food.name,
          servings: parsed.servings,
          servingLabel: food.servingLabel,
          calories: Math.round(food.calories * parsed.servings),
          proteinG: Math.round(food.proteinG * parsed.servings * 10) / 10,
          carbsG: Math.round(food.carbsG * parsed.servings * 10) / 10,
          fatG: Math.round(food.fatG * parsed.servings * 10) / 10,
          priceInr: Math.round(food.priceInr * parsed.servings * 10) / 10,
          plannedMealId,
          createdAt: new Date(),
        },
      });
      return toApiMealLog(log);
    });
    res.status(201).json({ success: true, message: 'Meal consumption logged.', data: created });
  })
);

router.post(
  '/diet/meals/:id/log-all',
  asyncHandler(async (req, res) => {
    const dateInput = typeof req.body?.date === 'string' ? req.body.date : undefined;
    const logsCreated = await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const profile = await tx.fitnessProfile.findUnique({
        where: { userId },
        select: { timezone: true },
      });
      const todayIso = getLocalDateInfo(profile?.timezone || 'Asia/Kolkata').isoDate;
      const targetDate = dateInput || todayIso;

      const meal = await tx.plannedMeal.findFirst({
        where: { id: String(req.params.id), userId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!meal) throw new AppError('Planned meal not found.', 404);
      if (meal.items.length === 0) {
        throw new AppError('Add at least one food item to this meal before logging.', 400);
      }

      const existingPlannedLogs = await tx.mealLog.findMany({
        where: { userId, date: targetDate, plannedMealId: meal.id },
        select: { foodId: true },
      });

      const remainingItems = getRemainingPlannedItems(meal.items, existingPlannedLogs);
      if (remainingItems.length === 0) {
        throw new AppError(
          `"${meal.name}" has already been logged for ${targetDate}. Use Log Extra Food to add an extra single food item.`,
          409
        );
      }

      const now = new Date();
      const rows = remainingItems.map((item) => ({
        id: generateId('mlog'),
        userId,
        date: targetDate,
        mealName: meal.name,
        time: meal.time,
        foodId: item.foodId,
        foodName: item.foodName,
        servings: item.servings,
        servingLabel: item.servingLabel,
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        priceInr: item.priceInr,
        plannedMealId: meal.id,
        createdAt: now,
      }));
      await tx.mealLog.createMany({ data: rows });
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });

    res.status(201).json({
      success: true,
      message: `Logged ${logsCreated.length} items for meal.`,
      data: logsCreated,
    });
  })
);

router.delete(
  '/diet/logs/:id',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const deleted = await prisma.mealLog.deleteMany({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (deleted.count === 0) throw new AppError('Meal log not found.', 404);
    res.json({ success: true, message: 'Meal log removed.' });
  })
);

export default router;
