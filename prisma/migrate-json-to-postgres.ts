import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import type { DatabaseSchema } from '../server/types.js';

const prisma = new PrismaClient();

function parseArgPath(): string {
  const idx = process.argv.indexOf('--file');
  if (idx !== -1 && process.argv[idx + 1]) {
    return path.resolve(process.argv[idx + 1]);
  }
  if (process.env.FITTRACK_JSON_PATH?.trim()) {
    return path.resolve(process.env.FITTRACK_JSON_PATH.trim());
  }
  return path.resolve(process.cwd(), 'data', 'fittrack.json');
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is not set. Configure your Neon PostgreSQL connection string before migrating.');
  }

  const filePath = parseArgPath();
  if (!fs.existsSync(filePath)) {
    console.log(`[Migrate JSON -> PostgreSQL] No JSON store found at ${filePath}. Nothing to import.`);
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) {
    console.log(`[Migrate JSON -> PostgreSQL] JSON store at ${filePath} is empty. Nothing to import.`);
    return;
  }

  const data = JSON.parse(raw) as Partial<DatabaseSchema>;
  const users = data.users ?? [];

  if (users.length === 0) {
    console.log('[Migrate JSON -> PostgreSQL] No users found in JSON store. Skipping import.');
    return;
  }

  const counts = await prisma.$transaction(
    async (tx) => {
      for (const u of users) {
        await tx.user.upsert({
          where: { id: u.id },
          update: {
            name: u.name,
            email: u.email,
            passwordHash: u.passwordHash,
            avatarUrl: u.avatarUrl ?? null,
            updatedAt: new Date(u.updatedAt || u.createdAt || Date.now()),
          },
          create: {
            id: u.id,
            name: u.name,
            email: u.email,
            passwordHash: u.passwordHash,
            avatarUrl: u.avatarUrl ?? null,
            createdAt: new Date(u.createdAt || Date.now()),
            updatedAt: new Date(u.updatedAt || u.createdAt || Date.now()),
          },
        });
      }

      if ((data.sessions ?? []).length > 0) {
        await tx.session.createMany({
          data: (data.sessions ?? []).map((s) => ({
            id: s.id,
            userId: s.userId,
            tokenHash: s.tokenHash,
            userAgent: s.userAgent ?? null,
            ipAddress: s.ipAddress ?? null,
            expiresAt: new Date(s.expiresAt),
            createdAt: new Date(s.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      for (const p of data.profiles ?? []) {
        await tx.fitnessProfile.upsert({
          where: { userId: p.userId },
          update: {},
          create: {
            id: p.id,
            userId: p.userId,
            age: p.age ?? null,
            gender: p.gender ?? null,
            heightCm: p.heightCm ?? null,
            startingWeightKg: p.startingWeightKg ?? null,
            currentWeightKg: p.currentWeightKg ?? null,
            targetWeightKg: p.targetWeightKg ?? null,
            targetWaistCm: p.targetWaistCm ?? null,
            targetBodyFatPct: p.targetBodyFatPct ?? null,
            fitnessGoal: p.fitnessGoal || 'MAINTENANCE',
            activityLevel: p.activityLevel || 'MODERATELY_ACTIVE',
            dailyCalorieTarget: p.dailyCalorieTarget ?? null,
            dailyProteinTargetG: p.dailyProteinTargetG ?? null,
            dailyCarbTargetG: p.dailyCarbTargetG ?? null,
            dailyFatTargetG: p.dailyFatTargetG ?? null,
            preferredWeightUnit: p.preferredWeightUnit || 'KG',
            preferredMeasureUnit: p.preferredMeasureUnit || 'CM',
            currency: p.currency || 'INR',
            timezone: p.timezone || 'Asia/Kolkata',
            theme: p.theme || 'dark',
            geminiEnabled: p.geminiEnabled ?? true,
            createdAt: new Date(p.createdAt || Date.now()),
            updatedAt: new Date(p.updatedAt || p.createdAt || Date.now()),
          },
        });
      }

      if ((data.foods ?? []).length > 0) {
        await tx.foodItem.createMany({
          data: (data.foods ?? []).map((f) => ({
            id: f.id,
            userId: f.userId,
            name: f.name,
            category: f.category,
            servingLabel: f.servingLabel,
            servingGrams: f.servingGrams,
            calories: f.calories,
            proteinG: f.proteinG,
            carbsG: f.carbsG,
            fatG: f.fatG,
            priceInr: f.priceInr,
            isDefault: Boolean(f.isDefault),
            createdAt: new Date(f.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      for (const m of data.plannedMeals ?? []) {
        const existingMeal = await tx.plannedMeal.findUnique({ where: { id: m.id } });
        if (!existingMeal) {
          await tx.plannedMeal.create({
            data: {
              id: m.id,
              userId: m.userId,
              name: m.name,
              time: m.time,
              items: {
                create: (m.items ?? []).map((it, idx) => ({
                  id: it.id,
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
      }

      if ((data.mealLogs ?? []).length > 0) {
        await tx.mealLog.createMany({
          data: (data.mealLogs ?? []).map((l) => ({
            id: l.id,
            userId: l.userId,
            date: l.date,
            mealName: l.mealName,
            time: l.time,
            foodId: l.foodId ?? null,
            foodName: l.foodName,
            servings: l.servings,
            servingLabel: l.servingLabel,
            calories: l.calories,
            proteinG: l.proteinG,
            carbsG: l.carbsG,
            fatG: l.fatG,
            priceInr: l.priceInr,
            plannedMealId: l.plannedMealId ?? null,
            createdAt: new Date(l.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      if ((data.exercises ?? []).length > 0) {
        await tx.exercise.createMany({
          data: (data.exercises ?? []).map((e) => ({
            id: e.id,
            userId: e.userId,
            name: e.name,
            muscleGroup: e.muscleGroup,
            equipment: e.equipment,
            defaultSets: e.defaultSets,
            defaultReps: e.defaultReps,
            defaultRestSeconds: e.defaultRestSeconds ?? 90,
            defaultWeightKg: e.defaultWeightKg ?? null,
            instructions: e.instructions || '',
            imageUrl: e.imageUrl ?? null,
            videoUrl: e.videoUrl ?? null,
            isDefault: Boolean(e.isDefault),
            createdAt: new Date(e.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      const splitEntries = Object.entries(data.workoutSplits ?? {});
      for (const [userId, days] of splitEntries) {
        for (const daySplit of days) {
          const existingDay = await tx.workoutDaySplit.findUnique({
            where: { userId_day: { userId, day: daySplit.day } },
          });
          if (!existingDay) {
            await tx.workoutDaySplit.create({
              data: {
                userId,
                day: daySplit.day,
                focus: daySplit.focus,
                isRestDay: Boolean(daySplit.isRestDay),
                exercises: {
                  create: (daySplit.exercises ?? []).map((ex, idx) => ({
                    id: ex.id,
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
      }

      if ((data.workoutSessions ?? []).length > 0) {
        await tx.workoutSession.createMany({
          data: (data.workoutSessions ?? []).map((s) => ({
            id: s.id,
            userId: s.userId,
            date: s.date,
            day: s.day,
            title: s.title,
            durationMinutes: s.durationMinutes,
            totalVolumeKg: s.totalVolumeKg,
            notes: s.notes || '',
            exercises: s.exercises as unknown as Prisma.InputJsonValue,
            createdAt: new Date(s.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      if ((data.measurements ?? []).length > 0) {
        await tx.bodyMeasurement.createMany({
          data: (data.measurements ?? []).map((m) => ({
            id: m.id,
            userId: m.userId,
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
            customMeasurements: (m.customMeasurements ?? []) as unknown as Prisma.InputJsonValue,
            photoDataUrl: m.photoDataUrl ?? null,
            notes: m.notes || '',
            createdAt: new Date(m.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      if ((data.savedPlans ?? []).length > 0) {
        await tx.savedPlan.createMany({
          data: (data.savedPlans ?? []).map((p) => ({
            id: p.id,
            userId: p.userId,
            type: p.type,
            name: p.name,
            description: p.description || '',
            payload: p.payload as Prisma.InputJsonValue,
            createdAt: new Date(p.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      if ((data.aiMessages ?? []).length > 0) {
        await tx.aiMessage.createMany({
          data: (data.aiMessages ?? []).map((m) => ({
            id: m.id,
            userId: m.userId,
            role: m.role,
            content: m.content,
            proposal: m.proposal ? (m.proposal as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            createdAt: new Date(m.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      if ((data.pendingProposals ?? []).length > 0) {
        await tx.aiPendingProposal.createMany({
          data: (data.pendingProposals ?? []).map((p) => ({
            id: p.id,
            userId: p.userId,
            messageId: p.messageId,
            status: p.status,
            proposal: p.proposal as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(p.expiresAt),
            createdAt: new Date(p.createdAt || Date.now()),
            resolvedAt: p.resolvedAt ? new Date(p.resolvedAt) : null,
          })),
          skipDuplicates: true,
        });
      }

      if ((data.aiAuditLogs ?? []).length > 0) {
        await tx.aiAuditLog.createMany({
          data: (data.aiAuditLogs ?? []).map((l) => ({
            id: l.id,
            userId: l.userId,
            proposalId: l.proposalId,
            type: l.type,
            action: l.action,
            editedByUser: Boolean(l.editedByUser),
            summary: l.summary,
            details: (l.details ?? {}) as Prisma.InputJsonValue,
            createdAt: new Date(l.createdAt || Date.now()),
          })),
          skipDuplicates: true,
        });
      }

      return {
        users: users.length,
        foods: (data.foods ?? []).length,
        plannedMeals: (data.plannedMeals ?? []).length,
        mealLogs: (data.mealLogs ?? []).length,
        exercises: (data.exercises ?? []).length,
        workoutSessions: (data.workoutSessions ?? []).length,
        measurements: (data.measurements ?? []).length,
        savedPlans: (data.savedPlans ?? []).length,
        aiMessages: (data.aiMessages ?? []).length,
      };
    },
    { maxWait: 10000, timeout: 60000 }
  );

  console.log('[Migrate JSON -> PostgreSQL] Import completed inside transaction:', counts);
}

main()
  .catch((err) => {
    console.error('[Migrate JSON -> PostgreSQL] Migration failed (transaction rolled back):', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
