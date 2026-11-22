import { Router } from 'express';
import { assertDatabaseConfigured, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getCutoffIsoDate, getLocalDateInfo } from '../utils/date.js';
import { asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const userId = req.user!.id;
    const range = typeof req.query.range === 'string' ? req.query.range : '30D';
    const profile = await prisma.fitnessProfile.findUnique({ where: { userId } });
    const todayIso = getLocalDateInfo(profile?.timezone || 'Asia/Kolkata').isoDate;
    const cutoff = getCutoffIsoDate(range, todayIso);

    const [logs, sessions, measurements] = await Promise.all([
      prisma.mealLog.findMany({
        where: { userId, ...(cutoff ? { date: { gte: cutoff } } : {}) },
      }),
      prisma.workoutSession.findMany({
        where: { userId, ...(cutoff ? { date: { gte: cutoff } } : {}) },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.bodyMeasurement.findMany({
        where: { userId, ...(cutoff ? { date: { gte: cutoff } } : {}) },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        select: {
          date: true,
          weightKg: true,
          waistCm: true,
          hipsCm: true,
          chestCm: true,
          armsCm: true,
          thighsCm: true,
          calvesCm: true,
          bodyFatPct: true,
        },
      }),
    ]);

    const dailyNutritionMap = new Map<
      string,
      { calories: number; proteinG: number; carbsG: number; fatG: number; expenseInr: number }
    >();
    for (const l of logs) {
      const prev = dailyNutritionMap.get(l.date) || {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        expenseInr: 0,
      };
      dailyNutritionMap.set(l.date, {
        calories: Math.round(prev.calories + l.calories),
        proteinG: Math.round(prev.proteinG + l.proteinG),
        carbsG: Math.round(prev.carbsG + l.carbsG),
        fatG: Math.round(prev.fatG + l.fatG),
        expenseInr: Math.round(prev.expenseInr + l.priceInr),
      });
    }

    const dailyNutrition = Array.from(dailyNutritionMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, val]) => ({
        date,
        ...val,
        targetCalories: profile?.dailyCalorieTarget ?? null,
      }));

    const totalFoodExpense = logs.reduce((s, l) => s + l.priceInr, 0);
    const loggedDaysCount = dailyNutrition.length;
    const avgDailyCalories =
      loggedDaysCount > 0
        ? Math.round(dailyNutrition.reduce((s, d) => s + d.calories, 0) / loggedDaysCount)
        : 0;
    const avgDailyProtein =
      loggedDaysCount > 0
        ? Math.round(dailyNutrition.reduce((s, d) => s + d.proteinG, 0) / loggedDaysCount)
        : 0;
    const totalTrainingVolume = sessions.reduce((s, w) => s + w.totalVolumeKg, 0);

    const bodySeries = measurements.map((m) => ({
      date: m.date,
      weightKg: m.weightKg,
      waistCm: m.waistCm,
      hipsCm: m.hipsCm ?? null,
      chestCm: m.chestCm,
      armsCm: m.armsCm,
      thighsCm: m.thighsCm,
      calvesCm: m.calvesCm ?? null,
      bodyFatPct: m.bodyFatPct,
    }));

    const workoutSeries = sessions.map((s) => ({
      date: s.date,
      title: s.title,
      volumeKg: s.totalVolumeKg,
      durationMinutes: s.durationMinutes,
    }));

    res.json({
      success: true,
      data: {
        range,
        units: {
          weightUnit: profile?.preferredWeightUnit || 'KG',
          measureUnit: profile?.preferredMeasureUnit || 'CM',
          currency: profile?.currency || 'INR',
        },
        summary: {
          totalFoodExpense: Math.round(totalFoodExpense),
          avgDailyCalories,
          avgDailyProtein,
          loggedDaysCount,
          workoutsCompleted: sessions.length,
          totalTrainingVolume: Math.round(totalTrainingVolume),
        },
        dailyNutrition,
        bodySeries,
        workoutSeries,
      },
    });
  })
);

export default router;
