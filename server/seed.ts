import type { Prisma } from '@prisma/client';
import { prisma, withTransaction } from './prisma.js';
import type { Exercise, FoodItem, WorkoutDaySplit } from './types.js';
import { generateId } from './utils/crypto.js';

/**
 * Sentinel value stored in `users.passwordHash` for pre-seeded friend & family
 * accounts before the recipient chooses their personal password on first sign-in.
 * Because it lacks a `salt:hex` pair, `verifyPassword()` always rejects it.
 */
export const UNCLAIMED_PASSWORD_SENTINEL = 'UNCLAIMED';

export function isUnclaimedPasswordHash(hash: string | null | undefined): boolean {
  const trimmed = (hash ?? '').trim();
  return trimmed === '' || trimmed === UNCLAIMED_PASSWORD_SENTINEL;
}

export interface SeededAccountSpec {
  name: string;
  email: string;
}

/**
 * Edit this list to pre-seed accounts for friends & family members.
 * Each email gets its own isolated FitTrack profile, starter food library,
 * starter exercise library, and 7-day split. Recipients set their own password
 * the first time they sign in / activate their account.
 *
 * You can also add comma-separated emails via the `SEEDED_EMAILS` env var
 * (e.g. `SEEDED_EMAILS="sister@gmail.com,Rahul <rahul@gmail.com>"`).
 */
export const SEEDED_ACCOUNTS: SeededAccountSpec[] = [
  { name: 'Aman Rehman', email: 'aman@gmail.com' },
  { name: 'Kaleem Ahmed', email: 'kaleemahmed@gmail.com' },
  { name: 'Mohd Owais', email: 'mohdowais@gmail.com' },
];

function parseSeededEmailsEnv(raw: string | undefined): SeededAccountSpec[] {
  if (!raw?.trim()) return [];
  const entries: SeededAccountSpec[] = [];

  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    // Support either "Name <email@domain.com>" or plain "email@domain.com"
    const angleMatch = trimmed.match(/^(.+?)\s*<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>$/);
    if (angleMatch) {
      const name = angleMatch[1].trim();
      const email = angleMatch[2].trim().toLowerCase();
      entries.push({ name: name || email.split('@')[0], email });
      continue;
    }

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      const email = trimmed.toLowerCase();
      const localPart = email.split('@')[0] || 'Member';
      const fallbackName = localPart.charAt(0).toUpperCase() + localPart.slice(1);
      entries.push({ name: fallbackName, email });
    }
  }

  return entries;
}

export function getConfiguredSeededAccounts(): SeededAccountSpec[] {
  const combined = [...SEEDED_ACCOUNTS, ...parseSeededEmailsEnv(process.env.SEEDED_EMAILS)];
  const deduped = new Map<string, SeededAccountSpec>();

  for (const item of combined) {
    const email = item.email.trim().toLowerCase();
    if (!email) continue;
    deduped.set(email, {
      name: item.name.trim() || email.split('@')[0] || 'Member',
      email,
    });
  }

  return Array.from(deduped.values());
}

export function isEmailSeeded(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return getConfiguredSeededAccounts().some((acc) => acc.email === normalized);
}

