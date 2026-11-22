import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  assertDatabaseConfigured,
  DAY_ORDER,
  prisma,
  toApiAiMessage,
  toApiBodyMeasurement,
  toApiFood,
  toApiProfile,
  toApiWorkoutDaySplit,
  toApiWorkoutSession,
  withTransaction,
} from '../db.js';
import { buildEmptyWeeklySplit } from '../seed.js';
import type {
  AiMessage,
  AiNewPlanPreview,
  AiProposal,
  AiProposalChange,
  AiProposalType,
  DayOfWeek,
  DietTag,
  Exercise,
  FoodItem,
  MuscleGroup,
  PlannedMeal,
  PlannedMealItem,
  WorkoutDaySplit,
} from '../types.js';
import { decryptSecret, generateId } from '../utils/crypto.js';
import { getLocalDateInfo } from '../utils/date.js';
import { AppError } from '../utils/error.js';
import {
  createAiProviderFromConfig,
  getAiProvider,
  stripJsonCodeFences,
  type AiProvider,
  type AiProviderName,
} from './aiProvider.js';

export type AiProcessingStage =
  | 'analyzing_plans'
  | 'calling_model'
  | 'retrying'
  | 'fallback_model'
  | 'tool_calling'
  | 'generating'
  | 'preparing_updates'
  | 'saving';

export interface AiStageEvent {
  stage: AiProcessingStage;
  label: string;
}

type ChatResponse = {
  userMessage: AiMessage;
  assistantMessage: AiMessage;
};

const CHAT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const inFlightChatRequests = new Map<string, Promise<ChatResponse>>();
const completedChatRequests = new Map<string, { data: ChatResponse; expiresAt: number }>();

function pruneCompletedChatRequests(nowMs: number) {
  for (const [k, v] of completedChatRequests.entries()) {
    if (v.expiresAt <= nowMs) {
      completedChatRequests.delete(k);
    }
  }
  while (completedChatRequests.size > 200) {
    const oldestKey = completedChatRequests.keys().next().value;
    if (!oldestKey) break;
    completedChatRequests.delete(oldestKey);
  }
}

function getProviderDisplayName(name: AiProviderName): string {
  switch (name) {
    case 'gemini':
      return 'Gemini';
    case 'grok':
      return 'Grok';
    case 'openrouter':
      return 'OpenRouter';
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Claude';
    case 'deepseek':
      return 'DeepSeek';
    default:
      return 'FitTrack AI';
  }
}

const PROPOSAL_TTL_MS = 60 * 60 * 1000; // 60 minutes

function cmToInches(cm: number | null | undefined): number | null {
  if (cm === null || cm === undefined) return null;
  return Number((cm / 2.54).toFixed(2));
}

function kgToLbs(kg: number | null | undefined): number | null {
  if (kg === null || kg === undefined) return null;
  return Number((kg * 2.20462).toFixed(2));
}

export async function buildFitnessContext(userId: string) {
  assertDatabaseConfigured();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  const profile = toApiProfile(user?.profile ?? null);
  const dateInfo = getLocalDateInfo(profile?.timezone || 'Asia/Kolkata');
  const measureUnit = profile?.preferredMeasureUnit || 'CM';
  const weightUnit = profile?.preferredWeightUnit || 'KG';

  const [
    todaysLogs,
    plannedMealsRaw,
    foodsRaw,
    exercisesRaw,
    splitsRaw,
    recentMeasurementsRaw,
    recentWorkoutsRaw,
    savedPlansRaw,
  ] = await Promise.all([
    prisma.mealLog.findMany({
      where: { userId, date: dateInfo.isoDate },
      orderBy: { time: 'asc' },
    }),
    prisma.plannedMeal.findMany({
      where: { userId },
      orderBy: { time: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.foodItem.findMany({ where: { userId } }),
    prisma.exercise.findMany({ where: { userId } }),
    prisma.workoutDaySplit.findMany({
      where: { userId },
      include: { exercises: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.bodyMeasurement.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    }),
    prisma.workoutSession.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    }),
    prisma.savedPlan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const todaysNutrition = {
    calories: Math.round(todaysLogs.reduce((s, l) => s + l.calories, 0)),
    proteinG: Math.round(todaysLogs.reduce((s, l) => s + l.proteinG, 0) * 10) / 10,
    carbsG: Math.round(todaysLogs.reduce((s, l) => s + l.carbsG, 0) * 10) / 10,
    fatG: Math.round(todaysLogs.reduce((s, l) => s + l.fatG, 0) * 10) / 10,
    expenseInr: Math.round(todaysLogs.reduce((s, l) => s + l.priceInr, 0)),
    items: todaysLogs.map(
      (l) => `${l.mealName}: ${l.foodName} (${l.servings}x, ${l.calories} kcal, ${l.proteinG}g P)`
    ),
  };

  const activeDietPlan = plannedMealsRaw.map((m) => ({
    id: m.id,
    name: m.name,
    time: m.time,
    totalCalories: Math.round(m.items.reduce((s, it) => s + it.calories, 0)),
    totalProteinG: Math.round(m.items.reduce((s, it) => s + it.proteinG, 0) * 10) / 10,
    items: m.items.map((it) => ({
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
    })),
  }));

  const availableFoods = foodsRaw.map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    servingLabel: f.servingLabel,
    servingGrams: f.servingGrams,
    calories: f.calories,
    proteinG: f.proteinG,
    carbsG: f.carbsG,
    fatG: f.fatG,
    priceInr: f.priceInr,
  }));

  const availableExercises = exercisesRaw.map((e) => ({
    id: e.id,
    name: e.name,
    muscleGroup: e.muscleGroup,
    equipment: e.equipment,
    defaultSets: e.defaultSets,
    defaultReps: e.defaultReps,
    defaultRestSeconds: e.defaultRestSeconds ?? 90,
    defaultWeightKg: e.defaultWeightKg ?? null,
    instructions: e.instructions,
    hasImage: Boolean(e.imageUrl),
    hasVideo: Boolean(e.videoUrl),
  }));

  const splitList =
    splitsRaw.length > 0
      ? [...splitsRaw]
          .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
          .map(toApiWorkoutDaySplit)
      : buildEmptyWeeklySplit();

  const activeWorkoutSplit = splitList.map((d) => ({
    day: d.day,
    focus: d.focus,
    isRestDay: d.isRestDay,
    exercises: d.exercises.map((ex) => ({
      id: ex.id,
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      muscleGroup: ex.muscleGroup,
      targetSets: ex.targetSets,
      targetReps: ex.targetReps,
      restSeconds: ex.restSeconds,
      targetWeightKg: ex.targetWeightKg ?? null,
    })),
  }));

  const recentMeasurements = recentMeasurementsRaw.map((row) => {
    const { photoDataUrl: _omit, ...rest } = toApiBodyMeasurement(row);
    return {
      ...rest,
      displayUnit: measureUnit === 'INCHES' ? 'in' : 'cm',
      displayWeightUnit: weightUnit === 'LBS' ? 'lbs' : 'kg',
      displayValues: {
        weight: weightUnit === 'LBS' ? kgToLbs(rest.weightKg) : rest.weightKg,
        waist: measureUnit === 'INCHES' ? cmToInches(rest.waistCm) : rest.waistCm,
        chest: measureUnit === 'INCHES' ? cmToInches(rest.chestCm) : rest.chestCm,
        hips: measureUnit === 'INCHES' ? cmToInches(rest.hipsCm ?? null) : rest.hipsCm ?? null,
        arms: measureUnit === 'INCHES' ? cmToInches(rest.armsCm) : rest.armsCm,
        thighs: measureUnit === 'INCHES' ? cmToInches(rest.thighsCm) : rest.thighsCm,
        neck: measureUnit === 'INCHES' ? cmToInches(rest.neckCm) : rest.neckCm,
        calves:
          measureUnit === 'INCHES' ? cmToInches(rest.calvesCm ?? null) : rest.calvesCm ?? null,
        custom: (rest.customMeasurements || []).map((c) => ({
          label: c.label,
          value: measureUnit === 'INCHES' ? cmToInches(c.valueCm) : c.valueCm,
        })),
      },
    };
  });

  const recentWorkouts = recentWorkoutsRaw.map((row) => {
    const w = toApiWorkoutSession(row);
    return {
      id: w.id,
      date: w.date,
      day: w.day,
      title: w.title,
      durationMinutes: w.durationMinutes,
      totalVolumeKg: w.totalVolumeKg,
      notes: w.notes,
      exercises: w.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        setsCount: ex.sets.length,
        sets: ex.sets,
      })),
    };
  });

  const savedPlans = savedPlansRaw.map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
  }));

  return {
    today: dateInfo,
    user: { name: user?.name },
    preferences: {
      weightUnit,
      measureUnit,
      currency: profile?.currency || 'INR',
      timezone: profile?.timezone || 'Asia/Kolkata',
    },
    profile,
    todaysNutrition,
    activeDietPlan,
    availableFoods,
    activeWorkoutSplit,
    availableExercises,
    recentMeasurements,
    recentWorkouts,
    savedPlans,
  };
}

