import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import {
  assertDatabaseConfigured,
  DAY_ORDER,
  prisma,
  toApiBodyMeasurement,
  toApiExercise,
  toApiFood,
  toApiMealLog,
  toApiPlannedMeal,
  toApiProfile,
  toApiSavedPlan,
  toApiWorkoutDaySplit,
  toApiWorkoutSession,
  withTransaction,
} from '../db.js';
import { buildEmptyWeeklySplit } from '../seed.js';
import type {
  DayOfWeek,
  DietTag,
  Exercise,
  FoodItem,
  MuscleGroup,
  PlannedMeal,
  WorkoutDaySplit,
} from '../types.js';
import { generateId } from '../utils/crypto.js';
import { AppError } from '../utils/error.js';

export const FITTRACK_DATA_SCHEMA_VERSION = '1.0' as const;

export type ImportExportScope = 'DIET' | 'WORKOUT' | 'MEASUREMENTS' | 'FULL_BACKUP';
export type ImportMode = 'MERGE' | 'REPLACE';

export interface ImportValidationIssue {
  field: string;
  message: string;
}

export interface PreviewRecordEntry {
  status: 'CREATE' | 'DUPLICATE_SKIP' | 'REPLACE' | 'UPDATE';
  title: string;
  subtitle: string;
}

export interface ImportCategorySummary {
  created: number;
  duplicatesSkipped: number;
  replaced: number;
  updated: number;
}

export interface ImportPreviewResult {
  valid: boolean;
  importType: ImportExportScope;
  mode: ImportMode;
  errors: ImportValidationIssue[];
  warnings: string[];
  totals: ImportCategorySummary;
  categories: {
    profile?: ImportCategorySummary;
    foods: ImportCategorySummary;
    plannedMeals: ImportCategorySummary;
    mealLogs: ImportCategorySummary;
    exercises: ImportCategorySummary;
    workoutSplit: ImportCategorySummary;
    workoutSessions: ImportCategorySummary;
    measurements: ImportCategorySummary;
    savedPlans: ImportCategorySummary;
  };
  records: {
    profile: PreviewRecordEntry[];
    foods: PreviewRecordEntry[];
    plannedMeals: PreviewRecordEntry[];
    mealLogs: PreviewRecordEntry[];
    exercises: PreviewRecordEntry[];
    workoutSplit: PreviewRecordEntry[];
    workoutSessions: PreviewRecordEntry[];
    measurements: PreviewRecordEntry[];
    savedPlans: PreviewRecordEntry[];
  };
}

export interface ImportCommitResult {
  success: boolean;
  importType: ImportExportScope;
  mode: ImportMode;
  totals: ImportCategorySummary;
  categories: ImportPreviewResult['categories'];
  warnings: string[];
}

const isSafeImageUrl = (val: string) =>
  /^https?:\/\/.+/i.test(val) || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(val);

const isSafeVideoUrl = (val: string) =>
  /^https?:\/\/.+/i.test(val) || /^data:video\/(mp4|webm|ogg|quicktime);base64,/i.test(val);

const optionalMediaUrl = (validator: (val: string) => boolean, maxLen: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .max(maxLen, `${label} is too large`)
      .refine((v) => validator(v), `Invalid ${label} format. Use http(s) URL or valid data URI.`)
      .nullable()
      .optional()
  );

const optionalPositiveNumber = (max: number) =>
  z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().positive().max(max).nullable().optional()
  );

const optionalNonNegativeNumber = (max: number) =>
  z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().min(0).max(max).nullable().optional()
  );

const optionalPositiveInt = (max: number) =>
  z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().int().positive().max(max).nullable().optional()
  );

const ALLOWED_MUSCLE_GROUPS = [
  'CHEST',
  'BACK',
  'LEGS',
  'SHOULDERS',
  'ARMS',
  'CORE',
  'CARDIO',
] as const;

export function normalizeMuscleGroupValue(val: unknown): {
  value: unknown;
  mappedFrom?: string;
} {
  if (typeof val !== 'string') return { value: val };
  const upper = val.trim().toUpperCase();
  if (upper === 'TRICEPS' || upper === 'BICEPS') {
    return { value: 'ARMS', mappedFrom: upper };
  }
  if (upper === 'ABS') {
    return { value: 'CORE', mappedFrom: upper };
  }
  return { value: upper };
}

const dietTagEnum = z.enum(['VEG', 'NON_VEG', 'VEGAN', 'SUPPLEMENT']);
const muscleGroupEnum = z.preprocess(
  (val) => normalizeMuscleGroupValue(val).value,
  z.enum(ALLOWED_MUSCLE_GROUPS, {
    message:
      'Invalid muscleGroup. Allowed values are CHEST, BACK, LEGS, SHOULDERS, ARMS, CORE, and CARDIO.',
  })
);
const dayEnum = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

const repsStringSchema = (fieldLabel: string) =>
  z.preprocess(
    (val) => (typeof val === 'number' ? String(val) : val),
    z.string().trim().min(1, `${fieldLabel} is required`).max(30)
  );

const optionalStringWithDefault = (max: number, fallback: string) =>
  z.preprocess(
    (val) => (val === null || val === undefined ? fallback : val),
    z.string().trim().max(max).default(fallback)
  );

export const foodImportSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1, 'Food name is required').max(120),
  category: dietTagEnum.default('VEG'),
  servingLabel: z.string().trim().min(1, 'Serving label is required').max(60).default('1 serving (100g)'),
  servingGrams: z.coerce.number().positive('servingGrams must be > 0').max(5000).default(100),
  calories: z.coerce.number().min(0, 'calories must be >= 0').max(5000),
  proteinG: z.coerce.number().min(0, 'proteinG must be >= 0').max(500),
  carbsG: z.coerce.number().min(0, 'carbsG must be >= 0').max(500).default(0),
  fatG: z.coerce.number().min(0, 'fatG must be >= 0').max(500).default(0),
  priceInr: z.coerce.number().min(0, 'priceInr must be >= 0').max(50000).default(0),
  isDefault: z.boolean().optional(),
});

export const plannedMealItemImportSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  foodId: z.string().trim().min(1).max(120).optional(),
  foodName: z.string().trim().min(1, 'foodName is required').max(120),
  servings: z.coerce.number().positive('servings must be > 0').max(50),
  servingLabel: z.string().trim().min(1).max(60).optional(),
  calories: z.coerce.number().min(0).max(10000).optional(),
  proteinG: z.coerce.number().min(0).max(1000).optional(),
  carbsG: z.coerce.number().min(0).max(1000).optional(),
  fatG: z.coerce.number().min(0).max(1000).optional(),
  priceInr: z.coerce.number().min(0).max(100000).optional(),
  category: dietTagEnum.optional(),
  servingGrams: z.coerce.number().positive().max(5000).optional(),
});

export const plannedMealImportSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1, 'Meal name is required').max(80),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be valid HH:MM 24h format (00:00–23:59)'),
  items: z.array(plannedMealItemImportSchema).default([]),
});

export const mealLogImportSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  mealName: z.string().trim().min(1, 'mealName is required').max(80),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be valid HH:MM 24h format (00:00–23:59)').default('12:00'),
  foodId: z.string().trim().min(1).max(120).nullable().optional(),
  foodName: z.string().trim().min(1, 'foodName is required').max(120),
  servings: z.coerce.number().positive('servings must be > 0').max(50),
  servingLabel: z.string().trim().min(1).max(60).default('1 serving'),
  calories: z.coerce.number().min(0).max(10000),
  proteinG: z.coerce.number().min(0).max(1000),
  carbsG: z.coerce.number().min(0).max(1000).default(0),
  fatG: z.coerce.number().min(0).max(1000).default(0),
  priceInr: z.coerce.number().min(0).max(100000).default(0),
  plannedMealId: z.string().trim().min(1).max(120).nullable().optional(),
});

export const exerciseImportSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1, 'Exercise name is required').max(120),
  muscleGroup: muscleGroupEnum,
  equipment: z.preprocess(
    (val) => (val === null || val === undefined || (typeof val === 'string' && !val.trim()) ? 'Bodyweight' : val),
    z.string().trim().min(1, 'equipment is required').max(60)
  ),
  defaultSets: z.coerce.number().int().positive('defaultSets must be >= 1').max(20).default(3),
  defaultReps: repsStringSchema('defaultReps').default('8-12'),
  defaultRestSeconds: z.coerce.number().int().min(0).max(600).default(90),
  defaultWeightKg: optionalNonNegativeNumber(1000),
  instructions: optionalStringWithDefault(1000, ''),
  imageUrl: optionalMediaUrl(isSafeImageUrl, 3_500_000, 'exercise imageUrl'),
  videoUrl: optionalMediaUrl(isSafeVideoUrl, 12_000_000, 'exercise videoUrl'),
  isDefault: z.boolean().optional(),
});

export const splitExerciseImportSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  exerciseId: z.string().trim().min(1).max(120).optional(),
  exerciseName: z.string().trim().min(1, 'exerciseName is required').max(120),
  muscleGroup: muscleGroupEnum,
  targetSets: z.coerce.number().int().positive('targetSets must be >= 1').max(20),
  targetReps: repsStringSchema('targetReps'),
  restSeconds: z.coerce.number().int().min(0, 'restSeconds must be >= 0').max(600).default(90),
  targetWeightKg: optionalNonNegativeNumber(1000),
  instructions: z.preprocess(
    (val) => (val === null ? '' : val),
    z.string().trim().max(1000).optional()
  ),
  imageUrl: optionalMediaUrl(isSafeImageUrl, 3_500_000, 'exercise imageUrl'),
  videoUrl: optionalMediaUrl(isSafeVideoUrl, 12_000_000, 'exercise videoUrl'),
});

