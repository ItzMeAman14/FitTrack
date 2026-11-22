import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import {
  assertDatabaseConfigured,
  DAY_ORDER,
  prisma,
  toApiExercise,
  toApiWorkoutDaySplit,
  toApiWorkoutSession,
  withTransaction,
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { buildEmptyWeeklySplit } from '../seed.js';
import type { DayOfWeek, Exercise, SplitExercise, WorkoutDaySplit, WorkoutSession } from '../types.js';
import { generateId } from '../utils/crypto.js';
import { getLocalDateInfo } from '../utils/date.js';
import { AppError, asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

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
      .refine((v) => validator(v), `Invalid ${label} format. Use an http(s) URL or valid uploaded file.`)
      .nullable()
      .optional()
  );

const optionalWeight = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
  z.number().min(0).max(1000).nullable().optional()
);

const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  muscleGroup: z.enum(['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'CARDIO']),
  equipment: z.string().trim().min(1).max(60),
  defaultSets: z.coerce.number().int().positive().max(20),
  defaultReps: z.string().trim().min(1).max(30),
  defaultRestSeconds: z.coerce.number().int().min(15).max(600).default(90),
  defaultWeightKg: optionalWeight,
  instructions: z.string().trim().max(1000).default(''),
  imageUrl: optionalMediaUrl(isSafeImageUrl, 3_500_000, 'exercise image'),
  videoUrl: optionalMediaUrl(isSafeVideoUrl, 12_000_000, 'exercise video'),
});

const exerciseMediaPatchSchema = z.object({
  imageUrl: optionalMediaUrl(isSafeImageUrl, 3_500_000, 'exercise image'),
  videoUrl: optionalMediaUrl(isSafeVideoUrl, 12_000_000, 'exercise video'),
  instructions: z.string().trim().max(1000).optional(),
  defaultWeightKg: optionalWeight,
});

const daySplitUpdateSchema = z.object({
  focus: z.string().trim().min(1).max(120),
  isRestDay: z.boolean(),
  exercises: z.array(
    z.object({
      id: z.string().optional(),
      exerciseId: z.string().min(1),
      targetSets: z.coerce.number().int().positive().max(20),
      targetReps: z.string().trim().min(1).max(30),
      restSeconds: z.coerce.number().int().min(15).max(600),
      targetWeightKg: optionalWeight,
    })
  ),
});

const workoutSessionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  day: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
  title: z.string().trim().min(1).max(120),
  durationMinutes: z.coerce.number().int().min(1).max(360),
  notes: z.string().trim().max(500).default(''),
  exercises: z.array(
    z.object({
      exerciseId: z.string().min(1),
      exerciseName: z.string().min(1),
      muscleGroup: z.enum(['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'CARDIO']),
      sets: z.array(
        z.object({
          setNumber: z.coerce.number().int().positive(),
          reps: z.coerce.number().int().min(0).max(500),
          weightKg: z.coerce.number().min(0).max(1000),
          completed: z.boolean(),
        })
      ),
    })
  ),
});