function buildFoodDerivedMetrics(food: FoodItem, servings: number): Omit<PlannedMealItem, 'id'> {
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

async function resolveOrCreateFoodTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: {
    foodId?: string;
    foodName?: string;
    newFood?: {
      name: string;
      category?: DietTag;
      servingLabel?: string;
      servingGrams?: number;
      calories?: number;
      proteinG?: number;
      carbsG?: number;
      fatG?: number;
      priceInr?: number;
    };
  }
): Promise<FoodItem> {
  if (input.foodId) {
    const byId = await tx.foodItem.findFirst({
      where: { id: input.foodId, userId },
    });
    if (byId) return toApiFood(byId);
  }
  const targetName = (input.newFood?.name || input.foodName || '').trim().toLowerCase();
  if (targetName) {
    const allFoods = await tx.foodItem.findMany({ where: { userId } });
    const byName = allFoods.find((f) => f.name.trim().toLowerCase() === targetName);
    if (byName) return toApiFood(byName);
  }
  const nf = input.newFood;
  const created = await tx.foodItem.create({
    data: {
      id: generateId('food'),
      userId,
      name: (nf?.name || input.foodName || 'Custom Food').trim(),
      category: nf?.category || 'VEG',
      servingLabel: nf?.servingLabel || '1 serving (100g)',
      servingGrams: nf?.servingGrams && nf.servingGrams > 0 ? nf.servingGrams : 100,
      calories: Math.max(0, Math.round(nf?.calories ?? 150)),
      proteinG: Math.max(0, Number((nf?.proteinG ?? 10).toFixed(1))),
      carbsG: Math.max(0, Number((nf?.carbsG ?? 15).toFixed(1))),
      fatG: Math.max(0, Number((nf?.fatG ?? 5).toFixed(1))),
      priceInr: Math.max(0, Math.round(nf?.priceInr ?? 25)),
      isDefault: false,
      createdAt: new Date(),
    },
  });
  return toApiFood(created);
}

async function resolveOrCreateExerciseTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: {
    exerciseId?: string;
    exerciseName?: string;
    muscleGroup?: MuscleGroup;
    equipment?: string;
    targetSets?: number;
    targetReps?: string;
    restSeconds?: number;
    targetWeightKg?: number | null;
    instructions?: string;
  }
): Promise<Exercise> {
  if (input.exerciseId) {
    const byId = await tx.exercise.findFirst({
      where: { id: input.exerciseId, userId },
    });
    if (byId) {
      return {
        ...byId,
        createdAt: byId.createdAt.toISOString(),
      };
    }
  }
  const targetName = (input.exerciseName || '').trim().toLowerCase();
  if (targetName) {
    const allExercises = await tx.exercise.findMany({ where: { userId } });
    const byName = allExercises.find((e) => e.name.trim().toLowerCase() === targetName);
    if (byName) {
      return {
        ...byName,
        createdAt: byName.createdAt.toISOString(),
      };
    }
  }
  const rawGroup = typeof input.muscleGroup === 'string' ? input.muscleGroup.trim().toUpperCase() : '';
  const normalizedMuscleGroup: MuscleGroup =
    rawGroup === 'TRICEPS' || rawGroup === 'BICEPS'
      ? 'ARMS'
      : rawGroup === 'ABS'
        ? 'CORE'
        : (['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'CARDIO'].includes(rawGroup)
            ? (rawGroup as MuscleGroup)
            : 'CHEST');

  const created = await tx.exercise.create({
    data: {
      id: generateId('ex'),
      userId,
      name: (input.exerciseName || 'Custom Exercise').trim(),
      muscleGroup: normalizedMuscleGroup,
      equipment: input.equipment || 'Bodyweight',
      defaultSets: Math.max(1, Math.min(20, input.targetSets || 3)),
      defaultReps: input.targetReps || '8-12',
      defaultRestSeconds: Math.max(15, Math.min(600, input.restSeconds || 90)),
      defaultWeightKg: input.targetWeightKg ?? null,
      instructions: input.instructions || '',
      imageUrl: null,
      videoUrl: null,
      isDefault: false,
      createdAt: new Date(),
    },
  });
  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
  };
}

