import {
  assertDatabaseConfigured,
  DAY_ORDER,
  prisma,
  toApiWorkoutSession,
} from '../db.js';
import { getCutoffIsoDate, getLastNDates, getLocalDateInfo } from '../utils/date.js';

export async function getDashboardOverview(userId: string, range = '30D') {
  assertDatabaseConfigured();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) return null;

  const profile = user.profile ?? null;
  const timezone = profile?.timezone || 'Asia/Kolkata';
  const dateInfo = getLocalDateInfo(timezone);
  const cutoff = getCutoffIsoDate(range, dateInfo.isoDate);

  const [measurements, mealLogs, plannedMealsRaw, splitsRaw, userSessionsRaw] = await Promise.all([
    prisma.bodyMeasurement.findMany({
      where: { userId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: {
        date: true,
        weightKg: true,
        waistCm: true,
        chestCm: true,
        hipsCm: true,
        calvesCm: true,
        bodyFatPct: true,
      },
    }),
    prisma.mealLog.findMany({
      where: { userId },
    }),
    prisma.plannedMeal.findMany({
      where: { userId },
      orderBy: { time: 'asc' },
      include: { items: true },
    }),
    prisma.workoutDaySplit.findMany({
      where: { userId },
      include: { exercises: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.workoutSession.findMany({
      where: { userId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  const latestMeasurementWithWeight = [...measurements].reverse().find((m) => m.weightKg !== null);
  const currentWeightKg =
    latestMeasurementWithWeight?.weightKg ?? profile?.currentWeightKg ?? null;
  const startingWeightKg = profile?.startingWeightKg ?? measurements[0]?.weightKg ?? null;
  const targetWeightKg = profile?.targetWeightKg ?? null;

  const weightLostKg =
    startingWeightKg !== null && currentWeightKg !== null
      ? Number((startingWeightKg - currentWeightKg).toFixed(2))
      : null;

  // Today's Meal Logs & Diet Plan
  const todaysLogs = mealLogs.filter((l) => l.date === dateInfo.isoDate);
  const caloriesConsumed = Math.round(todaysLogs.reduce((s, l) => s + l.calories, 0));
  const proteinConsumedG = Math.round(todaysLogs.reduce((s, l) => s + l.proteinG, 0) * 10) / 10;
  const carbsConsumedG = Math.round(todaysLogs.reduce((s, l) => s + l.carbsG, 0) * 10) / 10;
  const fatConsumedG = Math.round(todaysLogs.reduce((s, l) => s + l.fatG, 0) * 10) / 10;
  const todaysFoodExpense = Math.round(todaysLogs.reduce((s, l) => s + l.priceInr, 0));

  const plannedMeals = plannedMealsRaw.map((m) => {
    const loggedCounts = new Map<string, number>();
    for (const log of todaysLogs) {
      if (log.plannedMealId !== m.id || !log.foodId) continue;
      loggedCounts.set(log.foodId, (loggedCounts.get(log.foodId) ?? 0) + 1);
    }
    let remainingCount = 0;
    for (const item of m.items) {
      const count = loggedCounts.get(item.foodId) ?? 0;
      if (count > 0) {
        loggedCounts.set(item.foodId, count - 1);
      } else {
        remainingCount += 1;
      }
    }

    return {
      id: m.id,
      name: m.name,
      time: m.time,
      itemCount: m.items.length,
      plannedCalories: Math.round(m.items.reduce((s, i) => s + i.calories, 0)),
      plannedProteinG: Math.round(m.items.reduce((s, i) => s + i.proteinG, 0)),
      loggedToday: m.items.length > 0 && remainingCount === 0,
    };
  });

  // Today's Workout Split & Weekly Consistency
  const splits = [...splitsRaw].sort(
    (a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)
  );
  const todaySplit = splits.find((s) => s.day === dateInfo.dayOfWeek) || null;
  const userSessions = userSessionsRaw.map(toApiWorkoutSession);
  const todaysWorkoutSession = userSessions.find((s) => s.date === dateInfo.isoDate) || null;

  const last7Dates = getLastNDates(dateInfo.isoDate, 7);
  const weeklyCompletedDates = new Set(
    userSessions.filter((s) => last7Dates.includes(s.date)).map((s) => s.date)
  );
  const weeklyTargetCount = Math.max(1, splits.filter((s) => !s.isRestDay).length || 6);

  // Latest measurements summary
  const latestWaist = [...measurements].reverse().find((m) => m.waistCm !== null)?.waistCm ?? null;
  const latestChest = [...measurements].reverse().find((m) => m.chestCm !== null)?.chestCm ?? null;
  const latestHips =
    [...measurements].reverse().find((m) => (m.hipsCm ?? null) !== null)?.hipsCm ?? null;
  const latestCalves =
    [...measurements].reverse().find((m) => (m.calvesCm ?? null) !== null)?.calvesCm ?? null;
  const latestBodyFat =
    [...measurements].reverse().find((m) => m.bodyFatPct !== null)?.bodyFatPct ?? null;

  // Chart Trends filtered by range
  const weightTrend = measurements
    .filter((m) => m.weightKg !== null && (!cutoff || m.date >= cutoff))
    .map((m) => ({
      date: m.date,
      weightKg: m.weightKg,
      waistCm: m.waistCm,
    }));

  const logsByDate = new Map<string, { calories: number; protein: number; expense: number }>();
  for (const log of mealLogs) {
    if (cutoff && log.date < cutoff) continue;
    const prev = logsByDate.get(log.date) || { calories: 0, protein: 0, expense: 0 };
    logsByDate.set(log.date, {
      calories: Math.round(prev.calories + log.calories),
      protein: Math.round(prev.protein + log.proteinG),
      expense: Math.round(prev.expense + log.priceInr),
    });
  }

  const calorieTrend = Array.from(logsByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, val]) => ({
      date,
      calories: val.calories,
      target: profile?.dailyCalorieTarget ?? null,
      proteinG: val.protein,
      expenseInr: val.expense,
    }));

  const workoutVolumeTrend = userSessions
    .filter((s) => !cutoff || s.date >= cutoff)
    .map((s) => ({
      date: s.date,
      title: s.title,
      volumeKg: s.totalVolumeKg,
      durationMinutes: s.durationMinutes,
    }));

  const motivationMap: Record<string, string> = {
    FAT_LOSS:
      'Consistency beats intensity. Hit your protein target and stay in a steady deficit today.',
    MUSCLE_GAIN: 'Fuel your lifts and chase progressive overload—every quality rep compounds.',
    RECOMPOSITION:
      'Stay precise on protein and training volume to build lean tissue while leaning out.',
    MAINTENANCE: 'Keep your nutrition steady and execute today’s movement plan with intention.',
  };

  return {
    welcome: {
      name: user.name,
      greeting: dateInfo.greeting,
      formattedDate: dateInfo.formattedDate,
      isoDate: dateInfo.isoDate,
      dayOfWeek: dateInfo.dayOfWeek,
      timezone,
      motivation: motivationMap[profile?.fitnessGoal || 'MAINTENANCE'],
    },
    overviewCards: {
      currentWeightKg,
      targetWeightKg,
      weightLostKg,
      dailyCalorieTarget: profile?.dailyCalorieTarget ?? null,
      dailyProteinTargetG: profile?.dailyProteinTargetG ?? null,
      todaysFoodExpense,
      currency: profile?.currency || 'INR',
      weightUnit: profile?.preferredWeightUnit || 'KG',
    },
    nutrition: {
      caloriesConsumed,
      caloriesTarget: profile?.dailyCalorieTarget ?? null,
      proteinConsumedG,
      proteinTargetG: profile?.dailyProteinTargetG ?? null,
      carbsConsumedG,
      carbsTargetG: profile?.dailyCarbTargetG ?? null,
      fatConsumedG,
      fatTargetG: profile?.dailyFatTargetG ?? null,
      hasDietPlan: plannedMeals.length > 0,
    },
    todaysSchedule: {
      meals: plannedMeals,
      workout: todaySplit
        ? {
            day: todaySplit.day,
            focus: todaySplit.focus,
            isRestDay: todaySplit.isRestDay,
            exerciseCount: todaySplit.exercises.length,
            completedToday: Boolean(todaysWorkoutSession),
          }
        : null,
    },
    workoutOverview: {
      todaysWorkout: todaysWorkoutSession,
      plannedExercisesCount: todaySplit?.exercises.length ?? 0,
      completedExercisesCount: todaysWorkoutSession?.exercises.length ?? 0,
      weeklyCompletedCount: weeklyCompletedDates.size,
      weeklyTargetCount,
      totalVolumeKg: todaysWorkoutSession?.totalVolumeKg ?? null,
    },
    measurementOverview: {
      latestWeightKg: currentWeightKg,
      latestWaist,
      latestChest,
      latestHips,
      latestCalves,
      latestBodyFat,
      unit: profile?.preferredMeasureUnit || 'CM',
    },
    charts: {
      weightTrend,
      calorieTrend,
      workoutVolumeTrend,
    },
  };
}