function enrichSplit(split: WorkoutDaySplit[], userExercises: Exercise[]): WorkoutDaySplit[] {
  const byId = new Map(userExercises.map((e) => [e.id, e]));
  return split.map((day) => ({
    ...day,
    exercises: day.exercises.map((item): SplitExercise => {
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

function enrichSessions(sessions: WorkoutSession[], userExercises: Exercise[]): WorkoutSession[] {
  const byId = new Map(userExercises.map((e) => [e.id, e]));
  return sessions.map((session) => ({
    ...session,
    exercises: session.exercises.map((ex) => {
      const lib = byId.get(ex.exerciseId);
      return {
        ...ex,
        imageUrl: lib ? (lib.imageUrl ?? null) : (ex.imageUrl ?? null),
        videoUrl: lib ? (lib.videoUrl ?? null) : (ex.videoUrl ?? null),
        instructions: lib ? lib.instructions : ex.instructions ?? '',
      };
    }),
  }));
}

// --- EXERCISE LIBRARY ---
router.get(
  '/exercises',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const list = await prisma.exercise.findMany({
      where: { userId: req.user!.id },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: list.map(toApiExercise) });
  })
);

router.post(
  '/exercises',
  asyncHandler(async (req, res) => {
    const parsed = exerciseSchema.parse(req.body);
    assertDatabaseConfigured();
    const created = await prisma.exercise.create({
      data: {
        id: generateId('ex'),
        userId: req.user!.id,
        name: parsed.name,
        muscleGroup: parsed.muscleGroup,
        equipment: parsed.equipment,
        defaultSets: parsed.defaultSets,
        defaultReps: parsed.defaultReps,
        defaultRestSeconds: parsed.defaultRestSeconds,
        defaultWeightKg: parsed.defaultWeightKg ?? null,
        instructions: parsed.instructions,
        imageUrl: parsed.imageUrl ?? null,
        videoUrl: parsed.videoUrl ?? null,
        isDefault: false,
        createdAt: new Date(),
      },
    });
    res.status(201).json({ success: true, message: 'Exercise added.', data: toApiExercise(created) });
  })
);

router.put(
  '/exercises/:id',
  asyncHandler(async (req, res) => {
    const parsed = exerciseSchema.parse(req.body);
    const updated = await withTransaction(async (tx) => {
      const existing = await tx.exercise.findFirst({
        where: { id: String(req.params.id), userId: req.user!.id },
      });
      if (!existing) throw new AppError('Exercise not found.', 404);
      const row = await tx.exercise.update({
        where: { id: existing.id },
        data: {
          ...parsed,
          defaultWeightKg: parsed.defaultWeightKg ?? null,
          imageUrl: parsed.imageUrl === undefined ? existing.imageUrl ?? null : parsed.imageUrl,
          videoUrl: parsed.videoUrl === undefined ? existing.videoUrl ?? null : parsed.videoUrl,
        },
      });
      return toApiExercise(row);
    });
    res.json({ success: true, message: 'Exercise updated.', data: updated });
  })
);

router.patch(
  '/exercises/:id/media',
  asyncHandler(async (req, res) => {
    const parsed = exerciseMediaPatchSchema.parse(req.body);
    const updated = await withTransaction(async (tx) => {
      const existing = await tx.exercise.findFirst({
        where: { id: String(req.params.id), userId: req.user!.id },
      });
      if (!existing) throw new AppError('Exercise not found.', 404);
      const row = await tx.exercise.update({
        where: { id: existing.id },
        data: {
          ...(parsed.imageUrl !== undefined ? { imageUrl: parsed.imageUrl } : {}),
          ...(parsed.videoUrl !== undefined ? { videoUrl: parsed.videoUrl } : {}),
          ...(parsed.instructions !== undefined ? { instructions: parsed.instructions } : {}),
          ...(parsed.defaultWeightKg !== undefined
            ? { defaultWeightKg: parsed.defaultWeightKg }
            : {}),
        },
      });
      return toApiExercise(row);
    });
    res.json({ success: true, message: 'Exercise media updated.', data: updated });
  })
);

router.delete(
  '/exercises/:id',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const deleted = await prisma.exercise.deleteMany({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (deleted.count === 0) throw new AppError('Exercise not found.', 404);
    res.json({ success: true, message: 'Exercise deleted.' });
  })
);

// --- WEEKLY SPLIT ---
router.get(
  '/workouts/split',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const userId = req.user!.id;
    const [splitRows, exerciseRows] = await Promise.all([
      prisma.workoutDaySplit.findMany({
        where: { userId },
        include: { exercises: { orderBy: { sortOrder: 'asc' } } },
      }),
      prisma.exercise.findMany({ where: { userId } }),
    ]);

    const split: WorkoutDaySplit[] =
      splitRows.length > 0
        ? [...splitRows]
            .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
            .map(toApiWorkoutDaySplit)
        : buildEmptyWeeklySplit();

    res.json({ success: true, data: enrichSplit(split, exerciseRows.map(toApiExercise)) });
  })
);

router.put(
  '/workouts/split/:day',
  asyncHandler(async (req, res) => {
    const day = req.params.day.toUpperCase() as DayOfWeek;
    if (!DAY_ORDER.includes(day)) {
      throw new AppError('Invalid day of week.', 400);
    }
    const parsed = daySplitUpdateSchema.parse(req.body);

    const updatedSplit = await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const existingDays = await tx.workoutDaySplit.findMany({
        where: { userId },
        select: { day: true },
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

      const userExercises = await tx.exercise.findMany({ where: { userId } });
      const exerciseById = new Map(userExercises.map((e) => [e.id, e]));

      const resolvedExercises = parsed.exercises.map((item, idx) => {
        const ex = exerciseById.get(item.exerciseId);
        if (!ex) throw new AppError('Referenced exercise not found.', 404);
        return {
          id: item.id || generateId('spex'),
          sortOrder: idx,
          exerciseId: ex.id,
          exerciseName: ex.name,
          muscleGroup: ex.muscleGroup,
          targetSets: item.targetSets,
          targetReps: item.targetReps,
          restSeconds: item.restSeconds,
          targetWeightKg: item.targetWeightKg ?? ex.defaultWeightKg ?? null,
          instructions: ex.instructions ?? '',
          imageUrl: ex.imageUrl ?? null,
          videoUrl: ex.videoUrl ?? null,
        };
      });

      const daySplit = await tx.workoutDaySplit.upsert({
        where: { userId_day: { userId, day } },
        create: {
          userId,
          day,
          focus: parsed.focus,
          isRestDay: parsed.isRestDay,
        },
        update: {
          focus: parsed.focus,
          isRestDay: parsed.isRestDay,
        },
      });

      await tx.splitExercise.deleteMany({ where: { daySplitId: daySplit.id } });
      if (resolvedExercises.length > 0) {
        await tx.splitExercise.createMany({
          data: resolvedExercises.map((ex) => ({
            ...ex,
            daySplitId: daySplit.id,
          })),
        });
      }

      const allDays = await tx.workoutDaySplit.findMany({
        where: { userId },
        include: { exercises: { orderBy: { sortOrder: 'asc' } } },
      });
      const ordered = [...allDays]
        .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
        .map(toApiWorkoutDaySplit);

      return enrichSplit(ordered, userExercises.map(toApiExercise));
    });

    res.json({ success: true, message: `${day} split updated.`, data: updatedSplit });
  })
);

// --- WORKOUT SESSIONS ---
router.get(
  '/workouts/sessions',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const userId = req.user!.id;
    const [sessions, userExercises] = await Promise.all([
      prisma.workoutSession.findMany({
        where: { userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.exercise.findMany({ where: { userId } }),
    ]);
    res.json({
      success: true,
      data: enrichSessions(sessions.map(toApiWorkoutSession), userExercises.map(toApiExercise)),
    });
  })
);

router.post(
  '/workouts/sessions',
  asyncHandler(async (req, res) => {
    const parsed = workoutSessionSchema.parse(req.body);
    const created = await withTransaction(async (tx) => {
      const userId = req.user!.id;
      const [profile, userExercises] = await Promise.all([
        tx.fitnessProfile.findUnique({ where: { userId }, select: { timezone: true } }),
        tx.exercise.findMany({ where: { userId } }),
      ]);
      const todayIso = getLocalDateInfo(profile?.timezone || 'Asia/Kolkata').isoDate;
      const byId = new Map(userExercises.map((e) => [e.id, e]));

      let totalVolumeKg = 0;
      const enrichedExercises = parsed.exercises.map((ex) => {
        for (const set of ex.sets) {
          if (set.completed) {
            totalVolumeKg += set.reps * set.weightKg;
          }
        }
        const lib = byId.get(ex.exerciseId);
        return {
          ...ex,
          imageUrl: lib?.imageUrl ?? null,
          videoUrl: lib?.videoUrl ?? null,
          instructions: lib?.instructions ?? '',
        };
      });

      const session = await tx.workoutSession.create({
        data: {
          id: generateId('ws'),
          userId,
          date: parsed.date || todayIso,
          day: parsed.day,
          title: parsed.title,
          durationMinutes: parsed.durationMinutes,
          totalVolumeKg: Math.round(totalVolumeKg),
          notes: parsed.notes,
          exercises: enrichedExercises as unknown as Prisma.InputJsonValue,
          createdAt: new Date(),
        },
      });
      return toApiWorkoutSession(session);
    });
    res.status(201).json({ success: true, message: 'Workout session logged.', data: created });
  })
);

router.delete(
  '/workouts/sessions/:id',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const deleted = await prisma.workoutSession.deleteMany({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (deleted.count === 0) throw new AppError('Workout session not found.', 404);
    res.json({ success: true, message: 'Workout session deleted.' });
  })
);

export default router;