async function resolveAiProviderForUser(userId: string, modelId?: string): Promise<AiProvider> {
  if (modelId === 'BUILTIN') {
    return getAiProvider();
  }

  if (modelId) {
    const custom = await prisma.userAiModel.findFirst({
      where: { id: modelId, userId },
    });
    if (!custom) {
      throw new AppError('Selected custom AI model was not found.', 404);
    }
    const apiKey = decryptSecret(custom.encryptedApiKey);
    return createAiProviderFromConfig({
      provider: custom.provider as AiProviderName,
      model: custom.modelName,
      apiKey,
      baseUrl: custom.baseUrl,
    });
  }

  const userDefault = await prisma.userAiModel.findFirst({
    where: { userId, isDefault: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (userDefault) {
    const apiKey = decryptSecret(userDefault.encryptedApiKey);
    return createAiProviderFromConfig({
      provider: userDefault.provider as AiProviderName,
      model: userDefault.modelName,
      apiKey,
      baseUrl: userDefault.baseUrl,
    });
  }

  return getAiProvider();
}

export async function chatWithFitTrackAi(
  userId: string,
  prompt: string,
  options?: {
    abortSignal?: AbortSignal;
    idempotencyKey?: string;
    modelId?: string;
    onStage?: (event: AiStageEvent) => void;
  }
): Promise<ChatResponse> {
  assertDatabaseConfigured();

  const normalizedKey = options?.idempotencyKey?.trim();
  const compositeKey = normalizedKey ? `${userId}:${normalizedKey}` : null;

  if (compositeKey) {
    const nowMs = Date.now();
    pruneCompletedChatRequests(nowMs);
    const cached = completedChatRequests.get(compositeKey);
    if (cached && cached.expiresAt > nowMs) {
      return cached.data;
    }
    const inFlight = inFlightChatRequests.get(compositeKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const runChat = async (): Promise<ChatResponse> => {
    const profile = await prisma.fitnessProfile.findUnique({ where: { userId } });
    if (profile && !profile.geminiEnabled) {
      throw new AppError('FitTrack AI Assistant is disabled in Settings.', 403);
    }

  const aiProvider = await resolveAiProviderForUser(userId, options?.modelId);
  const providerLabel = getProviderDisplayName(aiProvider.name);

  options?.onStage?.({
    stage: 'analyzing_plans',
    label: 'Analyzing your existing plans...',
  });

  const [context, recentHistory] = await Promise.all([
    buildFitnessContext(userId),
    prisma.aiMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  if (options?.abortSignal?.aborted) {
    throw new AppError('Request was cancelled before contacting AI.', 499);
  }

  const history = [...recentHistory]
    .reverse()
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const unitInfo =
    context.preferences.measureUnit === 'INCHES'
      ? 'INCHES (in). 1 inch = 2.54 cm. Always display measurements in inches in your text, existingValue, and proposedValue, while providing canonical cm numbers in targetWaistCm / logMeasurement cm fields.'
      : 'CENTIMETERS (cm). Always display measurements in cm.';

  const systemInstruction = `You are FitTrack AI, a precise, data-grounded personal nutrition and strength coach embedded inside the user's FitTrack app.

STRICT GROUNDING & ACCURACY:
- Ground every answer strictly in the USER CONTEXT JSON (activeDietPlan, availableFoods, activeWorkoutSplit, availableExercises, recentMeasurements, recentWorkouts, profile, savedPlans).
- Currency: ${context.preferences.currency}. Weight unit: ${context.preferences.weightUnit}. Body measurement unit: ${unitInfo}
- Never invent logged meals, workouts, or measurements that are not in USER CONTEXT.

STRICT APPROVAL & PLAN MANAGEMENT POLICY:
1. For questions, feedback, suggestions, or discussions where the user did NOT explicitly ask to modify, update, add, remove, log, or generate a plan: set hasProposal = false and provide coaching advice only.
2. When the user explicitly asks to edit/modify their Diet Plan, Workout Split, Exercise settings, Targets/Goals, or Measurement logs/notes: set hasProposal = true with complete diff details (planName, planType, affectedTarget, proposalSummary, impactSummary, changes[]) and exact structured operations. Nothing is modified until the user confirms.
3. When the user asks to generate/create a NEW Diet Plan or NEW Workout Plan: set hasProposal = true and proposalType = "CREATE_NEW_PLAN" with the full newPlan object. This creates a SEPARATE Saved Plan without overwriting or replacing their existing active plan!
4. Only use "ACTIVATE_SAVED_PLAN" if the user explicitly asks to replace/activate an existing saved plan from savedPlans.
5. Reference real IDs from activeDietPlan, availableFoods, activeWorkoutSplit, availableExercises, and savedPlans whenever updating or removing existing items. For new foods or exercises not yet in the library, populate newFood / newExercise cleanly.`;

  options?.onStage?.({
    stage: 'calling_model',
    label: `Sending request to ${providerLabel} (${aiProvider.model})...`,
  });

  let generatingStageEmitted = false;
  const userPrompt = `USER CONTEXT:\n${JSON.stringify(context)}\n\nRECENT CONVERSATION:\n${history || 'None'}\n\nUSER MESSAGE:\n${prompt}`;
  const generation = await aiProvider.generateCoachingResponse({
    systemInstruction,
    userPrompt,
    abortSignal: options?.abortSignal,
    onRetry: (info) => {
      options?.onStage?.({
        stage: 'retrying',
        label: info.friendlyMessage,
      });
    },
    onFallbackModel: (info) => {
      options?.onStage?.({
        stage: 'fallback_model',
        label: `Primary model busy; switching to fallback (${info.toModel})...`,
      });
    },
    onFirstChunk: () => {
      if (!generatingStageEmitted) {
        generatingStageEmitted = true;
        options?.onStage?.({
          stage: 'generating',
          label: 'Generating recommendations...',
        });
      }
    },
  });

  if (!generatingStageEmitted) {
    generatingStageEmitted = true;
    options?.onStage?.({
      stage: 'generating',
      label: 'Generating recommendations...',
    });
  }

  const rawText = stripJsonCodeFences(generation.rawText);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    parsed = {
      reply: rawText || 'I could not generate a response. Please try again.',
      hasProposal: false,
    };
  }

  const replyText =
    typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : 'I analyzed your FitTrack data. Let me know what you would like to adjust.';

  const validTypes = new Set<AiProposalType>([
    'MODIFY_DIET_PLAN',
    'MODIFY_WORKOUT_PLAN',
    'CREATE_NEW_PLAN',
    'ACTIVATE_SAVED_PLAN',
    'UPDATE_TARGETS',
    'LOG_FOOD',
    'LOG_MEASUREMENT',
  ]);

  let proposal: AiProposal | null = null;
  const nowMs = Date.now();
  const nowDate = new Date(nowMs);
  const assistantDate = new Date(nowMs + 1);
  const expiresAtDate = new Date(nowMs + PROPOSAL_TTL_MS);
  const expiresAtIso = expiresAtDate.toISOString();

  if (
    parsed.hasProposal === true &&
    typeof parsed.proposalType === 'string' &&
    validTypes.has(parsed.proposalType as AiProposalType)
  ) {
    const pType = parsed.proposalType as AiProposalType;
    const rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];
    const changes: AiProposalChange[] = rawChanges
      .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
      .map((c) => ({
        action:
          c.action === 'ADD' || c.action === 'REMOVE' || c.action === 'UPDATE'
            ? c.action
            : 'UPDATE',
        target: String(c.target || 'Plan'),
        field: String(c.field || 'Value'),
        existingValue: String(c.existingValue ?? '—'),
        proposedValue: String(c.proposedValue ?? '—'),
      }));

    const params: Record<string, unknown> = {};
    let newPlanPreview: AiNewPlanPreview | null = null;

    if (pType === 'MODIFY_DIET_PLAN') {
      params.dietOperations = Array.isArray(parsed.dietOperations) ? parsed.dietOperations : [];
    } else if (pType === 'MODIFY_WORKOUT_PLAN') {
      params.workoutOperations = Array.isArray(parsed.workoutOperations)
        ? parsed.workoutOperations
        : [];
    } else if (pType === 'CREATE_NEW_PLAN' && parsed.newPlan && typeof parsed.newPlan === 'object') {
      const np = parsed.newPlan as Record<string, unknown>;
      newPlanPreview = {
        planType: np.planType === 'WORKOUT' ? 'WORKOUT' : 'DIET',
        name: String(np.name || 'FitTrack AI Custom Plan'),
        description: String(np.description || ''),
        ...(Array.isArray(np.meals) ? { meals: np.meals as AiNewPlanPreview['meals'] } : {}),
        ...(Array.isArray(np.split) ? { split: np.split as AiNewPlanPreview['split'] } : {}),
      };
      params.newPlan = newPlanPreview;
    } else if (pType === 'ACTIVATE_SAVED_PLAN') {
      params.activatePlanId = String(parsed.activatePlanId || '');
    } else if (pType === 'UPDATE_TARGETS') {
      params.targets = (parsed.targets as Record<string, unknown>) || {};
    } else if (pType === 'LOG_FOOD') {
      const lf = (parsed.logFood as Record<string, unknown>) || {};
      params.logFood = {
        ...lf,
        date: context.today.isoDate,
      };
    } else if (pType === 'LOG_MEASUREMENT') {
      const lm = (parsed.logMeasurement as Record<string, unknown>) || {};
      params.logMeasurement = {
        ...lm,
        date: typeof lm.date === 'string' && lm.date ? lm.date : context.today.isoDate,
      };
    }

    const planTypeLabel =
      pType === 'MODIFY_DIET_PLAN' || (pType === 'CREATE_NEW_PLAN' && newPlanPreview?.planType === 'DIET')
        ? 'DIET'
        : pType === 'MODIFY_WORKOUT_PLAN' ||
            (pType === 'CREATE_NEW_PLAN' && newPlanPreview?.planType === 'WORKOUT')
          ? 'WORKOUT'
          : pType === 'UPDATE_TARGETS'
            ? 'TARGETS'
            : pType === 'LOG_MEASUREMENT'
              ? 'MEASUREMENT'
              : 'LOG';

    const hasActionablePayload =
      (pType === 'MODIFY_DIET_PLAN' && Array.isArray(params.dietOperations) && params.dietOperations.length > 0) ||
      (pType === 'MODIFY_WORKOUT_PLAN' &&
        Array.isArray(params.workoutOperations) &&
        params.workoutOperations.length > 0) ||
      (pType === 'CREATE_NEW_PLAN' && Boolean(newPlanPreview)) ||
      (pType === 'ACTIVATE_SAVED_PLAN' && Boolean(params.activatePlanId)) ||
      (pType === 'UPDATE_TARGETS' && Object.keys((params.targets as Record<string, unknown>) || {}).length > 0) ||
      (pType === 'LOG_FOOD' && Boolean(params.logFood)) ||
      (pType === 'LOG_MEASUREMENT' && Boolean(params.logMeasurement));

    if (hasActionablePayload) {
      proposal = {
        id: generateId('prop'),
        type: pType,
        status: 'PENDING',
        planName: String(
          parsed.planName ||
            newPlanPreview?.name ||
            (planTypeLabel === 'DIET'
              ? 'Active Diet Plan'
              : planTypeLabel === 'WORKOUT'
                ? 'Active Workout Split'
                : 'FitTrack Settings')
        ),
        planType: planTypeLabel,
        affectedTarget: String(parsed.affectedTarget || 'Schedule'),
        summary: String(parsed.proposalSummary || 'Proposed update to your FitTrack data.'),
        impactSummary: String(
          parsed.impactSummary ||
            (pType === 'CREATE_NEW_PLAN'
              ? 'Saves as a new separate template without altering your active schedule.'
              : 'Applies the previewed changes once you confirm.')
        ),
        changes,
        params,
        newPlanPreview,
        expiresAt: expiresAtIso,
        applied: false,
        resolvedAt: null,
      };
    }
  }

  const userMsgId = generateId('msg');
  const assistantMsgId = generateId('msg');

  if (proposal) {
    options?.onStage?.({
      stage: 'preparing_updates',
      label: 'Preparing database updates...',
    });
  }

  options?.onStage?.({
    stage: 'saving',
    label: 'Saving changes...',
  });

  return withTransaction(async (tx) => {
    const userRow = await tx.aiMessage.create({
      data: {
        id: userMsgId,
        userId,
        role: 'user',
        content: prompt,
        proposal: Prisma.JsonNull,
        createdAt: nowDate,
      },
    });

    const assistantRow = await tx.aiMessage.create({
      data: {
        id: assistantMsgId,
        userId,
        role: 'assistant',
        content: replyText,
        proposal: proposal ? (proposal as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        createdAt: assistantDate,
      },
    });

    if (proposal) {
      await tx.aiPendingProposal.create({
        data: {
          id: proposal.id,
          userId,
          messageId: assistantMsgId,
          status: 'PENDING',
          proposal: proposal as unknown as Prisma.InputJsonValue,
          expiresAt: expiresAtDate,
          createdAt: nowDate,
          resolvedAt: null,
        },
      });

      await tx.aiAuditLog.create({
        data: {
          id: generateId('audit'),
          userId,
          proposalId: proposal.id,
          type: proposal.type,
          action: 'PROPOSED',
          editedByUser: false,
          summary: proposal.summary,
          details: {
            planName: proposal.planName,
            planType: proposal.planType,
            affectedTarget: proposal.affectedTarget,
            changesCount: proposal.changes.length,
          } as Prisma.InputJsonValue,
          createdAt: nowDate,
        },
      });
    }

      return {
        userMessage: toApiAiMessage(userRow),
        assistantMessage: toApiAiMessage(assistantRow),
      };
    });
  };

  if (!compositeKey) {
    return runChat();
  }

  const execution = runChat().then((data) => {
    pruneCompletedChatRequests(Date.now());
    completedChatRequests.set(compositeKey, {
      data,
      expiresAt: Date.now() + CHAT_IDEMPOTENCY_TTL_MS,
    });
    return data;
  });

  inFlightChatRequests.set(compositeKey, execution);
  try {
    return await execution;
  } finally {
    inFlightChatRequests.delete(compositeKey);
  }
}

const proposalEditsSchema = z
  .object({
    planName: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).optional(),
    targets: z
      .object({
        dailyCalorieTarget: z.coerce.number().int().positive().max(12000).optional(),
        dailyProteinTargetG: z.coerce.number().int().positive().max(1000).optional(),
        dailyCarbTargetG: z.coerce.number().int().positive().max(1500).optional(),
        dailyFatTargetG: z.coerce.number().int().positive().max(600).optional(),
        targetWeightKg: z.coerce.number().positive().max(400).optional(),
        targetWaistCm: z.coerce.number().positive().max(300).optional(),
        targetBodyFatPct: z.coerce.number().positive().max(80).optional(),
      })
      .optional(),
    dietOperations: z.array(z.record(z.string(), z.unknown())).optional(),
    workoutOperations: z.array(z.record(z.string(), z.unknown())).optional(),
    newPlan: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

export async function confirmAiProposal(
  userId: string,
  proposalOrMessageId: string,
  rawEdits?: unknown,
  options?: {
    idempotencyKey?: string;
    onStage?: (event: AiStageEvent) => void;
  }
) {
  options?.onStage?.({
    stage: 'preparing_updates',
    label: 'Preparing database updates...',
  });
  const edits = proposalEditsSchema.parse(rawEdits);
  const normalizedIdempotencyKey = options?.idempotencyKey?.trim() || undefined;
  const editedByUser = Boolean(
    edits &&
      (edits.planName ||
        edits.description ||
        edits.targets ||
        edits.dietOperations ||
        edits.workoutOperations ||
        edits.newPlan)
  );

  const txResult = await withTransaction(async (tx) => {
    options?.onStage?.({
      stage: 'saving',
      label: 'Saving changes...',
    });

    // Lock the proposal row inside this PostgreSQL transaction so concurrent confirm
    // requests serialize cleanly and cannot apply duplicate diet or workout mutations.
    await tx.$queryRaw`
      SELECT "id" FROM "ai_pending_proposals"
      WHERE "id" = ${proposalOrMessageId} OR "messageId" = ${proposalOrMessageId}
      FOR UPDATE
    `;

    const pending = await tx.aiPendingProposal.findFirst({
      where: {
        OR: [{ id: proposalOrMessageId }, { messageId: proposalOrMessageId }],
      },
    });

    if (!pending) {
      const legacyMsg = await tx.aiMessage.findUnique({ where: { id: proposalOrMessageId } });
      if (legacyMsg && legacyMsg.userId !== userId) {
        throw new AppError('You do not have permission to access this proposal.', 403);
      }
      throw new AppError('Action proposal not found.', 404);
    }

    if (pending.userId !== userId) {
      throw new AppError('You do not have permission to execute another user’s proposal.', 403);
    }

    if (pending.status !== 'PENDING') {
      if (pending.status === 'APPROVED') {
        const storedProposal = pending.proposal as unknown as AiProposal;
        if (
          normalizedIdempotencyKey &&
          storedProposal?.idempotencyKey === normalizedIdempotencyKey
        ) {
          return {
            expired: false as const,
            result: {
              applied: true,
              status: 'APPROVED',
              proposalId: pending.id,
              proposal: storedProposal,
              deduplicated: true,
            },
          };
        }
      }
      throw new AppError(`This proposal has already been ${pending.status.toLowerCase()}.`, 400);
    }

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const baseProposal = structuredClone(pending.proposal as unknown as AiProposal);

    if (pending.expiresAt.getTime() <= Date.now()) {
      baseProposal.status = 'EXPIRED';
      baseProposal.resolvedAt = nowIso;

      await tx.aiPendingProposal.update({
        where: { id: pending.id },
        data: {
          status: 'EXPIRED',
          resolvedAt: nowDate,
          proposal: baseProposal as unknown as Prisma.InputJsonValue,
        },
      });

      const msg = await tx.aiMessage.findFirst({
        where: { id: pending.messageId, userId },
      });
      if (msg) {
        await tx.aiMessage.update({
          where: { id: msg.id },
          data: { proposal: baseProposal as unknown as Prisma.InputJsonValue },
        });
      }

      await tx.aiAuditLog.create({
        data: {
          id: generateId('audit'),
          userId,
          proposalId: pending.id,
          type: baseProposal.type,
          action: 'EXPIRED',
          editedByUser: false,
          summary: baseProposal.summary,
          details: {},
          createdAt: nowDate,
        },
      });

      return { expired: true as const };
    }

    const proposal = baseProposal;
    if (edits?.planName) {
      proposal.planName = edits.planName;
      if (proposal.newPlanPreview) proposal.newPlanPreview.name = edits.planName;
    }
    if (edits?.description && proposal.newPlanPreview) {
      proposal.newPlanPreview.description = edits.description;
    }

    if (proposal.type === 'UPDATE_TARGETS') {
      const baseTargets = (proposal.params.targets as Record<string, unknown>) || {};
      const merged: Record<string, unknown> = { ...baseTargets, ...(edits?.targets || {}) };
      const profile = await tx.fitnessProfile.findUnique({ where: { userId } });
      if (!profile) throw new AppError('Fitness profile not found.', 404);

      const updateData: Prisma.FitnessProfileUpdateInput = { updatedAt: nowDate };
      if (typeof merged.fitnessGoal === 'string')
        updateData.fitnessGoal = merged.fitnessGoal as Prisma.EnumFitnessGoalFieldUpdateOperationsInput['set'];
      if (typeof merged.activityLevel === 'string')
        updateData.activityLevel = merged.activityLevel as Prisma.EnumActivityLevelFieldUpdateOperationsInput['set'];
      if (typeof merged.dailyCalorieTarget === 'number')
        updateData.dailyCalorieTarget = Math.round(merged.dailyCalorieTarget);
      if (typeof merged.dailyProteinTargetG === 'number')
        updateData.dailyProteinTargetG = Math.round(merged.dailyProteinTargetG);
      if (typeof merged.dailyCarbTargetG === 'number')
        updateData.dailyCarbTargetG = Math.round(merged.dailyCarbTargetG);
      if (typeof merged.dailyFatTargetG === 'number')
        updateData.dailyFatTargetG = Math.round(merged.dailyFatTargetG);
      if (typeof merged.targetWeightKg === 'number')
        updateData.targetWeightKg = Number(merged.targetWeightKg);
      if (typeof merged.targetWaistCm === 'number')
        updateData.targetWaistCm = Number(merged.targetWaistCm);
      if (typeof merged.targetBodyFatPct === 'number')
        updateData.targetBodyFatPct = Number(merged.targetBodyFatPct);

      await tx.fitnessProfile.update({
        where: { userId },
        data: updateData,
      });
    } else if (proposal.type === 'LOG_MEASUREMENT') {
      const lm = (proposal.params.logMeasurement as Record<string, unknown>) || {};
      const prof = await tx.fitnessProfile.findUnique({ where: { userId } });
      const date =
        typeof lm.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lm.date)
          ? lm.date
          : getLocalDateInfo(prof?.timezone || 'Asia/Kolkata').isoDate;
      const weightKg = typeof lm.weightKg === 'number' ? lm.weightKg : null;

      await tx.bodyMeasurement.create({
        data: {
          id: generateId('meas'),
          userId,
          date,
          weightKg,
          bodyFatPct: typeof lm.bodyFatPct === 'number' ? lm.bodyFatPct : null,
          waistCm: typeof lm.waistCm === 'number' ? lm.waistCm : null,
          chestCm: typeof lm.chestCm === 'number' ? lm.chestCm : null,
          hipsCm: typeof lm.hipsCm === 'number' ? lm.hipsCm : null,
          armsCm: typeof lm.armsCm === 'number' ? lm.armsCm : null,
          thighsCm: typeof lm.thighsCm === 'number' ? lm.thighsCm : null,
          neckCm: typeof lm.neckCm === 'number' ? lm.neckCm : null,
          calvesCm: typeof lm.calvesCm === 'number' ? lm.calvesCm : null,
          customMeasurements: [],
          photoDataUrl: null,
          notes: typeof lm.notes === 'string' && lm.notes ? lm.notes : 'Logged via FitTrack AI',
          createdAt: nowDate,
        },
      });
      if (weightKg !== null && prof) {
        await tx.fitnessProfile.update({
          where: { userId },
          data: {
            currentWeightKg: weightKg,
            ...(prof.startingWeightKg === null ? { startingWeightKg: weightKg } : {}),
            updatedAt: nowDate,
          },
        });
      }
    } else if (proposal.type === 'LOG_FOOD') {
      const lf = (proposal.params.logFood as Record<string, unknown>) || {};
      const food = await resolveOrCreateFoodTx(tx, userId, {
        foodId: typeof lf.foodId === 'string' ? lf.foodId : undefined,
        foodName: typeof lf.foodName === 'string' ? lf.foodName : undefined,
      });
      const servings = Number(lf.servings || 1);
      const mealName = String(lf.mealName || 'Snack');
      const prof = await tx.fitnessProfile.findUnique({
        where: { userId },
        select: { timezone: true },
      });
      const date = String(lf.date || getLocalDateInfo(prof?.timezone || 'Asia/Kolkata').isoDate);
      const metrics = buildFoodDerivedMetrics(food, servings);

      await tx.mealLog.create({
        data: {
          id: generateId('mlog'),
          userId,
          date,
          mealName,
          time: new Date().toTimeString().slice(0, 5),
          foodId: food.id,
          foodName: food.name,
          servings: metrics.servings,
          servingLabel: metrics.servingLabel,
          calories: metrics.calories,
          proteinG: metrics.proteinG,
          carbsG: metrics.carbsG,
          fatG: metrics.fatG,
          priceInr: metrics.priceInr,
          plannedMealId: null,
          createdAt: nowDate,
        },
      });
    } else if (proposal.type === 'MODIFY_DIET_PLAN') {
      const ops = (edits?.dietOperations ||
        (proposal.params.dietOperations as Array<Record<string, unknown>>) ||
        []) as Array<Record<string, unknown>>;

      for (const opObj of ops) {
        const op = String(opObj.op || '');
        const mealId = typeof opObj.mealId === 'string' ? opObj.mealId : undefined;
        const mealName = typeof opObj.mealName === 'string' ? opObj.mealName : undefined;

        const findMeal = async () => {
          if (mealId) {
            const byId = await tx.plannedMeal.findFirst({
              where: { id: mealId, userId },
              include: { items: { orderBy: { sortOrder: 'asc' } } },
            });
            if (byId) return byId;
          }
          if (mealName) {
            const allMeals = await tx.plannedMeal.findMany({
              where: { userId },
              include: { items: { orderBy: { sortOrder: 'asc' } } },
            });
            return allMeals.find(
              (m) => m.name.trim().toLowerCase() === mealName.trim().toLowerCase()
            );
          }
          return undefined;
        };

        if (op === 'ADD_MEAL') {
          const itemsData: Array<{
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
          if (opObj.foodId || opObj.newFood) {
            const food = await resolveOrCreateFoodTx(tx, userId, {
              foodId: typeof opObj.foodId === 'string' ? opObj.foodId : undefined,
              newFood: opObj.newFood as Record<string, unknown> as never,
            });
            itemsData.push({
              id: generateId('pmi'),
              sortOrder: 0,
              ...buildFoodDerivedMetrics(food, Number(opObj.servings || 1)),
            });
          }
          await tx.plannedMeal.create({
            data: {
              id: generateId('meal'),
              userId,
              name: mealName || 'New Meal',
              time:
                typeof opObj.time === 'string' && /^\d{2}:\d{2}$/.test(opObj.time)
                  ? opObj.time
                  : '13:00',
              items: { create: itemsData },
            },
          });
        } else if (op === 'UPDATE_MEAL') {
          const meal = await findMeal();
          if (meal) {
            const data: { name?: string; time?: string } = {};
            if (mealId && typeof opObj.mealName === 'string' && opObj.mealName.trim()) {
              data.name = opObj.mealName.trim();
            }
            if (typeof opObj.time === 'string' && /^\d{2}:\d{2}$/.test(opObj.time)) {
              data.time = opObj.time;
            }
            if (Object.keys(data).length > 0) {
              await tx.plannedMeal.update({ where: { id: meal.id }, data });
            }
          }
        } else if (op === 'REMOVE_MEAL') {
          const targetMeal = await findMeal();
          if (targetMeal) {
            await tx.plannedMeal.delete({ where: { id: targetMeal.id } });
          }
        } else if (op === 'ADD_FOOD_ITEM') {
          let meal = await findMeal();
          if (!meal) {
            meal = await tx.plannedMeal.create({
              data: {
                id: generateId('meal'),
                userId,
                name: mealName || 'Planned Meal',
                time:
                  typeof opObj.time === 'string' && /^\d{2}:\d{2}$/.test(opObj.time)
                    ? opObj.time
                    : '12:30',
              },
              include: { items: true },
            });
          }
          const food = await resolveOrCreateFoodTx(tx, userId, {
            foodId: typeof opObj.foodId === 'string' ? opObj.foodId : undefined,
            newFood: opObj.newFood as Record<string, unknown> as never,
          });
          const maxSort = meal.items.reduce((max, it) => Math.max(max, it.sortOrder), -1);
          await tx.plannedMealItem.create({
            data: {
              id: generateId('pmi'),
              mealId: meal.id,
              sortOrder: maxSort + 1,
              ...buildFoodDerivedMetrics(food, Math.max(0.25, Number(opObj.servings || 1))),
            },
          });
        } else if (op === 'UPDATE_FOOD_ITEM') {
          const meal = await findMeal();
          if (meal) {
            const item = meal.items.find(
              (it) =>
                (typeof opObj.itemId === 'string' && it.id === opObj.itemId) ||
                (typeof opObj.foodId === 'string' && it.foodId === opObj.foodId)
            );
            if (item) {
              const newServings = Math.max(0.25, Number(opObj.servings || item.servings));
              const foodRow = await tx.foodItem.findFirst({
                where: { id: item.foodId, userId },
              });
              if (foodRow) {
                const metrics = buildFoodDerivedMetrics(toApiFood(foodRow), newServings);
                await tx.plannedMealItem.update({
                  where: { id: item.id },
                  data: metrics,
                });
              } else {
                const ratio = newServings / item.servings;
                await tx.plannedMealItem.update({
                  where: { id: item.id },
                  data: {
                    servings: newServings,
                    calories: Math.round(item.calories * ratio),
                    proteinG: Math.round(item.proteinG * ratio * 10) / 10,
                    carbsG: Math.round(item.carbsG * ratio * 10) / 10,
                    fatG: Math.round(item.fatG * ratio * 10) / 10,
                    priceInr: Math.round(item.priceInr * ratio * 10) / 10,
                  },
                });
              }
            }
          }
        } else if (op === 'REMOVE_FOOD_ITEM') {
          const meal = await findMeal();
          if (meal) {
            const toRemove = meal.items
              .filter(
                (it) =>
                  (typeof opObj.itemId === 'string' && it.id === opObj.itemId) ||
                  (typeof opObj.foodId === 'string' && it.foodId === opObj.foodId)
              )
              .map((it) => it.id);
            if (toRemove.length > 0) {
              await tx.plannedMealItem.deleteMany({
                where: { id: { in: toRemove }, mealId: meal.id },
              });
            }
          }
        }
      }
    } else if (proposal.type === 'MODIFY_WORKOUT_PLAN') {
      const existingDays = await tx.workoutDaySplit.findMany({
        where: { userId },
        select: { day: true },
      });
      const existingSet = new Set(existingDays.map((d) => d.day));
      const missingDays = buildEmptyWeeklySplit().filter((d) => !existingSet.has(d.day));
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

      const ops = (edits?.workoutOperations ||
        (proposal.params.workoutOperations as Array<Record<string, unknown>>) ||
        []) as Array<Record<string, unknown>>;

      for (const opObj of ops) {
        const op = String(opObj.op || '');
        const dayKey =
          typeof opObj.day === 'string' ? (opObj.day.toUpperCase() as DayOfWeek) : undefined;
        const daySplit =
          dayKey && DAY_ORDER.includes(dayKey)
            ? await tx.workoutDaySplit.findUnique({
                where: { userId_day: { userId, day: dayKey } },
                include: { exercises: { orderBy: { sortOrder: 'asc' } } },
              })
            : null;

        if (op === 'UPDATE_DAY' && daySplit) {
          await tx.workoutDaySplit.update({
            where: { id: daySplit.id },
            data: {
              ...(typeof opObj.focus === 'string' && opObj.focus.trim()
                ? { focus: opObj.focus.trim() }
                : {}),
              ...(typeof opObj.isRestDay === 'boolean' ? { isRestDay: opObj.isRestDay } : {}),
            },
          });
        } else if (op === 'ADD_EXERCISE' && daySplit) {
          const newEx = (opObj.newExercise as Record<string, unknown>) || {};
          const ex = await resolveOrCreateExerciseTx(tx, userId, {
            exerciseId: typeof opObj.exerciseId === 'string' ? opObj.exerciseId : undefined,
            exerciseName: typeof newEx.name === 'string' ? newEx.name : undefined,
            muscleGroup: (newEx.muscleGroup as MuscleGroup) || undefined,
            equipment: typeof newEx.equipment === 'string' ? newEx.equipment : undefined,
            targetSets: typeof opObj.targetSets === 'number' ? opObj.targetSets : undefined,
            targetReps: typeof opObj.targetReps === 'string' ? opObj.targetReps : undefined,
            restSeconds: typeof opObj.restSeconds === 'number' ? opObj.restSeconds : undefined,
            targetWeightKg:
              typeof opObj.targetWeightKg === 'number' ? opObj.targetWeightKg : undefined,
            instructions: typeof opObj.instructions === 'string' ? opObj.instructions : undefined,
          });
          await tx.workoutDaySplit.update({
            where: { id: daySplit.id },
            data: { isRestDay: false },
          });
          const maxSort = daySplit.exercises.reduce((m, it) => Math.max(m, it.sortOrder), -1);
          await tx.splitExercise.create({
            data: {
              id: generateId('spex'),
              daySplitId: daySplit.id,
              sortOrder: maxSort + 1,
              exerciseId: ex.id,
              exerciseName: ex.name,
              muscleGroup: ex.muscleGroup,
              targetSets: Math.max(1, Number(opObj.targetSets || ex.defaultSets || 3)),
              targetReps: String(opObj.targetReps || ex.defaultReps || '8-12'),
              restSeconds: Math.max(15, Number(opObj.restSeconds || ex.defaultRestSeconds || 90)),
              targetWeightKg:
                typeof opObj.targetWeightKg === 'number'
                  ? opObj.targetWeightKg
                  : ex.defaultWeightKg ?? null,
              instructions: ex.instructions,
              imageUrl: ex.imageUrl ?? null,
              videoUrl: ex.videoUrl ?? null,
            },
          });
        } else if (op === 'UPDATE_EXERCISE' && daySplit) {
          const targetSpex = daySplit.exercises.find(
            (e) =>
              (typeof opObj.splitExerciseId === 'string' && e.id === opObj.splitExerciseId) ||
              (typeof opObj.exerciseId === 'string' && e.exerciseId === opObj.exerciseId)
          );
          if (targetSpex) {
            await tx.splitExercise.update({
              where: { id: targetSpex.id },
              data: {
                ...(typeof opObj.targetSets === 'number'
                  ? { targetSets: Math.max(1, Math.round(opObj.targetSets)) }
                  : {}),
                ...(typeof opObj.targetReps === 'string' && opObj.targetReps.trim()
                  ? { targetReps: opObj.targetReps.trim() }
                  : {}),
                ...(typeof opObj.restSeconds === 'number'
                  ? { restSeconds: Math.max(15, Math.round(opObj.restSeconds)) }
                  : {}),
                ...(typeof opObj.targetWeightKg === 'number'
                  ? { targetWeightKg: Math.max(0, Number(opObj.targetWeightKg)) }
                  : {}),
                ...(typeof opObj.instructions === 'string'
                  ? { instructions: opObj.instructions }
                  : {}),
              },
            });
            if (typeof opObj.instructions === 'string') {
              await tx.exercise.updateMany({
                where: { id: targetSpex.exerciseId, userId },
                data: { instructions: opObj.instructions },
              });
            }
          }
        } else if (op === 'REMOVE_EXERCISE' && daySplit) {
          const toDelete = daySplit.exercises
            .filter(
              (e) =>
                (typeof opObj.splitExerciseId === 'string' && e.id === opObj.splitExerciseId) ||
                (typeof opObj.exerciseId === 'string' && e.exerciseId === opObj.exerciseId)
            )
            .map((e) => e.id);
          if (toDelete.length > 0) {
            await tx.splitExercise.deleteMany({
              where: { id: { in: toDelete }, daySplitId: daySplit.id },
            });
          }
        } else if (
          op === 'REORDER_EXERCISES' &&
          daySplit &&
          Array.isArray(opObj.orderedSplitExerciseIds)
        ) {
          const order = opObj.orderedSplitExerciseIds.map(String);
          const byId = new Map(daySplit.exercises.map((e) => [e.id, e]));
          const orderedIds: string[] = [];
          for (const id of order) {
            if (byId.has(id)) {
              orderedIds.push(id);
              byId.delete(id);
            }
          }
          for (const rem of byId.values()) orderedIds.push(rem.id);
          await Promise.all(
            orderedIds.map((id, idx) =>
              tx.splitExercise.update({ where: { id }, data: { sortOrder: idx } })
            )
          );
        } else if (op === 'UPDATE_EXERCISE_LIBRARY' && typeof opObj.exerciseId === 'string') {
          await tx.exercise.updateMany({
            where: { id: opObj.exerciseId, userId },
            data: {
              ...(typeof opObj.targetSets === 'number' ? { defaultSets: opObj.targetSets } : {}),
              ...(typeof opObj.targetReps === 'string' ? { defaultReps: opObj.targetReps } : {}),
              ...(typeof opObj.restSeconds === 'number'
                ? { defaultRestSeconds: opObj.restSeconds }
                : {}),
              ...(typeof opObj.targetWeightKg === 'number'
                ? { defaultWeightKg: opObj.targetWeightKg }
                : {}),
              ...(typeof opObj.instructions === 'string' ? { instructions: opObj.instructions } : {}),
            },
          });
        }
      }
    } else if (proposal.type === 'CREATE_NEW_PLAN') {
      const preview = (edits?.newPlan
        ? { ...(proposal.newPlanPreview || {}), ...edits.newPlan }
        : proposal.newPlanPreview || (proposal.params.newPlan as AiNewPlanPreview)) as AiNewPlanPreview;
      if (!preview) throw new AppError('Plan preview payload is missing.', 400);

      let payload: unknown;
      if (preview.planType === 'DIET') {
        const meals: PlannedMeal[] = [];
        for (const m of preview.meals || []) {
          const items: PlannedMealItem[] = [];
          for (const it of m.items || []) {
            const food = await resolveOrCreateFoodTx(tx, userId, {
              foodId: it.foodId,
              foodName: it.foodName,
              newFood: {
                name: it.foodName,
                category: it.category || 'VEG',
                servingLabel: it.servingLabel || '1 serving',
                servingGrams: 100,
                calories: it.calories ?? 150,
                proteinG: it.proteinG ?? 10,
                carbsG: it.carbsG ?? 15,
                fatG: it.fatG ?? 5,
                priceInr: it.priceInr ?? 25,
              },
            });
            items.push({
              id: generateId('pmi'),
              ...buildFoodDerivedMetrics(food, Math.max(0.25, Number(it.servings || 1))),
            });
          }
          meals.push({
            id: generateId('meal'),
            userId,
            name: m.name,
            time: /^\d{2}:\d{2}$/.test(m.time) ? m.time : '12:00',
            items,
          });
        }
        payload = meals;
      } else {
        const baseDays = buildEmptyWeeklySplit();
        const incomingByDay = new Map((preview.split || []).map((d) => [d.day, d]));
        const split: WorkoutDaySplit[] = [];
        for (const baseDay of baseDays) {
          const inc = incomingByDay.get(baseDay.day);
          if (!inc) {
            split.push(baseDay);
            continue;
          }
          const exercises = [];
          for (const exItem of inc.exercises || []) {
            const ex = await resolveOrCreateExerciseTx(tx, userId, {
              exerciseId: exItem.exerciseId,
              exerciseName: exItem.exerciseName,
              muscleGroup: exItem.muscleGroup,
              equipment: exItem.equipment,
              targetSets: exItem.targetSets,
              targetReps: exItem.targetReps,
              restSeconds: exItem.restSeconds,
              targetWeightKg: exItem.targetWeightKg ?? null,
              instructions: exItem.instructions,
            });
            exercises.push({
              id: generateId('spex'),
              exerciseId: ex.id,
              exerciseName: ex.name,
              muscleGroup: ex.muscleGroup,
              targetSets: Math.max(1, exItem.targetSets || 3),
              targetReps: exItem.targetReps || '8-12',
              restSeconds: Math.max(15, exItem.restSeconds || 90),
              targetWeightKg: exItem.targetWeightKg ?? ex.defaultWeightKg ?? null,
              instructions: ex.instructions,
              imageUrl: ex.imageUrl ?? null,
              videoUrl: ex.videoUrl ?? null,
            });
          }
          split.push({
            day: baseDay.day,
            focus: inc.focus || baseDay.focus,
            isRestDay: Boolean(inc.isRestDay),
            exercises,
          });
        }
        payload = split;
      }

      await tx.savedPlan.create({
        data: {
          id: generateId('plan'),
          userId,
          type: preview.planType,
          name: edits?.planName || preview.name,
          description: edits?.description ?? preview.description ?? '',
          payload: payload as Prisma.InputJsonValue,
          createdAt: nowDate,
        },
      });
    } else if (proposal.type === 'ACTIVATE_SAVED_PLAN') {
      const planId = String(proposal.params.activatePlanId || '');
      const plan = await tx.savedPlan.findFirst({ where: { id: planId, userId } });
      if (!plan) throw new AppError('Referenced saved plan no longer exists.', 404);

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
    }

    const updatedProposal: AiProposal = {
      ...proposal,
      status: 'APPROVED',
      applied: true,
      resolvedAt: nowIso,
      ...(normalizedIdempotencyKey ? { idempotencyKey: normalizedIdempotencyKey } : {}),
    };

    await tx.aiPendingProposal.update({
      where: { id: pending.id },
      data: {
        status: 'APPROVED',
        resolvedAt: nowDate,
        proposal: updatedProposal as unknown as Prisma.InputJsonValue,
      },
    });

    const msg = await tx.aiMessage.findFirst({
      where: { id: pending.messageId, userId },
    });
    if (msg) {
      await tx.aiMessage.update({
        where: { id: msg.id },
        data: { proposal: updatedProposal as unknown as Prisma.InputJsonValue },
      });
    }

    await tx.aiAuditLog.create({
      data: {
        id: generateId('audit'),
        userId,
        proposalId: pending.id,
        type: updatedProposal.type,
        action: 'APPROVED',
        editedByUser,
        summary: updatedProposal.summary,
        details: {
          planName: updatedProposal.planName,
          planType: updatedProposal.planType,
          editedByUser,
        } as Prisma.InputJsonValue,
        createdAt: nowDate,
      },
    });

    return {
      expired: false as const,
      result: {
        applied: true,
        status: 'APPROVED',
        proposalId: pending.id,
        proposal: updatedProposal,
      },
    };
  });

  if (txResult.expired) {
    throw new AppError('This proposal has expired. Ask FitTrack AI to generate a fresh one.', 400);
  }
  return txResult.result;
}

export async function cancelAiProposal(userId: string, proposalOrMessageId: string) {
  return withTransaction(async (tx) => {
    const pending = await tx.aiPendingProposal.findFirst({
      where: {
        OR: [{ id: proposalOrMessageId }, { messageId: proposalOrMessageId }],
      },
    });
    if (!pending) {
      throw new AppError('Action proposal not found.', 404);
    }
    if (pending.userId !== userId) {
      throw new AppError('You do not have permission to cancel another user’s proposal.', 403);
    }
    if (pending.status !== 'PENDING') {
      throw new AppError(`This proposal is already ${pending.status.toLowerCase()}.`, 400);
    }

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const updatedProposal = structuredClone(pending.proposal as unknown as AiProposal);
    updatedProposal.status = 'CANCELLED';
    updatedProposal.resolvedAt = nowIso;

    await tx.aiPendingProposal.update({
      where: { id: pending.id },
      data: {
        status: 'CANCELLED',
        resolvedAt: nowDate,
        proposal: updatedProposal as unknown as Prisma.InputJsonValue,
      },
    });

    const msg = await tx.aiMessage.findFirst({
      where: { id: pending.messageId, userId },
    });
    if (msg) {
      await tx.aiMessage.update({
        where: { id: msg.id },
        data: { proposal: updatedProposal as unknown as Prisma.InputJsonValue },
      });
    }

    await tx.aiAuditLog.create({
      data: {
        id: generateId('audit'),
        userId,
        proposalId: pending.id,
        type: updatedProposal.type,
        action: 'CANCELLED',
        editedByUser: false,
        summary: updatedProposal.summary,
        details: {
          planName: updatedProposal.planName,
          planType: updatedProposal.planType,
        } as Prisma.InputJsonValue,
        createdAt: nowDate,
      },
    });

    return {
      cancelled: true,
      status: 'CANCELLED',
      proposalId: pending.id,
      proposal: updatedProposal,
    };
  });
}
