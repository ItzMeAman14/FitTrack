import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import type {
  AiAuditLog,
  AiMessage,
  AiProposal,
  BodyMeasurement,
  CustomMeasurementEntry,
  DayOfWeek,
  Exercise,
  FitnessProfile,
  FoodItem,
  LoggedExercise,
  MealLog,
  PlannedMeal,
  PlannedMealItem,
  SavedPlan,
  SplitExercise,
  User,
  WorkoutDaySplit,
  WorkoutSession,
} from './types.js';
import { AppError } from './utils/error.js';

declare global {
  // eslint-disable-next-line no-var
  var __fittrackPrisma: PrismaClient | undefined;
}

export function resolveDatabaseUrl(): string | undefined {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.NEON_DATABASE_URL,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      if (!process.env.DATABASE_URL?.trim()) {
        process.env.DATABASE_URL = trimmed;
      }
      return trimmed;
    }
  }
  return undefined;
}

export function isDatabaseConfigured(): boolean {
  const url = resolveDatabaseUrl();
  return Boolean(
    url &&
      !url.includes('USER:PASSWORD@HOST') &&
      !url.includes('ep-example') &&
      (url.startsWith('postgresql://') || url.startsWith('postgres://'))
  );
}

export function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new AppError(
      'DATABASE_URL is not configured. Set your Neon PostgreSQL connection string in environment variables (AI Studio Secrets, .env, or Vercel) and run `npx prisma migrate deploy`.',
      503
    );
  }
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn'] : [],
  });
}

export const prisma: PrismaClient = globalThis.__fittrackPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__fittrackPrisma = prisma;
}

let schemaReady = false;
let schemaInitPromise: Promise<void> | null = null;

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean);
}

export async function ensureDatabaseSchemaReady(): Promise<void> {
  assertDatabaseConfigured();
  if (schemaReady) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      const existing = await prisma.$queryRaw<Array<{ tbl: string | null }>>`
        SELECT to_regclass('public.users')::text AS tbl
      `;
      if (!existing[0]?.tbl) {
        const migrationPath = path.resolve(
          process.cwd(),
          'prisma/migrations/0001_init/migration.sql'
        );
        if (!fs.existsSync(migrationPath)) {
          throw new AppError(
            'Database schema is not initialized and migration SQL file was not found. Run `npx prisma migrate deploy`.',
            503
          );
        }

        const migrationSql = fs.readFileSync(migrationPath, 'utf8');
        const statements = splitSqlStatements(migrationSql);
        const checksum = crypto.createHash('sha256').update(migrationSql).digest('hex');

        await prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(74281931)');

            const recheck = await tx.$queryRaw<Array<{ tbl: string | null }>>`
              SELECT to_regclass('public.users')::text AS tbl
            `;
            if (recheck[0]?.tbl) {
              return;
            }

            for (const stmt of statements) {
              await tx.$executeRawUnsafe(stmt);
            }

            await tx.$executeRawUnsafe(`
              CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
                "id" VARCHAR(36) PRIMARY KEY NOT NULL,
                "checksum" VARCHAR(64) NOT NULL,
                "finished_at" TIMESTAMPTZ,
                "migration_name" VARCHAR(255) NOT NULL,
                "logs" TEXT,
                "rolled_back_at" TIMESTAMPTZ,
                "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "applied_steps_count" INTEGER NOT NULL DEFAULT 0
              )
            `);

            const existingMig = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "_prisma_migrations" WHERE "migration_name" = $1 LIMIT 1',
              '0001_init'
            );
            if (existingMig.length === 0) {
              await tx.$executeRawUnsafe(
                `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
                 VALUES ($1, $2, now(), $3, 1)`,
                crypto.randomUUID(),
                checksum,
                '0001_init'
              );
            }
          },
          {
            maxWait: 10000,
            timeout: 60000,
          }
        );
      }

      const aiModelsTable = await prisma.$queryRaw<Array<{ tbl: string | null }>>`
        SELECT to_regclass('public.user_ai_models')::text AS tbl
      `;
      if (!aiModelsTable[0]?.tbl) {
        await prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(74281932)');

            const recheck = await tx.$queryRaw<Array<{ tbl: string | null }>>`
              SELECT to_regclass('public.user_ai_models')::text AS tbl
            `;
            if (recheck[0]?.tbl) {
              return;
            }

            await tx.$executeRawUnsafe(`
              CREATE TABLE IF NOT EXISTS "user_ai_models" (
                "id" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "label" TEXT NOT NULL,
                "provider" TEXT NOT NULL,
                "modelName" TEXT NOT NULL,
                "baseUrl" TEXT,
                "encryptedApiKey" TEXT NOT NULL,
                "keyPreview" TEXT NOT NULL,
                "isDefault" BOOLEAN NOT NULL DEFAULT false,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "user_ai_models_pkey" PRIMARY KEY ("id")
              )
            `);

            await tx.$executeRawUnsafe(
              `CREATE INDEX IF NOT EXISTS "user_ai_models_userId_idx" ON "user_ai_models"("userId")`
            );

            const fkExists = await tx.$queryRawUnsafe<Array<{ conname: string }>>(
              `SELECT conname FROM pg_constraint WHERE conname = 'user_ai_models_userId_fkey' LIMIT 1`
            );
            if (fkExists.length === 0) {
              await tx.$executeRawUnsafe(`
                ALTER TABLE "user_ai_models"
                ADD CONSTRAINT "user_ai_models_userId_fkey"
                FOREIGN KEY ("userId") REFERENCES "users"("id")
                ON DELETE CASCADE ON UPDATE CASCADE
              `);
            }

            const migTable = await tx.$queryRaw<Array<{ tbl: string | null }>>`
              SELECT to_regclass('public._prisma_migrations')::text AS tbl
            `;
            if (migTable[0]?.tbl) {
              const existingMig = await tx.$queryRawUnsafe<Array<{ id: string }>>(
                'SELECT "id" FROM "_prisma_migrations" WHERE "migration_name" = $1 LIMIT 1',
                '0002_user_ai_models'
              );
              if (existingMig.length === 0) {
                const checksum = crypto
                  .createHash('sha256')
                  .update('0002_user_ai_models')
                  .digest('hex');
                await tx.$executeRawUnsafe(
                  `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
                   VALUES ($1, $2, now(), $3, 1)`,
                  crypto.randomUUID(),
                  checksum,
                  '0002_user_ai_models'
                );
              }
            }
          },
          {
            maxWait: 10000,
            timeout: 30000,
          }
        );
      }

      schemaReady = true;
    } finally {
      schemaInitPromise = null;
    }
  })();

  return schemaInitPromise;
}