export function buildStarterFoods(userId: string): FoodItem[] {
  const now = new Date().toISOString();
  const raw: Array<Omit<FoodItem, 'id' | 'userId' | 'isDefault' | 'createdAt'>> = [
    { name: 'Whole Eggs (Boiled)', category: 'NON_VEG', servingLabel: '1 large egg (50g)', servingGrams: 50, calories: 72, proteinG: 6.3, carbsG: 0.4, fatG: 5, priceInr: 8 },
    { name: 'Egg Whites', category: 'NON_VEG', servingLabel: '1 egg white (33g)', servingGrams: 33, calories: 17, proteinG: 3.6, carbsG: 0.2, fatG: 0.1, priceInr: 7 },
    { name: 'Paneer (Low-Fat / Home)', category: 'VEG', servingLabel: '100g', servingGrams: 100, calories: 265, proteinG: 18, carbsG: 3.5, fatG: 20, priceInr: 45 },
    { name: 'Chicken Breast (Raw/Grilled)', category: 'NON_VEG', servingLabel: '100g', servingGrams: 100, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, priceInr: 38 },
    { name: 'Rolled Oats', category: 'VEGAN', servingLabel: '50g dry', servingGrams: 50, calories: 190, proteinG: 6.5, carbsG: 33, fatG: 3.5, priceInr: 14 },
    { name: 'Whey Protein Isolate', category: 'SUPPLEMENT', servingLabel: '1 scoop (30g)', servingGrams: 30, calories: 118, proteinG: 25, carbsG: 1.5, fatG: 1, priceInr: 75 },
    { name: 'Whole Wheat Roti / Phulka', category: 'VEGAN', servingLabel: '1 medium roti (35g)', servingGrams: 35, calories: 104, proteinG: 3.2, carbsG: 20, fatG: 1.2, priceInr: 5 },
    { name: 'Cooked White Rice', category: 'VEGAN', servingLabel: '1 bowl (150g)', servingGrams: 150, calories: 195, proteinG: 4, carbsG: 42, fatG: 0.4, priceInr: 10 },
    { name: 'Toor / Moong Dal (Cooked)', category: 'VEGAN', servingLabel: '1 katori (150g)', servingGrams: 150, calories: 165, proteinG: 9.5, carbsG: 26, fatG: 2.5, priceInr: 18 },
    { name: 'Greek Yogurt / Hung Curd', category: 'VEG', servingLabel: '100g', servingGrams: 100, calories: 95, proteinG: 10, carbsG: 4, fatG: 4, priceInr: 35 },
    { name: 'Soya Chunks (Dry)', category: 'VEGAN', servingLabel: '50g dry', servingGrams: 50, calories: 172, proteinG: 26, carbsG: 16, fatG: 0.3, priceInr: 12 },
    { name: 'Banana (Medium)', category: 'VEGAN', servingLabel: '1 piece (118g)', servingGrams: 118, calories: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4, priceInr: 7 },
    { name: 'Peanut Butter (Unsweetened)', category: 'VEGAN', servingLabel: '1 tbsp (16g)', servingGrams: 16, calories: 94, proteinG: 4, carbsG: 3, fatG: 8, priceInr: 10 },
    { name: 'Toned Milk', category: 'VEG', servingLabel: '250ml glass', servingGrams: 250, calories: 150, proteinG: 7.5, carbsG: 12, fatG: 7.5, priceInr: 16 },
    { name: 'Almonds (Soaked)', category: 'VEGAN', servingLabel: '10 almonds (12g)', servingGrams: 12, calories: 70, proteinG: 2.5, carbsG: 2.5, fatG: 6, priceInr: 12 },
    { name: 'Mixed Sprouts (Moong/Chana)', category: 'VEGAN', servingLabel: '100g', servingGrams: 100, calories: 115, proteinG: 8.5, carbsG: 18, fatG: 1, priceInr: 15 },
    { name: 'Sweet Potato (Boiled)', category: 'VEGAN', servingLabel: '150g', servingGrams: 150, calories: 130, proteinG: 2.4, carbsG: 30, fatG: 0.2, priceInr: 14 },
    { name: 'Creatine Monohydrate', category: 'SUPPLEMENT', servingLabel: '1 scoop (5g)', servingGrams: 5, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, priceInr: 14 },
  ];

  return raw.map((item) => ({
    ...item,
    id: generateId('food'),
    userId,
    isDefault: true,
    createdAt: now,
  }));
}