export const workoutDaySplitImportSchema = z.object({
  day: dayEnum,
  focus: z.string().trim().min(1, 'focus is required').max(120),
  isRestDay: z.boolean().default(false),
  exercises: z.array(splitExerciseImportSchema).default([]),
});

export const workoutSessionImportSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  day: dayEnum,
  title: z.string().trim().min(1, 'title is required').max(120),
  durationMinutes: z.coerce.number().int().min(1).max(360),
  totalVolumeKg: z.coerce.number().int().min(0).max(500000).optional(),
  notes: optionalStringWithDefault(500, ''),
  exercises: z.array(
    z.object({
      exerciseId: z.string().trim().min(1).max(120).optional(),
      exerciseName: z.string().trim().min(1).max(120),
      muscleGroup: muscleGroupEnum,
      instructions: z.preprocess(
        (val) => (val === null ? '' : val),
        z.string().trim().max(1000).optional()
      ),
      imageUrl: optionalMediaUrl(isSafeImageUrl, 3_500_000, 'exercise imageUrl'),
      videoUrl: optionalMediaUrl(isSafeVideoUrl, 12_000_000, 'exercise videoUrl'),
      sets: z
        .array(
          z.object({
            setNumber: z.coerce.number().int().positive(),
            reps: z.coerce.number().int().min(0).max(500),
            weightKg: z.coerce.number().min(0).max(1000),
            completed: z.boolean().default(true),
          })
        )
        .default([]),
    })
  ),
});

export const measurementImportSchema = z
  .object({
    id: z.string().trim().min(1).max(120).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    weightKg: optionalPositiveNumber(400),
    bodyFatPct: optionalPositiveNumber(80),
    waistCm: optionalPositiveNumber(300),
    chestCm: optionalPositiveNumber(300),
    hipsCm: optionalPositiveNumber(300),
    armsCm: optionalPositiveNumber(150),
    thighsCm: optionalPositiveNumber(200),
    neckCm: optionalPositiveNumber(120),
    calvesCm: optionalPositiveNumber(150),
    customMeasurements: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(120).optional(),
          label: z.string().trim().min(1, 'Custom measurement label is required').max(60),
          valueCm: z.coerce.number().positive('valueCm must be > 0').max(350),
        })
      )
      .max(15)
      .optional(),
    photoDataUrl: optionalMediaUrl(isSafeImageUrl, 4_000_000, 'measurement photoDataUrl'),
    notes: z.string().trim().max(500).default(''),
  })
  .refine(
    (m) =>
      m.weightKg != null ||
      m.bodyFatPct != null ||
      m.waistCm != null ||
      m.chestCm != null ||
      m.hipsCm != null ||
      m.armsCm != null ||
      m.thighsCm != null ||
      m.neckCm != null ||
      m.calvesCm != null ||
      (m.customMeasurements && m.customMeasurements.length > 0) ||
      Boolean(m.notes),
    { message: 'Measurement entry must contain at least one measurement value or note.' }
  );

export const savedPlanImportSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().trim().min(1).max(120).optional(),
    type: z.literal('DIET'),
    name: z.string().trim().min(2, 'Saved plan name must be >= 2 characters').max(100),
    description: z.string().trim().max(300).default(''),
    payload: z.array(plannedMealImportSchema).min(1, 'DIET saved plan payload must include at least 1 meal'),
  }),
  z.object({
    id: z.string().trim().min(1).max(120).optional(),
    type: z.literal('WORKOUT'),
    name: z.string().trim().min(2, 'Saved plan name must be >= 2 characters').max(100),
    description: z.string().trim().max(300).default(''),
    payload: z
      .array(workoutDaySplitImportSchema)
      .min(1, 'WORKOUT saved plan payload must include at least 1 workout day'),
  }),
]);

export const profileImportSchema = z.object({
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
  geminiEnabled: z.boolean().optional(),
});

const fullPayloadObjectSchema = z.object({
  schemaVersion: z.string().trim().optional(),
  exportType: z.enum(['DIET', 'WORKOUT', 'MEASUREMENTS', 'FULL_BACKUP']).optional(),
  exportedAt: z.string().optional(),
  profile: profileImportSchema.nullable().optional(),
  foods: z.array(foodImportSchema).max(500).optional(),
  plannedMeals: z.array(plannedMealImportSchema).max(100).optional(),
  mealLogs: z.array(mealLogImportSchema).max(2000).optional(),
  exercises: z.array(exerciseImportSchema).max(500).optional(),
  workoutSplit: z.array(workoutDaySplitImportSchema).max(7).optional(),
  workoutSessions: z.array(workoutSessionImportSchema).max(1000).optional(),
  measurements: z.array(measurementImportSchema).max(2000).optional(),
  savedPlans: z.array(savedPlanImportSchema).max(100).optional(),
});

type ParsedImportPayload = z.infer<typeof fullPayloadObjectSchema>;

function emptyCategorySummary(): ImportCategorySummary {
  return { created: 0, duplicatesSkipped: 0, replaced: 0, updated: 0 };
}

function zodIssuesToValidationIssues(err: ZodError): ImportValidationIssue[] {
  return err.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'root',
    message: issue.message,
  }));
}

function enrichExportSplit(
  split: WorkoutDaySplit[],
  exercises: Exercise[]
): WorkoutDaySplit[] {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return split.map((day) => ({
    ...day,
    exercises: day.exercises.map((item) => {
      const lib = byId.get(item.exerciseId);
      return {
        ...item,
        exerciseName: lib ? lib.name : item.exerciseName,
        muscleGroup: lib ? lib.muscleGroup : item.muscleGroup,
        targetWeightKg: item.targetWeightKg ?? lib?.defaultWeightKg ?? null,
        instructions: lib ? lib.instructions : item.instructions ?? '',
        imageUrl: lib ? (lib.imageUrl ?? null) : (item.imageUrl ?? null),
        videoUrl: lib ? (lib.videoUrl ?? null) : (item.videoUrl ?? null),
      };
    }),
  }));
}

