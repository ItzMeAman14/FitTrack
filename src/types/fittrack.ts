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
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
  profile: FitnessProfile | null;
}

export interface TargetRecommendations {
  bmr: number;
  tdee: number;
  recommendedCalories: number;
  recommendedProteinG: number;
  recommendedCarbG: number;
  recommendedFatG: number;
}

export interface FoodItem {
  id: string;
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
  name: string;
  time: string;
  items: PlannedMealItem[];
}

export interface MealLog {
  id: string;
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
}

export interface Exercise {
  id: string;
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
  date: string;
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
  date: string;
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

export interface AiNewPlanPreview {
  planType: 'DIET' | 'WORKOUT';
  name: string;
  description: string;
  meals?: Array<{
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
  }>;
  split?: Array<{
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
  }>;
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
}

export interface AiAuditLog {
  id: string;
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
  role: 'user' | 'assistant';
  content: string;
  proposal?: AiProposal | null;
  createdAt: string;
}

export interface DashboardOverview {
  welcome: {
    name: string;
    greeting: string;
    formattedDate: string;
    isoDate: string;
    dayOfWeek: DayOfWeek;
    timezone: string;
    motivation: string;
  };
  overviewCards: {
    currentWeightKg: number | null;
    targetWeightKg: number | null;
    weightLostKg: number | null;
    dailyCalorieTarget: number | null;
    dailyProteinTargetG: number | null;
    todaysFoodExpense: number;
    currency: string;
    weightUnit: WeightUnit;
  };
  nutrition: {
    caloriesConsumed: number;
    caloriesTarget: number | null;
    proteinConsumedG: number;
    proteinTargetG: number | null;
    carbsConsumedG: number;
    carbsTargetG: number | null;
    fatConsumedG: number;
    fatTargetG: number | null;
    hasDietPlan: boolean;
  };
  todaysSchedule: {
    meals: Array<{
      id: string;
      name: string;
      time: string;
      itemCount: number;
      plannedCalories: number;
      plannedProteinG: number;
      loggedToday: boolean;
    }>;
    workout: {
      day: DayOfWeek;
      focus: string;
      isRestDay: boolean;
      exerciseCount: number;
      completedToday: boolean;
    } | null;
  };
  workoutOverview: {
    todaysWorkout: WorkoutSession | null;
    plannedExercisesCount: number;
    completedExercisesCount: number;
    weeklyCompletedCount: number;
    weeklyTargetCount: number;
    totalVolumeKg: number | null;
  };
  measurementOverview: {
    latestWeightKg: number | null;
    latestWaist: number | null;
    latestChest: number | null;
    latestHips?: number | null;
    latestCalves?: number | null;
    latestBodyFat: number | null;
    unit: MeasurementUnit;
  };
  charts: {
    weightTrend: Array<{ date: string; weightKg: number | null; waistCm: number | null }>;
    calorieTrend: Array<{
      date: string;
      calories: number;
      target: number | null;
      proteinG: number;
      expenseInr: number;
    }>;
    workoutVolumeTrend: Array<{
      date: string;
      title: string;
      volumeKg: number;
      durationMinutes: number;
    }>;
  };
}

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

export interface DocumentedJsonSchema {
  schemaVersion: string;
  description: string;
  exportTypes: ImportExportScope[];
  enums: Record<string, string[]>;
  examples: {
    DIET: Record<string, unknown>;
    WORKOUT: Record<string, unknown>;
    MEASUREMENTS: Record<string, unknown>;
  };
}

export type AiProviderName =
  | 'gemini'
  | 'grok'
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'openai_compatible';

export interface BuiltInAiProviderInfo {
  provider: AiProviderName;
  model: string;
  configured: boolean;
}

export interface UserAiModelSummary {
  id: string;
  label: string;
  provider: AiProviderName;
  modelName: string;
  baseUrl: string | null;
  keyPreview: string;
  isDefault: boolean;
  createdAt: string;
}

export interface AiModelsResponse {
  builtIn: BuiltInAiProviderInfo;
  activeModelId: string;
  customModels: UserAiModelSummary[];
}