export function buildStarterExercises(userId: string): Exercise[] {
  const now = new Date().toISOString();
  const raw: Array<Omit<Exercise, 'id' | 'userId' | 'isDefault' | 'createdAt'>> = [
    { name: 'Barbell Bench Press', muscleGroup: 'CHEST', equipment: 'Barbell', defaultSets: 4, defaultReps: '6-8', instructions: 'Retract scapulae, lower bar to mid-chest with controlled 2s eccentric, press explosively.' },
    { name: 'Incline Dumbbell Press', muscleGroup: 'CHEST', equipment: 'Dumbbell', defaultSets: 3, defaultReps: '8-12', instructions: 'Set bench to 30 degrees. Keep elbows tucked at 45 degrees.' },
    { name: 'Cable Chest Fly', muscleGroup: 'CHEST', equipment: 'Cable', defaultSets: 3, defaultReps: '12-15', instructions: 'Maintain soft elbow bend and squeeze pecs together at midline.' },
    { name: 'Pull-Ups / Assisted Pull-Ups', muscleGroup: 'BACK', equipment: 'Bodyweight', defaultSets: 4, defaultReps: '6-10', instructions: 'Initiate pull by driving elbows down toward hips, chin over bar.' },
    { name: 'Barbell Bent-Over Row', muscleGroup: 'BACK', equipment: 'Barbell', defaultSets: 4, defaultReps: '8-10', instructions: 'Hinge at hips with neutral spine, pull bar to lower sternum.' },
    { name: 'Lat Pulldown', muscleGroup: 'BACK', equipment: 'Cable', defaultSets: 3, defaultReps: '10-12', instructions: 'Grip slightly wider than shoulder width, pull to upper chest without swinging.' },
    { name: 'Barbell Back Squat', muscleGroup: 'LEGS', equipment: 'Barbell', defaultSets: 4, defaultReps: '6-8', instructions: 'Brace core, sit hips back and down until thighs reach parallel or below.' },
    { name: 'Romanian Deadlift', muscleGroup: 'LEGS', equipment: 'Barbell', defaultSets: 3, defaultReps: '8-10', instructions: 'Push hips straight back while keeping bar tight against legs until deep hamstring stretch.' },
    { name: 'Leg Press', muscleGroup: 'LEGS', equipment: 'Machine', defaultSets: 3, defaultReps: '10-12', instructions: 'Full controlled depth without lower back rounding off the pad.' },
    { name: 'Walking Lunges', muscleGroup: 'LEGS', equipment: 'Dumbbell', defaultSets: 3, defaultReps: '12/leg', instructions: 'Step forward into 90-degree knee angles and drive through front heel.' },
    { name: 'Overhead Barbell Press', muscleGroup: 'SHOULDERS', equipment: 'Barbell', defaultSets: 4, defaultReps: '6-8', instructions: 'Squeeze glutes and core, press vertically overhead and lock out over mid-foot.' },
    { name: 'Dumbbell Lateral Raises', muscleGroup: 'SHOULDERS', equipment: 'Dumbbell', defaultSets: 4, defaultReps: '12-15', instructions: 'Lead with elbows slightly forward in scapular plane, pause briefly at shoulder height.' },
    { name: 'Face Pulls', muscleGroup: 'SHOULDERS', equipment: 'Cable', defaultSets: 3, defaultReps: '15-20', instructions: 'Pull rope toward forehead while externally rotating shoulders.' },
    { name: 'Barbell / EZ-Bar Bicep Curl', muscleGroup: 'ARMS', equipment: 'Barbell', defaultSets: 3, defaultReps: '10-12', instructions: 'Keep upper arms pinned to torso and control the lowering phase.' },
    { name: 'Tricep Rope Pushdown', muscleGroup: 'ARMS', equipment: 'Cable', defaultSets: 3, defaultReps: '12-15', instructions: 'Flare rope apart at bottom lockout while keeping elbows stationary.' },
    { name: 'Hammer Curls', muscleGroup: 'ARMS', equipment: 'Dumbbell', defaultSets: 3, defaultReps: '10-12', instructions: 'Neutral grip targeting brachialis and forearms without torso momentum.' },
    { name: 'Hanging Leg Raises', muscleGroup: 'CORE', equipment: 'Bodyweight', defaultSets: 3, defaultReps: '12-15', instructions: 'Posteriorly tilt pelvis to curl legs upward using lower abs.' },
    { name: 'Plank Hold', muscleGroup: 'CORE', equipment: 'Bodyweight', defaultSets: 3, defaultReps: '60s', instructions: 'Maintain straight line from head to heels, brace abs and glutes.' },
    { name: 'Incline Treadmill Walk', muscleGroup: 'CARDIO', equipment: 'Treadmill', defaultSets: 1, defaultReps: '25 min', instructions: 'Steady-state Zone 2 incline walk at 10-12% grade, 4.5-5.5 km/h.' },
  ];

  return raw.map((item) => ({
    ...item,
    defaultRestSeconds: 90,
    defaultWeightKg: null,
    imageUrl: null,
    videoUrl: null,
    id: generateId('ex'),
    userId,
    isDefault: true,
    createdAt: now,
  }));
}

export function buildEmptyWeeklySplit(): WorkoutDaySplit[] {
  return [
    { day: 'MON', focus: 'Push (Chest, Shoulders, Triceps)', isRestDay: false, exercises: [] },
    { day: 'TUE', focus: 'Pull (Back, Rear Delts, Biceps)', isRestDay: false, exercises: [] },
    { day: 'WED', focus: 'Legs & Core', isRestDay: false, exercises: [] },
    { day: 'THU', focus: 'Upper Body Hypertrophy', isRestDay: false, exercises: [] },
    { day: 'FRI', focus: 'Lower Body & Conditioning', isRestDay: false, exercises: [] },
    { day: 'SAT', focus: 'Arms, Weak Points & Zone 2 Cardio', isRestDay: false, exercises: [] },
    { day: 'SUN', focus: 'Active Recovery & Mobility', isRestDay: true, exercises: [] },
  ];
}

