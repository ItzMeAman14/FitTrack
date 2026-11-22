export type Gender = 'MALE' | 'FEMALE' | 'OTHER';
export type FitnessGoal = 'FAT_LOSS' | 'MUSCLE_GAIN' | 'MAINTENANCE' | 'RECOMPOSITION';
export type ActivityLevel =
  | 'SEDENTARY'
  | 'LIGHTLY_ACTIVE'
  | 'MODERATELY_ACTIVE'
  | 'VERY_ACTIVE'
  | 'EXTREMELY_ACTIVE';
export type WeightUnit = 'KG' | 'LBS';
export type MeasurementUnit = 'CM' | 'INCHES';
export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export type DietTag = 'VEG' | 'NON_VEG' | 'VEGAN' | 'SUPPLEMENT';
export type MuscleGroup = 'CHEST' | 'BACK' | 'LEGS' | 'SHOULDERS' | 'ARMS' | 'CORE' | 'CARDIO';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface FitnessProfile {
  id: string;
  userId: string;
  age: number | null;
  gender: Gender | null;
  heightCm: number | null;
  startingWeightKg: number | null;
  currentWeightKg: number | null;
  targetWeightKg: number | null;
  targetWaistCm?: number | null;
  targetBodyFatPct?: number | null;
  fitnessGoal: FitnessGoal;
  activityLevel: ActivityLevel;
  dailyCalorieTarget: number | null;
  dailyProteinTargetG: number | null;
  dailyCarbTargetG: number | null;
  dailyFatTargetG: number | null;
  preferredWeightUnit: WeightUnit;
  preferredMeasureUnit: MeasurementUnit;
  currency: string;
  timezone: string;
  theme: 'dark';
  geminiEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FoodItem {
  id: string;
  userId: string;
  name: string;
  category: DietTag;
  servingLabel: string;
  servingGrams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  priceInr: number;
  isDefault: boolean;
  createdAt: string;
}

export interface PlannedMealItem {
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
}

export interface PlannedMeal {
  id: string;
  userId: string;
  name: string;
  time: string; // HH:mm 24h e.g. "08:30"
  items: PlannedMealItem[];
}

export interface MealLog {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
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
  createdAt: string;
}

export interface Exercise {
  id: string;
  userId: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: string;
  defaultSets: number;
  defaultReps: string;
  defaultRestSeconds?: number;
  defaultWeightKg?: number | null;
  instructions: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface SplitExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  targetSets: number;
  targetReps: string;
  restSeconds: number;
  targetWeightKg?: number | null;
  instructions?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
}

export interface WorkoutDaySplit {
  day: DayOfWeek;
  focus: string;
  isRestDay: boolean;
  exercises: SplitExercise[];
}

export interface LoggedSet {
  setNumber: number;
  reps: number;
  weightKg: number;
  completed: boolean;
}

export interface LoggedExercise {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  imageUrl?: string | null;
  videoUrl?: string | null;
  instructions?: string;
  sets: LoggedSet[];
}

export interface WorkoutSession {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  day: DayOfWeek;
  title: string;
  durationMinutes: number;
  totalVolumeKg: number;
  notes: string;
  exercises: LoggedExercise[];
  createdAt: string;
}

export interface CustomMeasurementEntry {
  id: string;
  label: string;
  valueCm: number;
}

export interface BodyMeasurement {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  weightKg: number | null;
  bodyFatPct: number | null;
  waistCm: number | null;
  chestCm: number | null;
  hipsCm?: number | null;
  armsCm: number | null;
  thighsCm: number | null;
  neckCm: number | null;
  calvesCm?: number | null;
  customMeasurements?: CustomMeasurementEntry[];
  photoDataUrl: string | null;
  notes: string;
  createdAt: string;
}

export interface SavedPlan {
  id: string;
  userId: string;
  type: 'DIET' | 'WORKOUT';
  name: string;
  description: string;
  payload: unknown;
  createdAt: string;
}

export type AiProposalType =
  | 'MODIFY_DIET_PLAN'
  | 'MODIFY_WORKOUT_PLAN'
  | 'CREATE_NEW_PLAN'
  | 'ACTIVATE_SAVED_PLAN'
  | 'UPDATE_TARGETS'
  | 'LOG_FOOD'
  | 'LOG_MEASUREMENT';

export type AiProposalStatus = 'PENDING' | 'APPROVED' | 'CANCELLED' | 'EXPIRED';

export interface AiProposalChange {
  action: 'ADD' | 'UPDATE' | 'REMOVE';
  target: string;
  field: string;
  existingValue: string;
  proposedValue: string;
}

export interface AiNewPlanPreviewMeal {
  name: string;
  time: string;
  items: Array<{
    foodId?: string;
    foodName: string;
    servings: number;
    servingLabel?: string;
    calories?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
    priceInr?: number;
    category?: DietTag;
  }>;
}

export interface AiNewPlanPreviewWorkoutDay {
  day: DayOfWeek;
  focus: string;
  isRestDay: boolean;
  exercises: Array<{
    exerciseId?: string;
    exerciseName: string;
    muscleGroup: MuscleGroup;
    equipment?: string;
    targetSets: number;
    targetReps: string;
    restSeconds: number;
    targetWeightKg?: number | null;
    instructions?: string;
  }>;
}

export interface AiNewPlanPreview {
  planType: 'DIET' | 'WORKOUT';
  name: string;
  description: string;
  meals?: AiNewPlanPreviewMeal[];
  split?: AiNewPlanPreviewWorkoutDay[];
}

export interface AiProposal {
  id: string;
  type: AiProposalType;
  status: AiProposalStatus;
  planName: string;
  planType: 'DIET' | 'WORKOUT' | 'TARGETS' | 'MEASUREMENT' | 'LOG';
  affectedTarget: string;
  summary: string;
  impactSummary: string;
  changes: AiProposalChange[];
  params: Record<string, unknown>;
  newPlanPreview?: AiNewPlanPreview | null;
  expiresAt: string;
  applied: boolean;
  resolvedAt?: string | null;
  idempotencyKey?: string;
}

export interface AiPendingProposal {
  id: string;
  userId: string;
  messageId: string;
  status: AiProposalStatus;
  proposal: AiProposal;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AiAuditLog {
  id: string;
  userId: string;
  proposalId: string;
  type: AiProposalType;
  action: 'PROPOSED' | 'APPROVED' | 'CANCELLED' | 'EXPIRED';
  editedByUser: boolean;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AiMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  proposal?: AiProposal | null;
  createdAt: string;
}

export interface DatabaseSchema {
  users: User[];
  sessions: Session[];
  profiles: FitnessProfile[];
  foods: FoodItem[];
  plannedMeals: PlannedMeal[];
  mealLogs: MealLog[];
  exercises: Exercise[];
  workoutSplits: Record<string, WorkoutDaySplit[]>; // keyed by userId
  workoutSessions: WorkoutSession[];
  measurements: BodyMeasurement[];
  savedPlans: SavedPlan[];
  aiMessages: AiMessage[];
  pendingProposals: AiPendingProposal[];
  aiAuditLogs: AiAuditLog[];
}