export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeoutMs?: number; maxWaitMs?: number }
): Promise<T> {
  assertDatabaseConfigured();
  return prisma.$transaction(fn, {
    maxWait: options?.maxWaitMs ?? 5000,
    timeout: options?.timeoutMs ?? 15000,
  });
}

export const DAY_ORDER: DayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export function toApiUser(row: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toApiProfile(
  row: {
    id: string;
    userId: string;
    age: number | null;
    gender: FitnessProfile['gender'];
    heightCm: number | null;
    startingWeightKg: number | null;
    currentWeightKg: number | null;
    targetWeightKg: number | null;
    targetWaistCm: number | null;
    targetBodyFatPct: number | null;
    fitnessGoal: FitnessProfile['fitnessGoal'];
    activityLevel: FitnessProfile['activityLevel'];
    dailyCalorieTarget: number | null;
    dailyProteinTargetG: number | null;
    dailyCarbTargetG: number | null;
    dailyFatTargetG: number | null;
    preferredWeightUnit: FitnessProfile['preferredWeightUnit'];
    preferredMeasureUnit: FitnessProfile['preferredMeasureUnit'];
    currency: string;
    timezone: string;
    theme: string;
    geminiEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null
): FitnessProfile | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    age: row.age,
    gender: row.gender,
    heightCm: row.heightCm,
    startingWeightKg: row.startingWeightKg,
    currentWeightKg: row.currentWeightKg,
    targetWeightKg: row.targetWeightKg,
    targetWaistCm: row.targetWaistCm,
    targetBodyFatPct: row.targetBodyFatPct,
    fitnessGoal: row.fitnessGoal,
    activityLevel: row.activityLevel,
    dailyCalorieTarget: row.dailyCalorieTarget,
    dailyProteinTargetG: row.dailyProteinTargetG,
    dailyCarbTargetG: row.dailyCarbTargetG,
    dailyFatTargetG: row.dailyFatTargetG,
    preferredWeightUnit: row.preferredWeightUnit,
    preferredMeasureUnit: row.preferredMeasureUnit,
    currency: row.currency,
    timezone: row.timezone,
    theme: 'dark',
    geminiEnabled: row.geminiEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toApiFood(row: {
  id: string;
  userId: string;
  name: string;
  category: FoodItem['category'];
  servingLabel: string;
  servingGrams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  priceInr: number;
  isDefault: boolean;
  createdAt: Date;
}): FoodItem {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    category: row.category,
    servingLabel: row.servingLabel,
    servingGrams: row.servingGrams,
    calories: row.calories,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    priceInr: row.priceInr,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApiPlannedMeal(row: {
  id: string;
  userId: string;
  name: string;
  time: string;
  items: Array<{
    id: string;
    foodId: string;
    foodName: string;
    servings: number;
    servingLabel: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    priceInr: number;
  }>;
}): PlannedMeal {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    time: row.time,
    items: row.items.map(
      (it): PlannedMealItem => ({
        id: it.id,
        foodId: it.foodId,
        foodName: it.foodName,
        servings: it.servings,
        servingLabel: it.servingLabel,
        calories: it.calories,
        proteinG: it.proteinG,
        carbsG: it.carbsG,
        fatG: it.fatG,
        priceInr: it.priceInr,
      })
    ),
  };
}

export function toApiMealLog(row: {
  id: string;
  userId: string;
  date: string;
  mealName: string;
  time: string;
  foodId: string | null;
  foodName: string;
  servings: number;
  servingLabel: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  priceInr: number;
  plannedMealId: string | null;
  createdAt: Date;
}): MealLog {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    mealName: row.mealName,
    time: row.time,
    foodId: row.foodId,
    foodName: row.foodName,
    servings: row.servings,
    servingLabel: row.servingLabel,
    calories: row.calories,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    priceInr: row.priceInr,
    plannedMealId: row.plannedMealId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApiExercise(row: {
  id: string;
  userId: string;
  name: string;
  muscleGroup: Exercise['muscleGroup'];
  equipment: string;
  defaultSets: number;
  defaultReps: string;
  defaultRestSeconds: number;
  defaultWeightKg: number | null;
  instructions: string;
  imageUrl: string | null;
  videoUrl: string | null;
  isDefault: boolean;
  createdAt: Date;
}): Exercise {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    muscleGroup: row.muscleGroup,
    equipment: row.equipment,
    defaultSets: row.defaultSets,
    defaultReps: row.defaultReps,
    defaultRestSeconds: row.defaultRestSeconds ?? 90,
    defaultWeightKg: row.defaultWeightKg ?? null,
    instructions: row.instructions,
    imageUrl: row.imageUrl ?? null,
    videoUrl: row.videoUrl ?? null,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApiWorkoutDaySplit(row: {
  day: DayOfWeek;
  focus: string;
  isRestDay: boolean;
  exercises: Array<{
    id: string;
    exerciseId: string;
    exerciseName: string;
    muscleGroup: SplitExercise['muscleGroup'];
    targetSets: number;
    targetReps: string;
    restSeconds: number;
    targetWeightKg: number | null;
    instructions: string | null;
    imageUrl: string | null;
    videoUrl: string | null;
  }>;
}): WorkoutDaySplit {
  return {
    day: row.day,
    focus: row.focus,
    isRestDay: row.isRestDay,
    exercises: row.exercises.map(
      (ex): SplitExercise => ({
        id: ex.id,
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
      })
    ),
  };
}

export function toApiWorkoutSession(row: {
  id: string;
  userId: string;
  date: string;
  day: DayOfWeek;
  title: string;
  durationMinutes: number;
  totalVolumeKg: number;
  notes: string;
  exercises: Prisma.JsonValue;
  createdAt: Date;
}): WorkoutSession {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    day: row.day,
    title: row.title,
    durationMinutes: row.durationMinutes,
    totalVolumeKg: row.totalVolumeKg,
    notes: row.notes,
    exercises: Array.isArray(row.exercises) ? (row.exercises as unknown as LoggedExercise[]) : [],
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApiBodyMeasurement(row: {
  id: string;
  userId: string;
  date: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  waistCm: number | null;
  chestCm: number | null;
  hipsCm: number | null;
  armsCm: number | null;
  thighsCm: number | null;
  neckCm: number | null;
  calvesCm: number | null;
  customMeasurements: Prisma.JsonValue;
  photoDataUrl: string | null;
  notes: string;
  createdAt: Date;
}): BodyMeasurement {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    weightKg: row.weightKg,
    bodyFatPct: row.bodyFatPct,
    waistCm: row.waistCm,
    chestCm: row.chestCm,
    hipsCm: row.hipsCm ?? null,
    armsCm: row.armsCm,
    thighsCm: row.thighsCm,
    neckCm: row.neckCm,
    calvesCm: row.calvesCm ?? null,
    customMeasurements: Array.isArray(row.customMeasurements)
      ? (row.customMeasurements as unknown as CustomMeasurementEntry[])
      : [],
    photoDataUrl: row.photoDataUrl,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApiSavedPlan(row: {
  id: string;
  userId: string;
  type: SavedPlan['type'];
  name: string;
  description: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): SavedPlan {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    name: row.name,
    description: row.description,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApiAiMessage(row: {
  id: string;
  userId: string;
  role: AiMessage['role'];
  content: string;
  proposal: Prisma.JsonValue | null;
  createdAt: Date;
}): AiMessage {
  return {
    id: row.id,
    userId: row.userId,
    role: row.role,
    content: row.content,
    proposal: row.proposal ? (row.proposal as unknown as AiProposal) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApiAiAuditLog(row: {
  id: string;
  userId: string;
  proposalId: string;
  type: AiAuditLog['type'];
  action: AiAuditLog['action'];
  editedByUser: boolean;
  summary: string;
  details: Prisma.JsonValue;
  createdAt: Date;
}): AiAuditLog {
  return {
    id: row.id,
    userId: row.userId,
    proposalId: row.proposalId,
    type: row.type,
    action: row.action,
    editedByUser: row.editedByUser,
    summary: row.summary,
    details:
      row.details && typeof row.details === 'object' && !Array.isArray(row.details)
        ? (row.details as Record<string, unknown>)
        : {},
    createdAt: row.createdAt.toISOString(),
  };
}