export async function seedStarterWorkspaceForUser(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date
) {
  const existingProfile = await tx.fitnessProfile.findUnique({ where: { userId } });
  const profileRow =
    existingProfile ??
    (await tx.fitnessProfile.create({
      data: {
        id: generateId('prof'),
        userId,
        age: null,
        gender: null,
        heightCm: null,
        startingWeightKg: null,
        currentWeightKg: null,
        targetWeightKg: null,
        targetWaistCm: null,
        targetBodyFatPct: null,
        fitnessGoal: 'MAINTENANCE',
        activityLevel: 'MODERATELY_ACTIVE',
        dailyCalorieTarget: null,
        dailyProteinTargetG: null,
        dailyCarbTargetG: null,
        dailyFatTargetG: null,
        preferredWeightUnit: 'KG',
        preferredMeasureUnit: 'CM',
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        theme: 'dark',
        geminiEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
    }));

  const [foodsCount, exercisesCount] = await Promise.all([
    tx.foodItem.count({ where: { userId } }),
    tx.exercise.count({ where: { userId } }),
  ]);

  if (foodsCount === 0) {
    const starterFoods = buildStarterFoods(userId).map((f) => ({
      ...f,
      createdAt: new Date(f.createdAt),
    }));
    if (starterFoods.length > 0) {
      await tx.foodItem.createMany({ data: starterFoods });
    }
  }

  if (exercisesCount === 0) {
    const starterExercises = buildStarterExercises(userId).map((ex) => ({
      ...ex,
      defaultRestSeconds: ex.defaultRestSeconds ?? 90,
      defaultWeightKg: ex.defaultWeightKg ?? null,
      imageUrl: ex.imageUrl ?? null,
      videoUrl: ex.videoUrl ?? null,
      createdAt: new Date(ex.createdAt),
    }));
    if (starterExercises.length > 0) {
      await tx.exercise.createMany({ data: starterExercises });
    }
  }

  const emptySplit = buildEmptyWeeklySplit().map((day) => ({
    userId,
    day: day.day,
    focus: day.focus,
    isRestDay: day.isRestDay,
  }));
  await tx.workoutDaySplit.createMany({ data: emptySplit, skipDuplicates: true });

  return profileRow;
}

let lastSeededSignature: string | null = null;
let syncPromise: Promise<{ created: string[]; existing: string[] }> | null = null;

/**
 * Idempotently inserts any missing emails from `SEEDED_ACCOUNTS` / `SEEDED_EMAILS`
 * as unclaimed accounts (`passwordHash: 'UNCLAIMED'`) with starter libraries.
 * Existing accounts and their passwords/data are never modified.
 */
export async function ensureSeededAccounts(
  force = false
): Promise<{ created: string[]; existing: string[] }> {
  const configured = getConfiguredSeededAccounts();
  if (configured.length === 0) {
    return { created: [], existing: [] };
  }

  const signature = configured.map((c) => c.email).join(',');
  if (!force && lastSeededSignature === signature) {
    return { created: [], existing: configured.map((c) => c.email) };
  }
  if (syncPromise) {
    return syncPromise;
  }

  syncPromise = (async () => {
    const existingRows = await prisma.user.findMany({
      select: { email: true },
    });
    const existingSet = new Set(existingRows.map((row) => row.email.trim().toLowerCase()));

    const created: string[] = [];
    const existing: string[] = [];

    for (const account of configured) {
      if (existingSet.has(account.email)) {
        existing.push(account.email);
        continue;
      }

      try {
        await withTransaction(async (tx) => {
          const recheck = await tx.user.findUnique({
            where: { email: account.email },
            select: { id: true },
          });
          if (recheck) {
            existing.push(account.email);
            return;
          }

          const now = new Date();
          const userId = generateId('usr');
          await tx.user.create({
            data: {
              id: userId,
              name: account.name,
              email: account.email,
              passwordHash: UNCLAIMED_PASSWORD_SENTINEL,
              avatarUrl: null,
              createdAt: now,
              updatedAt: now,
            },
          });

          await seedStarterWorkspaceForUser(tx, userId, now);
          created.push(account.email);
        });
      } catch (err: unknown) {
        // Ignore concurrent duplicate email inserts cleanly
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code?: string }).code === 'P2002'
        ) {
          existing.push(account.email);
        } else {
          throw err;
        }
      }
    }

    lastSeededSignature = signature;
    return { created, existing };
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}