export function getDocumentedJsonSchema() {
  return {
    schemaVersion: FITTRACK_DATA_SCHEMA_VERSION,
    description:
      'FitTrack Portable JSON Schema matching Prisma PostgreSQL models (FoodItem, PlannedMeal, MealLog, Exercise, WorkoutDaySplit, WorkoutSession, BodyMeasurement, SavedPlan, FitnessProfile).',
    exportTypes: ['DIET', 'WORKOUT', 'MEASUREMENTS', 'FULL_BACKUP'],
    enums: {
      DietTag: ['VEG', 'NON_VEG', 'VEGAN', 'SUPPLEMENT'],
      MuscleGroup: ['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'CARDIO'],
      DayOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      FitnessGoal: ['FAT_LOSS', 'MUSCLE_GAIN', 'MAINTENANCE', 'RECOMPOSITION'],
      ActivityLevel: [
        'SEDENTARY',
        'LIGHTLY_ACTIVE',
        'MODERATELY_ACTIVE',
        'VERY_ACTIVE',
        'EXTREMELY_ACTIVE',
      ],
      WeightUnit: ['KG', 'LBS'],
      MeasurementUnit: ['CM', 'INCHES'],
    },
    examples: {
      DIET: {
        schemaVersion: FITTRACK_DATA_SCHEMA_VERSION,
        exportType: 'DIET',
        foods: [
          {
            name: 'Greek Yogurt (Plain)',
            category: 'VEG',
            servingLabel: '1 cup (170g)',
            servingGrams: 170,
            calories: 100,
            proteinG: 17,
            carbsG: 6,
            fatG: 0.7,
            priceInr: 75,
          },
        ],
        plannedMeals: [
          {
            name: 'Breakfast',
            time: '08:30',
            items: [
              {
                foodName: 'Greek Yogurt (Plain)',
                servings: 1.5,
              },
            ],
          },
        ],
        savedPlans: [],
      },
      WORKOUT: {
        schemaVersion: FITTRACK_DATA_SCHEMA_VERSION,
        exportType: 'WORKOUT',
        exercises: [
          {
            name: 'Incline Dumbbell Press',
            muscleGroup: 'CHEST',
            equipment: 'Dumbbells',
            defaultSets: 4,
            defaultReps: '8-10',
            defaultRestSeconds: 90,
            defaultWeightKg: 22.5,
            instructions: 'Set bench to 30 degrees, control eccentric for 2 seconds.',
          },
        ],
        workoutSplit: [
          {
            day: 'MON',
            focus: 'Upper Push',
            isRestDay: false,
            exercises: [
              {
                exerciseName: 'Incline Dumbbell Press',
                muscleGroup: 'CHEST',
                targetSets: 4,
                targetReps: '8-10',
                restSeconds: 90,
                targetWeightKg: 22.5,
                instructions: 'Set bench to 30 degrees, control eccentric for 2 seconds.',
              },
            ],
          },
        ],
        savedPlans: [],
      },
      MEASUREMENTS: {
        schemaVersion: FITTRACK_DATA_SCHEMA_VERSION,
        exportType: 'MEASUREMENTS',
        measurements: [
          {
            date: new Date().toISOString().slice(0, 10),
            weightKg: 74.2,
            bodyFatPct: 16.5,
            waistCm: 81.5,
            chestCm: 101.0,
            armsCm: 36.5,
            customMeasurements: [{ label: 'Forearms', valueCm: 29.5 }],
            notes: 'Morning fasted check-in',
          },
        ],
      },
    },
  };
}

export async function exportUserData(
  userId: string,
  userMeta: { id: string; name: string; email: string },
  scope: ImportExportScope
) {
  assertDatabaseConfigured();
  const exportedAt = new Date().toISOString();

  if (scope === 'DIET') {
    const [foods, plannedMeals, mealLogs, savedPlans] = await Promise.all([
      prisma.foodItem.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      prisma.plannedMeal.findMany({
        where: { userId },
        orderBy: { time: 'asc' },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      }),
      prisma.mealLog.findMany({ where: { userId }, orderBy: [{ date: 'desc' }, { time: 'asc' }] }),
      prisma.savedPlan.findMany({
        where: { userId, type: 'DIET' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      schemaVersion: FITTRACK_DATA_SCHEMA_VERSION,
      exportType: 'DIET' as const,
      exportedAt,
      user: { id: userMeta.id, name: userMeta.name, email: userMeta.email },
      foods: foods.map(toApiFood),
      plannedMeals: plannedMeals.map(toApiPlannedMeal),
      mealLogs: mealLogs.map(toApiMealLog),
      savedPlans: savedPlans.map(toApiSavedPlan),
    };
  }

  if (scope === 'WORKOUT') {
    const [exercisesRaw, workoutSplitsRaw, workoutSessions, savedPlans] = await Promise.all([
      prisma.exercise.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      prisma.workoutDaySplit.findMany({
        where: { userId },
        include: { exercises: { orderBy: { sortOrder: 'asc' } } },
      }),
      prisma.workoutSession.findMany({
        where: { userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.savedPlan.findMany({
        where: { userId, type: 'WORKOUT' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const apiExercises = exercisesRaw.map(toApiExercise);
    const orderedSplits =
      workoutSplitsRaw.length > 0
        ? [...workoutSplitsRaw]
            .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
            .map(toApiWorkoutDaySplit)
        : buildEmptyWeeklySplit();

    return {
      schemaVersion: FITTRACK_DATA_SCHEMA_VERSION,
      exportType: 'WORKOUT' as const,
      exportedAt,
      user: { id: userMeta.id, name: userMeta.name, email: userMeta.email },
      exercises: apiExercises,
      workoutSplit: enrichExportSplit(orderedSplits, apiExercises),
      workoutSessions: workoutSessions.map(toApiWorkoutSession),
      savedPlans: savedPlans.map(toApiSavedPlan),
    };
  }

  if (scope === 'MEASUREMENTS') {
    const measurements = await prisma.bodyMeasurement.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      schemaVersion: FITTRACK_DATA_SCHEMA_VERSION,
      exportType: 'MEASUREMENTS' as const,
      exportedAt,
      user: { id: userMeta.id, name: userMeta.name, email: userMeta.email },
      measurements: measurements.map(toApiBodyMeasurement),
    };
  }

  // FULL_BACKUP
  const [
    profile,
    foods,
    plannedMeals,
    mealLogs,
    exercisesRaw,
    workoutSplitsRaw,
    workoutSessions,
    measurements,
    savedPlans,
  ] = await Promise.all([
    prisma.fitnessProfile.findUnique({ where: { userId } }),
    prisma.foodItem.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
    prisma.plannedMeal.findMany({
      where: { userId },
      orderBy: { time: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.mealLog.findMany({ where: { userId }, orderBy: [{ date: 'desc' }, { time: 'asc' }] }),
    prisma.exercise.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
    prisma.workoutDaySplit.findMany({
      where: { userId },
      include: { exercises: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.workoutSession.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.bodyMeasurement.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.savedPlan.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);

  const apiExercises = exercisesRaw.map(toApiExercise);
  const orderedSplits =
    workoutSplitsRaw.length > 0
      ? [...workoutSplitsRaw]
          .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
          .map(toApiWorkoutDaySplit)
      : buildEmptyWeeklySplit();

  return {
    schemaVersion: FITTRACK_DATA_SCHEMA_VERSION,
    exportType: 'FULL_BACKUP' as const,
    exportedAt,
    user: { id: userMeta.id, name: userMeta.name, email: userMeta.email },
    profile: toApiProfile(profile),
    foods: foods.map(toApiFood),
    plannedMeals: plannedMeals.map(toApiPlannedMeal),
    mealLogs: mealLogs.map(toApiMealLog),
    exercises: apiExercises,
    workoutSplit: enrichExportSplit(orderedSplits, apiExercises),
    workoutSessions: workoutSessions.map(toApiWorkoutSession),
    measurements: measurements.map(toApiBodyMeasurement),
    savedPlans: savedPlans.map(toApiSavedPlan),
  };
}

function countMappedMuscleGroups(rawPayload: Record<string, unknown>): number {
  let count = 0;
  const checkArr = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (item && typeof item === 'object') {
        const mg = (item as Record<string, unknown>).muscleGroup;
        if (normalizeMuscleGroupValue(mg).mappedFrom) count += 1;
      }
    }
  };
  checkArr(rawPayload.exercises);
  if (Array.isArray(rawPayload.workoutSplit)) {
    for (const day of rawPayload.workoutSplit) {
      if (day && typeof day === 'object') {
        checkArr((day as Record<string, unknown>).exercises);
      }
    }
  }
  if (Array.isArray(rawPayload.workoutSessions)) {
    for (const sess of rawPayload.workoutSessions) {
      if (sess && typeof sess === 'object') {
        checkArr((sess as Record<string, unknown>).exercises);
      }
    }
  }
  if (Array.isArray(rawPayload.savedPlans)) {
    for (const plan of rawPayload.savedPlans) {
      if (
        plan &&
        typeof plan === 'object' &&
        (plan as Record<string, unknown>).type === 'WORKOUT' &&
        Array.isArray((plan as Record<string, unknown>).payload)
      ) {
        for (const day of (plan as Record<string, unknown>).payload as unknown[]) {
          if (day && typeof day === 'object') {
            checkArr((day as Record<string, unknown>).exercises);
          }
        }
      }
    }
  }
  return count;
}

function parseAndValidateScopedPayload(
  importType: ImportExportScope,
  rawPayload: unknown
): {
  parsed: ParsedImportPayload | null;
  errors: ImportValidationIssue[];
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {
      parsed: null,
      errors: [{ field: 'root', message: 'Import payload must be a JSON object.' }],
      warnings,
    };
  }

  const mappedMuscleCount = countMappedMuscleGroups(rawPayload as Record<string, unknown>);
  if (mappedMuscleCount > 0) {
    warnings.push(
      `Normalized ${mappedMuscleCount} muscleGroup value(s) (TRICEPS/BICEPS → ARMS, ABS → CORE) to match FitTrack's MuscleGroup enum.`
    );
  }

  const res = fullPayloadObjectSchema.safeParse(rawPayload);
  if (!res.success) {
    return {
      parsed: null,
      errors: zodIssuesToValidationIssues(res.error),
      warnings,
    };
  }

  const data = res.data;
  const errors: ImportValidationIssue[] = [];

  if (data.exportType && importType !== 'FULL_BACKUP' && data.exportType !== importType && data.exportType !== 'FULL_BACKUP') {
    warnings.push(
      `File header specifies exportType "${data.exportType}", while "${importType}" import mode is selected. Only ${importType}-scoped fields will be imported.`
    );
  }

  if (data.workoutSplit) {
    const seenDays = new Set<DayOfWeek>();
    data.workoutSplit.forEach((dayEntry, idx) => {
      if (seenDays.has(dayEntry.day)) {
        errors.push({
          field: `workoutSplit.${idx}.day`,
          message: `Duplicate workout day entry "${dayEntry.day}". Each day MON–SUN can appear at most once.`,
        });
      }
      seenDays.add(dayEntry.day);
    });
  }

  // Scope enforcement: verify at least one relevant dataset is present for the selected import option
  if (importType === 'DIET') {
    const dietSavedPlans = (data.savedPlans || []).filter((p) => p.type === 'DIET');
    const hasDietContent =
      (data.foods?.length ?? 0) > 0 ||
      (data.plannedMeals?.length ?? 0) > 0 ||
      (data.mealLogs?.length ?? 0) > 0 ||
      dietSavedPlans.length > 0;
    if (!hasDietContent) {
      errors.push({
        field: 'root',
        message:
          'Diet import requires at least one entry in "foods", "plannedMeals", "mealLogs", or DIET "savedPlans".',
      });
    }
  } else if (importType === 'WORKOUT') {
    const workoutSavedPlans = (data.savedPlans || []).filter((p) => p.type === 'WORKOUT');
    const hasWorkoutContent =
      (data.exercises?.length ?? 0) > 0 ||
      (data.workoutSplit?.length ?? 0) > 0 ||
      (data.workoutSessions?.length ?? 0) > 0 ||
      workoutSavedPlans.length > 0;
    if (!hasWorkoutContent) {
      errors.push({
        field: 'root',
        message:
          'Workout import requires at least one entry in "exercises", "workoutSplit", "workoutSessions", or WORKOUT "savedPlans".',
      });
    }
  } else if (importType === 'MEASUREMENTS') {
    if ((data.measurements?.length ?? 0) === 0) {
      errors.push({
        field: 'measurements',
        message: 'Measurements import requires a non-empty "measurements" array.',
      });
    }
  } else {
    const hasAnyContent =
      Boolean(data.profile) ||
      (data.foods?.length ?? 0) > 0 ||
      (data.plannedMeals?.length ?? 0) > 0 ||
      (data.mealLogs?.length ?? 0) > 0 ||
      (data.exercises?.length ?? 0) > 0 ||
      (data.workoutSplit?.length ?? 0) > 0 ||
      (data.workoutSessions?.length ?? 0) > 0 ||
      (data.measurements?.length ?? 0) > 0 ||
      (data.savedPlans?.length ?? 0) > 0;
    if (!hasAnyContent) {
      errors.push({
        field: 'root',
        message: 'Backup JSON contains no recognizable FitTrack data sections to import.',
      });
    }
  }

  return { parsed: errors.length > 0 ? null : data, errors, warnings };
}

function scopeFilterData(importType: ImportExportScope, data: ParsedImportPayload) {
  const includeDiet = importType === 'DIET' || importType === 'FULL_BACKUP';
  const includeWorkout = importType === 'WORKOUT' || importType === 'FULL_BACKUP';
  const includeMeasurements = importType === 'MEASUREMENTS' || importType === 'FULL_BACKUP';
  const includeProfile = importType === 'FULL_BACKUP';

  const foods = includeDiet ? data.foods || [] : [];
  const plannedMeals = includeDiet ? data.plannedMeals || [] : [];
  const mealLogs = includeDiet ? data.mealLogs || [] : [];
  const exercises = includeWorkout ? data.exercises || [] : [];
  const workoutSplit = includeWorkout ? data.workoutSplit || [] : [];
  const workoutSessions = includeWorkout ? data.workoutSessions || [] : [];
  const measurements = includeMeasurements ? data.measurements || [] : [];
  const savedPlans = (data.savedPlans || []).filter((p) =>
    importType === 'FULL_BACKUP'
      ? true
      : importType === 'DIET'
        ? p.type === 'DIET'
        : importType === 'WORKOUT'
          ? p.type === 'WORKOUT'
          : false
  );
  const profile = includeProfile ? data.profile ?? null : null;

  return {
    foods,
    plannedMeals,
    mealLogs,
    exercises,
    workoutSplit,
    workoutSessions,
    measurements,
    savedPlans,
    profile,
  };
}

function buildFoodDerivedMetrics(food: FoodItem, servings: number) {
  return {
    foodId: food.id,
    foodName: food.name,
    servings,
    servingLabel: food.servingLabel,
    calories: Math.round(food.calories * servings),
    proteinG: Math.round(food.proteinG * servings * 10) / 10,
    carbsG: Math.round(food.carbsG * servings * 10) / 10,
    fatG: Math.round(food.fatG * servings * 10) / 10,
    priceInr: Math.round(food.priceInr * servings * 10) / 10,
  };
}

function measurementSignature(m: {
  date: string;
  weightKg?: number | null;
  waistCm?: number | null;
  chestCm?: number | null;
  bodyFatPct?: number | null;
}) {
  return `${m.date}|${m.weightKg ?? ''}|${m.waistCm ?? ''}|${m.chestCm ?? ''}|${m.bodyFatPct ?? ''}`;
}

export async function previewUserImport(
  userId: string,
  input: { importType: ImportExportScope; mode: ImportMode; payload: unknown }
): Promise<ImportPreviewResult> {
  assertDatabaseConfigured();
  const { parsed, errors, warnings } = parseAndValidateScopedPayload(
    input.importType,
    input.payload
  );

  const emptyResult: ImportPreviewResult = {
    valid: false,
    importType: input.importType,
    mode: input.mode,
    errors,
    warnings,
    totals: emptyCategorySummary(),
    categories: {
      foods: emptyCategorySummary(),
      plannedMeals: emptyCategorySummary(),
      mealLogs: emptyCategorySummary(),
      exercises: emptyCategorySummary(),
      workoutSplit: emptyCategorySummary(),
      workoutSessions: emptyCategorySummary(),
      measurements: emptyCategorySummary(),
      savedPlans: emptyCategorySummary(),
    },
    records: {
      profile: [],
      foods: [],
      plannedMeals: [],
      mealLogs: [],
      exercises: [],
      workoutSplit: [],
      workoutSessions: [],
      measurements: [],
      savedPlans: [],
    },
  };

  if (!parsed || errors.length > 0) {
    return emptyResult;
  }

  const scoped = scopeFilterData(input.importType, parsed);
  const isReplace = input.mode === 'REPLACE';

  const [
    existingFoods,
    existingMeals,
    existingMealLogs,
    existingExercises,
    existingSplits,
    existingSessions,
    existingMeasurements,
    existingSavedPlans,
  ] = await Promise.all([
    prisma.foodItem.findMany({ where: { userId } }),
    prisma.plannedMeal.findMany({ where: { userId }, include: { items: true } }),
    prisma.mealLog.findMany({ where: { userId } }),
    prisma.exercise.findMany({ where: { userId } }),
    prisma.workoutDaySplit.findMany({ where: { userId }, include: { exercises: true } }),
    prisma.workoutSession.findMany({ where: { userId } }),
    prisma.bodyMeasurement.findMany({ where: { userId } }),
    prisma.savedPlan.findMany({ where: { userId } }),
  ]);

  const categories = emptyResult.categories;
  const records = emptyResult.records;
  const refErrors: ImportValidationIssue[] = [];

  // 1. Foods preview
  const knownFoodNames = new Set(
    isReplace ? [] : existingFoods.map((f) => f.name.trim().toLowerCase())
  );
  const knownFoodIds = new Set(isReplace ? [] : existingFoods.map((f) => f.id));
  const importedFoodsWillExistByName = new Set<string>();
  const importedFoodsWillExistById = new Set<string>();

  if (!isReplace) {
    existingFoods.forEach((f) => {
      importedFoodsWillExistByName.add(f.name.trim().toLowerCase());
      importedFoodsWillExistById.add(f.id);
    });
  }

  if (isReplace && scoped.foods.length > 0) {
    categories.foods.replaced = existingFoods.length;
  }

  scoped.foods.forEach((f) => {
    const key = f.name.trim().toLowerCase();
    importedFoodsWillExistByName.add(key);
    if (f.id) importedFoodsWillExistById.add(f.id);

    if (!isReplace && (knownFoodNames.has(key) || (f.id && knownFoodIds.has(f.id)))) {
      categories.foods.duplicatesSkipped += 1;
      records.foods.push({
        status: 'DUPLICATE_SKIP',
        title: f.name,
        subtitle: `${f.category} · ${f.calories} kcal, ${f.proteinG}g P (${f.servingLabel}) — already in library`,
      });
    } else {
      knownFoodNames.add(key);
      categories.foods.created += 1;
      records.foods.push({
        status: 'CREATE',
        title: f.name,
        subtitle: `${f.category} · ${f.calories} kcal, ${f.proteinG}g P, ₹${f.priceInr} (${f.servingLabel})`,
      });
    }
  });

  // 2. Planned Meals preview (validate food links too)
  const existingMealKeys = new Set(
    isReplace ? [] : existingMeals.map((m) => `${m.name.trim().toLowerCase()}|${m.time}`)
  );
  if (isReplace && scoped.plannedMeals.length > 0) {
    categories.plannedMeals.replaced = existingMeals.length;
  }

  scoped.plannedMeals.forEach((meal, mIdx) => {
    meal.items.forEach((it, iIdx) => {
      const nameKey = it.foodName.trim().toLowerCase();
      const hasKnownFood =
        (it.foodId && importedFoodsWillExistById.has(it.foodId)) ||
        importedFoodsWillExistByName.has(nameKey);
      const hasInlineMacros = it.calories !== undefined && it.proteinG !== undefined;
      if (!hasKnownFood && !hasInlineMacros) {
        refErrors.push({
          field: `plannedMeals.${mIdx}.items.${iIdx}.foodName`,
          message: `Food "${it.foodName}" does not match any existing/imported food and is missing calories/proteinG values.`,
        });
      }
    });

    const mealKey = `${meal.name.trim().toLowerCase()}|${meal.time}`;
    const totalCal = meal.items.reduce(
      (s, it) => s + Math.round((it.calories ?? 0) * (it.calories !== undefined ? 1 : 0)),
      0
    );
    if (!isReplace && existingMealKeys.has(mealKey)) {
      categories.plannedMeals.duplicatesSkipped += 1;
      records.plannedMeals.push({
        status: 'DUPLICATE_SKIP',
        title: `${meal.time} · ${meal.name}`,
        subtitle: `${meal.items.length} item(s) — matching meal slot already exists`,
      });
    } else {
      existingMealKeys.add(mealKey);
      categories.plannedMeals.created += 1;
      records.plannedMeals.push({
        status: 'CREATE',
        title: `${meal.time} · ${meal.name}`,
        subtitle: `${meal.items.length} food item(s)${totalCal > 0 ? ` · ~${totalCal} kcal` : ''}`,
      });
    }
  });

  // 3. Meal Logs preview
  const existingLogKeys = new Set(
    isReplace
      ? []
      : existingMealLogs.map(
          (l) =>
            `${l.date}|${l.mealName.trim().toLowerCase()}|${l.time}|${l.foodName.trim().toLowerCase()}`
        )
  );
  if (isReplace && scoped.mealLogs.length > 0) {
    categories.mealLogs.replaced = existingMealLogs.length;
  }

  scoped.mealLogs.forEach((l) => {
    const key = `${l.date}|${l.mealName.trim().toLowerCase()}|${l.time}|${l.foodName.trim().toLowerCase()}`;
    if (!isReplace && existingLogKeys.has(key)) {
      categories.mealLogs.duplicatesSkipped += 1;
      records.mealLogs.push({
        status: 'DUPLICATE_SKIP',
        title: `${l.date} ${l.time} · ${l.foodName}`,
        subtitle: `${l.mealName} (${l.servings}×) — duplicate log skipped`,
      });
    } else {
      existingLogKeys.add(key);
      categories.mealLogs.created += 1;
      records.mealLogs.push({
        status: 'CREATE',
        title: `${l.date} ${l.time} · ${l.foodName}`,
        subtitle: `${l.mealName} · ${l.servings}× · ${l.calories} kcal, ${l.proteinG}g P`,
      });
    }
  });

  // 4. Exercises preview
  const knownExerciseNames = new Set(
    isReplace ? [] : existingExercises.map((e) => e.name.trim().toLowerCase())
  );
  const knownExerciseIds = new Set(isReplace ? [] : existingExercises.map((e) => e.id));
  if (isReplace && scoped.exercises.length > 0) {
    categories.exercises.replaced = existingExercises.length;
  }

  scoped.exercises.forEach((ex) => {
    const key = ex.name.trim().toLowerCase();
    if (!isReplace && (knownExerciseNames.has(key) || (ex.id && knownExerciseIds.has(ex.id)))) {
      categories.exercises.duplicatesSkipped += 1;
      records.exercises.push({
        status: 'DUPLICATE_SKIP',
        title: ex.name,
        subtitle: `${ex.muscleGroup} · ${ex.defaultSets}×${ex.defaultReps} (${ex.defaultRestSeconds}s) — already in library`,
      });
    } else {
      knownExerciseNames.add(key);
      categories.exercises.created += 1;
      records.exercises.push({
        status: 'CREATE',
        title: ex.name,
        subtitle: `${ex.muscleGroup} · ${ex.equipment} · ${ex.defaultSets}×${ex.defaultReps} · ${ex.defaultRestSeconds}s rest`,
      });
    }
  });

  // 5. Workout Split preview
  const existingSplitByDay = new Map(existingSplits.map((d) => [d.day, d]));
  if (isReplace && scoped.workoutSplit.length > 0) {
    categories.workoutSplit.replaced = scoped.workoutSplit.filter((d) =>
      existingSplitByDay.has(d.day)
    ).length;
  }

  scoped.workoutSplit.forEach((day) => {
    const existingDay = existingSplitByDay.get(day.day);
    if (isReplace) {
      categories.workoutSplit.created += 1;
      records.workoutSplit.push({
        status: 'REPLACE',
        title: `${day.day} · ${day.focus}`,
        subtitle: day.isRestDay
          ? 'Rest Day (replaces existing day)'
          : `${day.exercises.length} exercise(s) (replaces existing day)`,
      });
    } else if (!existingDay || existingDay.exercises.length === 0) {
      categories.workoutSplit.created += 1;
      records.workoutSplit.push({
        status: 'CREATE',
        title: `${day.day} · ${day.focus}`,
        subtitle: day.isRestDay
          ? 'Rest Day'
          : `${day.exercises.length} exercise(s) configured`,
      });
    } else {
      const existingNames = new Set(
        existingDay.exercises.map((e) => e.exerciseName.trim().toLowerCase())
      );
      const newExercisesCount = day.exercises.filter(
        (e) => !existingNames.has(e.exerciseName.trim().toLowerCase())
      ).length;
      if (newExercisesCount === 0) {
        categories.workoutSplit.duplicatesSkipped += 1;
        records.workoutSplit.push({
          status: 'DUPLICATE_SKIP',
          title: `${day.day} · ${day.focus}`,
          subtitle: `All ${day.exercises.length} exercise(s) already assigned on ${day.day}`,
        });
      } else {
        categories.workoutSplit.updated += 1;
        records.workoutSplit.push({
          status: 'UPDATE',
          title: `${day.day} · ${day.focus}`,
          subtitle: `Merges ${newExercisesCount} new exercise(s) into existing ${day.day} split`,
        });
      }
    }
  });

  // 6. Workout Sessions preview
  const existingSessionKeys = new Set(
    isReplace
      ? []
      : existingSessions.map((s) => `${s.date}|${s.day}|${s.title.trim().toLowerCase()}`)
  );
  if (isReplace && scoped.workoutSessions.length > 0) {
    categories.workoutSessions.replaced = existingSessions.length;
  }

  scoped.workoutSessions.forEach((s) => {
    const key = `${s.date}|${s.day}|${s.title.trim().toLowerCase()}`;
    if (!isReplace && existingSessionKeys.has(key)) {
      categories.workoutSessions.duplicatesSkipped += 1;
      records.workoutSessions.push({
        status: 'DUPLICATE_SKIP',
        title: `${s.date} (${s.day}) · ${s.title}`,
        subtitle: `${s.durationMinutes} min — duplicate workout session skipped`,
      });
    } else {
      existingSessionKeys.add(key);
      categories.workoutSessions.created += 1;
      records.workoutSessions.push({
        status: 'CREATE',
        title: `${s.date} (${s.day}) · ${s.title}`,
        subtitle: `${s.durationMinutes} min · ${s.exercises.length} exercise(s)`,
      });
    }
  });

  // 7. Measurements preview
  const existingMeasSigs = new Set(
    isReplace ? [] : existingMeasurements.map((m) => measurementSignature(m))
  );
  if (isReplace && scoped.measurements.length > 0) {
    categories.measurements.replaced = existingMeasurements.length;
  }

  scoped.measurements.forEach((m) => {
    const sig = measurementSignature(m);
    const parts: string[] = [];
    if (m.weightKg != null) parts.push(`${m.weightKg} kg`);
    if (m.waistCm != null) parts.push(`Waist ${m.waistCm} cm`);
    if (m.chestCm != null) parts.push(`Chest ${m.chestCm} cm`);
    if (m.bodyFatPct != null) parts.push(`${m.bodyFatPct}% BF`);
    if (m.customMeasurements?.length) parts.push(`${m.customMeasurements.length} custom`);
    const summaryText = parts.join(' · ') || m.notes || 'Measurement entry';

    if (!isReplace && existingMeasSigs.has(sig)) {
      categories.measurements.duplicatesSkipped += 1;
      records.measurements.push({
        status: 'DUPLICATE_SKIP',
        title: m.date,
        subtitle: `${summaryText} — duplicate entry skipped`,
      });
    } else {
      existingMeasSigs.add(sig);
      categories.measurements.created += 1;
      records.measurements.push({
        status: 'CREATE',
        title: m.date,
        subtitle: summaryText,
      });
    }
  });

  // 8. Saved Plans preview
  const existingPlanKeys = new Set(
    isReplace
      ? []
      : existingSavedPlans
          .filter((p) =>
            input.importType === 'FULL_BACKUP' ? true : p.type === input.importType
          )
          .map((p) => `${p.type}|${p.name.trim().toLowerCase()}`)
  );
  if (isReplace && scoped.savedPlans.length > 0) {
    categories.savedPlans.replaced = existingSavedPlans.filter((p) =>
      input.importType === 'FULL_BACKUP' ? true : p.type === input.importType
    ).length;
  }

  scoped.savedPlans.forEach((p, pIdx) => {
    if (p.type === 'DIET') {
      p.payload.forEach((meal, mIdx) => {
        meal.items.forEach((it, iIdx) => {
          const nameKey = it.foodName.trim().toLowerCase();
          const hasKnownFood =
            (it.foodId && importedFoodsWillExistById.has(it.foodId)) ||
            importedFoodsWillExistByName.has(nameKey);
          const hasInlineMacros = it.calories !== undefined && it.proteinG !== undefined;
          if (!hasKnownFood && !hasInlineMacros) {
            refErrors.push({
              field: `savedPlans.${pIdx}.payload.${mIdx}.items.${iIdx}.foodName`,
              message: `Food "${it.foodName}" does not match any existing/imported food and is missing calories/proteinG values.`,
            });
          }
        });
      });
    }

    const key = `${p.type}|${p.name.trim().toLowerCase()}`;
    if (!isReplace && existingPlanKeys.has(key)) {
      categories.savedPlans.duplicatesSkipped += 1;
      records.savedPlans.push({
        status: 'DUPLICATE_SKIP',
        title: `${p.type} · ${p.name}`,
        subtitle: 'Matching saved plan template already exists',
      });
    } else {
      existingPlanKeys.add(key);
      categories.savedPlans.created += 1;
      records.savedPlans.push({
        status: 'CREATE',
        title: `${p.type} · ${p.name}`,
        subtitle: p.description || `${p.payload.length} entries`,
      });
    }
  });

  // 9. Profile preview (Full Backup only)
  if (scoped.profile) {
    categories.profile = { created: 0, duplicatesSkipped: 0, replaced: 0, updated: 1 };
    const parts: string[] = [];
    if (scoped.profile.fitnessGoal) parts.push(scoped.profile.fitnessGoal);
    if (scoped.profile.dailyCalorieTarget) parts.push(`${scoped.profile.dailyCalorieTarget} kcal`);
    if (scoped.profile.dailyProteinTargetG) parts.push(`${scoped.profile.dailyProteinTargetG}g P`);
    if (scoped.profile.preferredWeightUnit) parts.push(scoped.profile.preferredWeightUnit);
    if (scoped.profile.preferredMeasureUnit) parts.push(scoped.profile.preferredMeasureUnit);
    records.profile.push({
      status: 'UPDATE',
      title: 'Fitness Profile & Targets',
      subtitle: parts.join(' · ') || 'Updates profile preferences',
    });
  }

  const totals = emptyCategorySummary();
  for (const cat of Object.values(categories)) {
    if (!cat) continue;
    totals.created += cat.created;
    totals.duplicatesSkipped += cat.duplicatesSkipped;
    totals.replaced += cat.replaced;
    totals.updated += cat.updated;
  }

  if (isReplace) {
    warnings.push(
      `Replacement mode is enabled: existing ${input.importType.toLowerCase().replace('_', ' ')} records covered by this import will be replaced inside an atomic transaction.`
    );
  }

  return {
    valid: refErrors.length === 0,
    importType: input.importType,
    mode: input.mode,
    errors: refErrors,
    warnings,
    totals,
    categories,
    records,
  };
}

export async function commitUserImport(
  userId: string,
  input: { importType: ImportExportScope; mode: ImportMode; payload: unknown }
): Promise<ImportCommitResult> {
  const { parsed, errors, warnings } = parseAndValidateScopedPayload(
    input.importType,
    input.payload
  );

  if (!parsed || errors.length > 0) {
    throw new AppError('Validation failed', 400, errors);
  }

  const scoped = scopeFilterData(input.importType, parsed);
  const isReplace = input.mode === 'REPLACE';

  const result = await withTransaction(
    async (tx) => {
      const categories: ImportPreviewResult['categories'] = {
        foods: emptyCategorySummary(),
        plannedMeals: emptyCategorySummary(),
        mealLogs: emptyCategorySummary(),
        exercises: emptyCategorySummary(),
        workoutSplit: emptyCategorySummary(),
        workoutSessions: emptyCategorySummary(),
        measurements: emptyCategorySummary(),
        savedPlans: emptyCategorySummary(),
      };

      // --- 1. PROFILE (FULL_BACKUP) ---
      if (scoped.profile) {
        const p = scoped.profile;
        const updateData: Prisma.FitnessProfileUpdateInput = { updatedAt: new Date() };
        if (p.age !== undefined) updateData.age = p.age;
        if (p.gender !== undefined) updateData.gender = p.gender;
        if (p.heightCm !== undefined) updateData.heightCm = p.heightCm;
        if (p.startingWeightKg !== undefined) updateData.startingWeightKg = p.startingWeightKg;
        if (p.currentWeightKg !== undefined) updateData.currentWeightKg = p.currentWeightKg;
        if (p.targetWeightKg !== undefined) updateData.targetWeightKg = p.targetWeightKg;
        if (p.targetWaistCm !== undefined) updateData.targetWaistCm = p.targetWaistCm;
        if (p.targetBodyFatPct !== undefined) updateData.targetBodyFatPct = p.targetBodyFatPct;
        if (p.fitnessGoal !== undefined) updateData.fitnessGoal = p.fitnessGoal;
        if (p.activityLevel !== undefined) updateData.activityLevel = p.activityLevel;
        if (p.dailyCalorieTarget !== undefined) updateData.dailyCalorieTarget = p.dailyCalorieTarget;
        if (p.dailyProteinTargetG !== undefined)
          updateData.dailyProteinTargetG = p.dailyProteinTargetG;
        if (p.dailyCarbTargetG !== undefined) updateData.dailyCarbTargetG = p.dailyCarbTargetG;
        if (p.dailyFatTargetG !== undefined) updateData.dailyFatTargetG = p.dailyFatTargetG;
        if (p.preferredWeightUnit !== undefined)
          updateData.preferredWeightUnit = p.preferredWeightUnit;
        if (p.preferredMeasureUnit !== undefined)
          updateData.preferredMeasureUnit = p.preferredMeasureUnit;
        if (p.currency !== undefined) updateData.currency = p.currency;
        if (p.timezone !== undefined) updateData.timezone = p.timezone;
        if (p.geminiEnabled !== undefined) updateData.geminiEnabled = p.geminiEnabled;

        await tx.fitnessProfile.updateMany({
          where: { userId },
          data: updateData as Prisma.FitnessProfileUpdateManyMutationInput,
        });
        categories.profile = { created: 0, duplicatesSkipped: 0, replaced: 0, updated: 1 };
      }

      // --- 2. FOODS ---
      if (isReplace && scoped.foods.length > 0) {
        const deletedFoods = await tx.foodItem.deleteMany({ where: { userId } });
        categories.foods.replaced = deletedFoods.count;
      }

      const dbFoodsRaw = await tx.foodItem.findMany({ where: { userId } });
      const foodByName = new Map<string, FoodItem>();
      const foodById = new Map<string, FoodItem>();
      for (const row of dbFoodsRaw) {
        const apiFood = toApiFood(row);
        foodByName.set(apiFood.name.trim().toLowerCase(), apiFood);
        foodById.set(apiFood.id, apiFood);
      }

      const now = new Date();
      for (const f of scoped.foods) {
        const nameKey = f.name.trim().toLowerCase();
        const existingByName = foodByName.get(nameKey);
        const existingById = f.id ? foodById.get(f.id) : undefined;
        if (existingByName || existingById) {
          const matched = existingByName || existingById!;
          if (f.id) foodById.set(f.id, matched);
          categories.foods.duplicatesSkipped += 1;
          continue;
        }

        const createdRow = await tx.foodItem.create({
          data: {
            id: generateId('food'),
            userId,
            name: f.name,
            category: f.category,
            servingLabel: f.servingLabel,
            servingGrams: f.servingGrams,
            calories: Math.round(f.calories),
            proteinG: Number(f.proteinG.toFixed(1)),
            carbsG: Number(f.carbsG.toFixed(1)),
            fatG: Number(f.fatG.toFixed(1)),
            priceInr: Number(f.priceInr.toFixed(1)),
            isDefault: Boolean(f.isDefault),
            createdAt: now,
          },
        });
        const createdFood = toApiFood(createdRow);
        foodByName.set(nameKey, createdFood);
        foodById.set(createdFood.id, createdFood);
        if (f.id) foodById.set(f.id, createdFood);
        categories.foods.created += 1;
      }

      const resolveFoodForItem = async (
        item: z.infer<typeof plannedMealItemImportSchema>,
        fieldPath: string
      ): Promise<FoodItem> => {
        if (item.foodId && foodById.has(item.foodId)) {
          return foodById.get(item.foodId)!;
        }
        const nameKey = item.foodName.trim().toLowerCase();
        if (foodByName.has(nameKey)) {
          return foodByName.get(nameKey)!;
        }
        if (item.calories === undefined || item.proteinG === undefined) {
          throw new AppError('Validation failed', 400, [
            {
              field: `${fieldPath}.foodName`,
              message: `Food "${item.foodName}" does not match any existing/imported food and is missing calories/proteinG values.`,
            },
          ]);
        }

        // Derive per-serving base macros when inline macros were provided
        const s = item.servings > 0 ? item.servings : 1;
        const createdRow = await tx.foodItem.create({
          data: {
            id: generateId('food'),
            userId,
            name: item.foodName,
            category: (item.category || 'VEG') as DietTag,
            servingLabel: item.servingLabel || '1 serving (100g)',
            servingGrams: item.servingGrams || 100,
            calories: Math.round(item.calories / s),
            proteinG: Number(((item.proteinG ?? 0) / s).toFixed(1)),
            carbsG: Number(((item.carbsG ?? 0) / s).toFixed(1)),
            fatG: Number(((item.fatG ?? 0) / s).toFixed(1)),
            priceInr: Number(((item.priceInr ?? 0) / s).toFixed(1)),
            isDefault: false,
            createdAt: now,
          },
        });
        const createdFood = toApiFood(createdRow);
        foodByName.set(nameKey, createdFood);
        foodById.set(createdFood.id, createdFood);
        categories.foods.created += 1;
        return createdFood;
      };

      // --- 3. PLANNED MEALS ---
      if (isReplace && scoped.plannedMeals.length > 0) {
        const deletedMeals = await tx.plannedMeal.deleteMany({ where: { userId } });
        categories.plannedMeals.replaced = deletedMeals.count;
      }

      const existingMealsRaw = await tx.plannedMeal.findMany({ where: { userId } });
      const existingMealKeys = new Set(
        existingMealsRaw.map((m) => `${m.name.trim().toLowerCase()}|${m.time}`)
      );

      for (let mIdx = 0; mIdx < scoped.plannedMeals.length; mIdx++) {
        const meal = scoped.plannedMeals[mIdx];
        const mealKey = `${meal.name.trim().toLowerCase()}|${meal.time}`;
        if (!isReplace && existingMealKeys.has(mealKey)) {
          categories.plannedMeals.duplicatesSkipped += 1;
          continue;
        }
        existingMealKeys.add(mealKey);

        const itemsToCreate: Array<{
          id: string;
          sortOrder: number;
          foodId: string;
          foodName: string;
          servings: number;
          servingLabel: string;
          calories: number;
          proteinG: number;
          carbsG: number;
          fatG: number;
          priceInr: number;
        }> = [];

        for (let iIdx = 0; iIdx < meal.items.length; iIdx++) {
          const item = meal.items[iIdx];
          const resolvedFood = await resolveFoodForItem(
            item,
            `plannedMeals.${mIdx}.items.${iIdx}`
          );
          itemsToCreate.push({
            id: generateId('pmi'),
            sortOrder: iIdx,
            ...buildFoodDerivedMetrics(resolvedFood, item.servings),
          });
        }

        await tx.plannedMeal.create({
          data: {
            id: generateId('meal'),
            userId,
            name: meal.name,
            time: meal.time,
            items: { create: itemsToCreate },
          },
        });
        categories.plannedMeals.created += 1;
      }

      // --- 4. MEAL LOGS ---
      if (isReplace && scoped.mealLogs.length > 0) {
        const deletedLogs = await tx.mealLog.deleteMany({ where: { userId } });
        categories.mealLogs.replaced = deletedLogs.count;
      }

      const existingMealLogsRaw = await tx.mealLog.findMany({ where: { userId } });
      const existingLogKeys = new Set(
        existingMealLogsRaw.map(
          (l) =>
            `${l.date}|${l.mealName.trim().toLowerCase()}|${l.time}|${l.foodName.trim().toLowerCase()}`
        )
      );

      for (const l of scoped.mealLogs) {
        const key = `${l.date}|${l.mealName.trim().toLowerCase()}|${l.time}|${l.foodName.trim().toLowerCase()}`;
        if (!isReplace && existingLogKeys.has(key)) {
          categories.mealLogs.duplicatesSkipped += 1;
          continue;
        }
        existingLogKeys.add(key);

        const matchedFood =
          (l.foodId && foodById.get(l.foodId)) ||
          foodByName.get(l.foodName.trim().toLowerCase());

        await tx.mealLog.create({
          data: {
            id: generateId('mlog'),
            userId,
            date: l.date,
            mealName: l.mealName,
            time: l.time,
            foodId: matchedFood?.id ?? null,
            foodName: l.foodName,
            servings: l.servings,
            servingLabel: l.servingLabel || matchedFood?.servingLabel || '1 serving',
            calories: Math.round(l.calories),
            proteinG: Number(l.proteinG.toFixed(1)),
            carbsG: Number(l.carbsG.toFixed(1)),
            fatG: Number(l.fatG.toFixed(1)),
            priceInr: Number(l.priceInr.toFixed(1)),
            plannedMealId: null,
            createdAt: now,
          },
        });
        categories.mealLogs.created += 1;
      }

      // --- 5. EXERCISES ---
      if (isReplace && scoped.exercises.length > 0) {
        const deletedEx = await tx.exercise.deleteMany({ where: { userId } });
        categories.exercises.replaced = deletedEx.count;
      }

      const dbExercisesRaw = await tx.exercise.findMany({ where: { userId } });
      const exerciseByName = new Map<string, Exercise>();
      const exerciseById = new Map<string, Exercise>();
      for (const row of dbExercisesRaw) {
        const apiEx = toApiExercise(row);
        exerciseByName.set(apiEx.name.trim().toLowerCase(), apiEx);
        exerciseById.set(apiEx.id, apiEx);
      }

      for (const ex of scoped.exercises) {
        const nameKey = ex.name.trim().toLowerCase();
        const existingByName = exerciseByName.get(nameKey);
        const existingById = ex.id ? exerciseById.get(ex.id) : undefined;
        if (existingByName || existingById) {
          const matched = existingByName || existingById!;
          if (ex.id) exerciseById.set(ex.id, matched);
          categories.exercises.duplicatesSkipped += 1;
          continue;
        }

        const createdRow = await tx.exercise.create({
          data: {
            id: generateId('ex'),
            userId,
            name: ex.name,
            muscleGroup: ex.muscleGroup as MuscleGroup,
            equipment: ex.equipment,
            defaultSets: ex.defaultSets,
            defaultReps: ex.defaultReps,
            defaultRestSeconds: ex.defaultRestSeconds,
            defaultWeightKg: ex.defaultWeightKg ?? null,
            instructions: ex.instructions,
            imageUrl: ex.imageUrl ?? null,
            videoUrl: ex.videoUrl ?? null,
            isDefault: Boolean(ex.isDefault),
            createdAt: now,
          },
        });
        const createdEx = toApiExercise(createdRow);
        exerciseByName.set(nameKey, createdEx);
        exerciseById.set(createdEx.id, createdEx);
        if (ex.id) exerciseById.set(ex.id, createdEx);
        categories.exercises.created += 1;
      }

      const resolveOrCreateExercise = async (item: {
        exerciseId?: string;
        exerciseName: string;
        muscleGroup: MuscleGroup;
        targetSets?: number;
        targetReps?: string;
        restSeconds?: number;
        targetWeightKg?: number | null;
        instructions?: string;
        imageUrl?: string | null;
        videoUrl?: string | null;
      }): Promise<Exercise> => {
        if (item.exerciseId && exerciseById.has(item.exerciseId)) {
          return exerciseById.get(item.exerciseId)!;
        }
        const nameKey = item.exerciseName.trim().toLowerCase();
        if (exerciseByName.has(nameKey)) {
          return exerciseByName.get(nameKey)!;
        }
        const createdRow = await tx.exercise.create({
          data: {
            id: generateId('ex'),
            userId,
            name: item.exerciseName,
            muscleGroup: item.muscleGroup,
            equipment: 'Standard',
            defaultSets: item.targetSets ?? 3,
            defaultReps: item.targetReps ?? '8-12',
            defaultRestSeconds: item.restSeconds ?? 90,
            defaultWeightKg: item.targetWeightKg ?? null,
            instructions: item.instructions ?? '',
            imageUrl: item.imageUrl ?? null,
            videoUrl: item.videoUrl ?? null,
            isDefault: false,
            createdAt: now,
          },
        });
        const createdEx = toApiExercise(createdRow);
        exerciseByName.set(nameKey, createdEx);
        exerciseById.set(createdEx.id, createdEx);
        if (item.exerciseId) exerciseById.set(item.exerciseId, createdEx);
        categories.exercises.created += 1;
        return createdEx;
      };

      // --- 6. WORKOUT SPLIT ---
      if (scoped.workoutSplit.length > 0) {
        if (isReplace) {
          const deletedSplits = await tx.workoutDaySplit.deleteMany({ where: { userId } });
          categories.workoutSplit.replaced = deletedSplits.count;
        }

        const existingDays = await tx.workoutDaySplit.findMany({
          where: { userId },
          include: { exercises: { orderBy: { sortOrder: 'asc' } } },
        });
        const existingDaySet = new Set(existingDays.map((d) => d.day));
        const missingDays = buildEmptyWeeklySplit().filter((d) => !existingDaySet.has(d.day));
        if (missingDays.length > 0) {
          await tx.workoutDaySplit.createMany({
            data: missingDays.map((d) => ({
              userId,
              day: d.day,
              focus: d.focus,
              isRestDay: d.isRestDay,
            })),
          });
        }

        const allDaysMap = new Map(existingDays.map((d) => [d.day, d]));

        for (const dayEntry of scoped.workoutSplit) {
          const dayRow = await tx.workoutDaySplit.findUniqueOrThrow({
            where: { userId_day: { userId, day: dayEntry.day } },
            include: { exercises: { orderBy: { sortOrder: 'asc' } } },
          });

          if (isReplace || dayRow.exercises.length === 0) {
            await tx.workoutDaySplit.update({
              where: { id: dayRow.id },
              data: {
                focus: dayEntry.focus,
                isRestDay: dayEntry.isRestDay,
              },
            });
            await tx.splitExercise.deleteMany({ where: { daySplitId: dayRow.id } });

            const resolvedList = [];
            for (let idx = 0; idx < dayEntry.exercises.length; idx++) {
              const exItem = dayEntry.exercises[idx];
              const lib = await resolveOrCreateExercise(exItem);
              resolvedList.push({
                id: generateId('spex'),
                daySplitId: dayRow.id,
                sortOrder: idx,
                exerciseId: lib.id,
                exerciseName: lib.name,
                muscleGroup: lib.muscleGroup,
                targetSets: exItem.targetSets,
                targetReps: exItem.targetReps,
                restSeconds: exItem.restSeconds,
                targetWeightKg: exItem.targetWeightKg ?? lib.defaultWeightKg ?? null,
                instructions: exItem.instructions ?? lib.instructions ?? '',
                imageUrl: exItem.imageUrl ?? lib.imageUrl ?? null,
                videoUrl: exItem.videoUrl ?? lib.videoUrl ?? null,
              });
            }
            if (resolvedList.length > 0) {
              await tx.splitExercise.createMany({ data: resolvedList });
            }
            categories.workoutSplit.created += 1;
          } else {
            // Merge non-duplicate exercises into existing day without overwriting user's exercises
            const existingNames = new Set(
              dayRow.exercises.map((e) => e.exerciseName.trim().toLowerCase())
            );
            const existingExIds = new Set(dayRow.exercises.map((e) => e.exerciseId));
            let nextSort = dayRow.exercises.reduce((max, e) => Math.max(max, e.sortOrder), -1) + 1;
            let addedOnDay = 0;

            for (const exItem of dayEntry.exercises) {
              const lib = await resolveOrCreateExercise(exItem);
              if (
                existingExIds.has(lib.id) ||
                existingNames.has(lib.name.trim().toLowerCase())
              ) {
                continue;
              }
              existingExIds.add(lib.id);
              existingNames.add(lib.name.trim().toLowerCase());
              await tx.splitExercise.create({
                data: {
                  id: generateId('spex'),
                  daySplitId: dayRow.id,
                  sortOrder: nextSort++,
                  exerciseId: lib.id,
                  exerciseName: lib.name,
                  muscleGroup: lib.muscleGroup,
                  targetSets: exItem.targetSets,
                  targetReps: exItem.targetReps,
                  restSeconds: exItem.restSeconds,
                  targetWeightKg: exItem.targetWeightKg ?? lib.defaultWeightKg ?? null,
                  instructions: exItem.instructions ?? lib.instructions ?? '',
                  imageUrl: exItem.imageUrl ?? lib.imageUrl ?? null,
                  videoUrl: exItem.videoUrl ?? lib.videoUrl ?? null,
                },
              });
              addedOnDay += 1;
            }

            if (addedOnDay > 0) {
              if (dayRow.isRestDay && !dayEntry.isRestDay) {
                await tx.workoutDaySplit.update({
                  where: { id: dayRow.id },
                  data: { isRestDay: false, focus: dayEntry.focus },
                });
              }
              categories.workoutSplit.updated += 1;
            } else {
              const prevDay = allDaysMap.get(dayEntry.day);
              if (prevDay) {
                categories.workoutSplit.duplicatesSkipped += 1;
              }
            }
          }
        }
      }

      // --- 7. WORKOUT SESSIONS ---
      if (isReplace && scoped.workoutSessions.length > 0) {
        const deletedSessions = await tx.workoutSession.deleteMany({ where: { userId } });
        categories.workoutSessions.replaced = deletedSessions.count;
      }

      const existingSessionsRaw = await tx.workoutSession.findMany({ where: { userId } });
      const existingSessionKeys = new Set(
        existingSessionsRaw.map((s) => `${s.date}|${s.day}|${s.title.trim().toLowerCase()}`)
      );

      for (const s of scoped.workoutSessions) {
        const key = `${s.date}|${s.day}|${s.title.trim().toLowerCase()}`;
        if (!isReplace && existingSessionKeys.has(key)) {
          categories.workoutSessions.duplicatesSkipped += 1;
          continue;
        }
        existingSessionKeys.add(key);

        let computedVolume = 0;
        const resolvedExercises = [];
        for (const ex of s.exercises) {
          const lib = await resolveOrCreateExercise({
            exerciseId: ex.exerciseId,
            exerciseName: ex.exerciseName,
            muscleGroup: ex.muscleGroup,
            instructions: ex.instructions,
            imageUrl: ex.imageUrl ?? null,
            videoUrl: ex.videoUrl ?? null,
          });
          for (const set of ex.sets) {
            if (set.completed) {
              computedVolume += set.reps * set.weightKg;
            }
          }
          resolvedExercises.push({
            exerciseId: lib.id,
            exerciseName: lib.name,
            muscleGroup: lib.muscleGroup,
            imageUrl: ex.imageUrl ?? lib.imageUrl ?? null,
            videoUrl: ex.videoUrl ?? lib.videoUrl ?? null,
            instructions: ex.instructions ?? lib.instructions ?? '',
            sets: ex.sets,
          });
        }

        await tx.workoutSession.create({
          data: {
            id: generateId('ws'),
            userId,
            date: s.date,
            day: s.day,
            title: s.title,
            durationMinutes: s.durationMinutes,
            totalVolumeKg: s.totalVolumeKg ?? Math.round(computedVolume),
            notes: s.notes,
            exercises: resolvedExercises as unknown as Prisma.InputJsonValue,
            createdAt: now,
          },
        });
        categories.workoutSessions.created += 1;
      }

      // --- 8. BODY MEASUREMENTS ---
      if (isReplace && scoped.measurements.length > 0) {
        const deletedMeas = await tx.bodyMeasurement.deleteMany({ where: { userId } });
        categories.measurements.replaced = deletedMeas.count;
      }

      if (scoped.measurements.length > 0) {
        const existingMeasRaw = await tx.bodyMeasurement.findMany({ where: { userId } });
        const existingMeasSigs = new Set(existingMeasRaw.map((m) => measurementSignature(m)));

        for (const m of scoped.measurements) {
          const sig = measurementSignature(m);
          if (!isReplace && existingMeasSigs.has(sig)) {
            categories.measurements.duplicatesSkipped += 1;
            continue;
          }
          existingMeasSigs.add(sig);

          const custom = (m.customMeasurements || []).map((c) => ({
            id: c.id || generateId('cmeas'),
            label: c.label,
            valueCm: Number(c.valueCm.toFixed(2)),
          }));

          await tx.bodyMeasurement.create({
            data: {
              id: generateId('meas'),
              userId,
              date: m.date,
              weightKg: m.weightKg ?? null,
              bodyFatPct: m.bodyFatPct ?? null,
              waistCm: m.waistCm ?? null,
              chestCm: m.chestCm ?? null,
              hipsCm: m.hipsCm ?? null,
              armsCm: m.armsCm ?? null,
              thighsCm: m.thighsCm ?? null,
              neckCm: m.neckCm ?? null,
              calvesCm: m.calvesCm ?? null,
              customMeasurements: custom as unknown as Prisma.InputJsonValue,
              photoDataUrl: m.photoDataUrl ?? null,
              notes: m.notes,
              createdAt: now,
            },
          });
          categories.measurements.created += 1;
        }

        // Keep profile latest/starting weight synchronized
        const profile = await tx.fitnessProfile.findUnique({ where: { userId } });
        if (profile) {
          const weightRows = await tx.bodyMeasurement.findMany({
            where: { userId, weightKg: { not: null } },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            select: { weightKg: true },
          });
          if (weightRows.length > 0) {
            await tx.fitnessProfile.update({
              where: { userId },
              data: {
                currentWeightKg: weightRows[0].weightKg,
                ...(profile.startingWeightKg === null
                  ? { startingWeightKg: weightRows[weightRows.length - 1].weightKg }
                  : {}),
                updatedAt: now,
              },
            });
          }
        }
      }

      // --- 9. SAVED PLANS ---
      if (isReplace && scoped.savedPlans.length > 0) {
        const typesToReplace: Array<'DIET' | 'WORKOUT'> =
          input.importType === 'FULL_BACKUP'
            ? ['DIET', 'WORKOUT']
            : input.importType === 'DIET'
              ? ['DIET']
              : ['WORKOUT'];
        const deletedPlans = await tx.savedPlan.deleteMany({
          where: { userId, type: { in: typesToReplace } },
        });
        categories.savedPlans.replaced = deletedPlans.count;
      }

      const existingPlansRaw = await tx.savedPlan.findMany({ where: { userId } });
      const existingPlanKeys = new Set(
        existingPlansRaw.map((p) => `${p.type}|${p.name.trim().toLowerCase()}`)
      );

      for (let pIdx = 0; pIdx < scoped.savedPlans.length; pIdx++) {
        const plan = scoped.savedPlans[pIdx];
        const key = `${plan.type}|${plan.name.trim().toLowerCase()}`;
        if (!isReplace && existingPlanKeys.has(key)) {
          categories.savedPlans.duplicatesSkipped += 1;
          continue;
        }
        existingPlanKeys.add(key);

        let normalizedPayload: PlannedMeal[] | WorkoutDaySplit[];
        if (plan.type === 'DIET') {
          const mealsOut: PlannedMeal[] = [];
          for (let mIdx = 0; mIdx < plan.payload.length; mIdx++) {
            const m = plan.payload[mIdx];
            const itemsOut = [];
            for (let iIdx = 0; iIdx < m.items.length; iIdx++) {
              const it = m.items[iIdx];
              const resolvedFood = await resolveFoodForItem(
                it,
                `savedPlans.${pIdx}.payload.${mIdx}.items.${iIdx}`
              );
              itemsOut.push({
                id: generateId('pmi'),
                ...buildFoodDerivedMetrics(resolvedFood, it.servings),
              });
            }
            mealsOut.push({
              id: generateId('meal'),
              userId,
              name: m.name,
              time: m.time,
              items: itemsOut,
            });
          }
          normalizedPayload = mealsOut;
        } else {
          const splitOut: WorkoutDaySplit[] = [];
          for (const d of plan.payload) {
            const exOut = [];
            for (const exItem of d.exercises) {
              const lib = await resolveOrCreateExercise(exItem);
              exOut.push({
                id: generateId('spex'),
                exerciseId: lib.id,
                exerciseName: lib.name,
                muscleGroup: lib.muscleGroup,
                targetSets: exItem.targetSets,
                targetReps: exItem.targetReps,
                restSeconds: exItem.restSeconds,
                targetWeightKg: exItem.targetWeightKg ?? lib.defaultWeightKg ?? null,
                instructions: exItem.instructions ?? lib.instructions ?? '',
                imageUrl: exItem.imageUrl ?? lib.imageUrl ?? null,
                videoUrl: exItem.videoUrl ?? lib.videoUrl ?? null,
              });
            }
            splitOut.push({
              day: d.day,
              focus: d.focus,
              isRestDay: d.isRestDay,
              exercises: exOut,
            });
          }
          normalizedPayload = splitOut;
        }

        await tx.savedPlan.create({
          data: {
            id: generateId('plan'),
            userId,
            type: plan.type,
            name: plan.name,
            description: plan.description,
            payload: normalizedPayload as unknown as Prisma.InputJsonValue,
            createdAt: now,
          },
        });
        categories.savedPlans.created += 1;
      }

      const totals = emptyCategorySummary();
      for (const cat of Object.values(categories)) {
        if (!cat) continue;
        totals.created += cat.created;
        totals.duplicatesSkipped += cat.duplicatesSkipped;
        totals.replaced += cat.replaced;
        totals.updated += cat.updated;
      }

      return {
        success: true,
        importType: input.importType,
        mode: input.mode,
        totals,
        categories,
        warnings,
      };
    },
    { timeoutMs: 30_000 }
  );

  return result;
}
