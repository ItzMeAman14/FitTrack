import { assertDatabaseConfigured, prisma, toApiProfile, withTransaction } from '../db.js';
import type {
  ActivityLevel,
  FitnessGoal,
  FitnessProfile,
  Gender,
  MeasurementUnit,
  WeightUnit,
} from '../types.js';
import { generateId } from '../utils/crypto.js';
import { AppError } from '../utils/error.js';

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHTLY_ACTIVE: 1.375,
  MODERATELY_ACTIVE: 1.55,
  VERY_ACTIVE: 1.725,
  EXTREMELY_ACTIVE: 1.9,
};

export interface TargetRecommendations {
  bmr: number;
  tdee: number;
  recommendedCalories: number;
  recommendedProteinG: number;
  recommendedCarbG: number;
  recommendedFatG: number;
}

export function calculateRecommendedTargets(
  profile: FitnessProfile | null
): TargetRecommendations | null {
  if (!profile?.currentWeightKg || !profile?.heightCm || !profile?.age || !profile?.gender) {
    return null;
  }

  const weight = Number(profile.currentWeightKg);
  const height = Number(profile.heightCm);
  const age = Number(profile.age);

  const bmr =
    profile.gender === 'FEMALE'
      ? 10 * weight + 6.25 * height - 5 * age - 161
      : 10 * weight + 6.25 * height - 5 * age + 5;

  const multiplier = ACTIVITY_MULTIPLIERS[profile.activityLevel] || 1.55;
  const tdee = Math.round(bmr * multiplier);

  let calorieAdjustment = 0;
  if (profile.fitnessGoal === 'FAT_LOSS') calorieAdjustment = -450;
  else if (profile.fitnessGoal === 'MUSCLE_GAIN') calorieAdjustment = 300;
  else if (profile.fitnessGoal === 'RECOMPOSITION') calorieAdjustment = -200;

  const recommendedCalories = Math.max(1200, Math.round(tdee + calorieAdjustment));
  const proteinMultiplier =
    profile.fitnessGoal === 'FAT_LOSS' || profile.fitnessGoal === 'RECOMPOSITION' ? 2.0 : 1.8;
  const recommendedProteinG = Math.round(weight * proteinMultiplier);
  const recommendedFatG = Math.round((recommendedCalories * 0.25) / 9);
  const recommendedCarbG = Math.max(
    50,
    Math.round((recommendedCalories - recommendedProteinG * 4 - recommendedFatG * 9) / 4)
  );

  return {
    bmr: Math.round(bmr),
    tdee,
    recommendedCalories,
    recommendedProteinG,
    recommendedCarbG,
    recommendedFatG,
  };
}

export async function getUserProfile(userId: string) {
  assertDatabaseConfigured();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw new AppError('User profile not found.', 404);
  }
  const profile = toApiProfile(user.profile);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    profile,
    recommendations: calculateRecommendedTargets(profile),
  };
}

export interface ProfileUpdateInput {
  name?: string;
  age?: number | null;
  gender?: Gender | null;
  heightCm?: number | null;
  startingWeightKg?: number | null;
  currentWeightKg?: number | null;
  targetWeightKg?: number | null;
  targetWaistCm?: number | null;
  targetBodyFatPct?: number | null;
  fitnessGoal?: FitnessGoal;
  activityLevel?: ActivityLevel;
  dailyCalorieTarget?: number | null;
  dailyProteinTargetG?: number | null;
  dailyCarbTargetG?: number | null;
  dailyFatTargetG?: number | null;
  preferredWeightUnit?: WeightUnit;
  preferredMeasureUnit?: MeasurementUnit;
  currency?: string;
  timezone?: string;
  theme?: 'dark';
  geminiEnabled?: boolean;
}

export async function updateUserProfile(userId: string, payload: ProfileUpdateInput) {
  const { name, ...profileFields } = payload;

  return withTransaction(async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { id: userId } });
    if (!existingUser) throw new AppError('User not found.', 404);

    const now = new Date();
    const user = name
      ? await tx.user.update({
          where: { id: userId },
          data: { name, updatedAt: now },
        })
      : existingUser;

    const existingProfile = await tx.fitnessProfile.findUnique({ where: { userId } });
    const profileRow = existingProfile
      ? await tx.fitnessProfile.update({
          where: { userId },
          data: {
            ...profileFields,
            updatedAt: now,
          },
        })
      : await tx.fitnessProfile.create({
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
            ...profileFields,
            createdAt: now,
            updatedAt: now,
          },
        });

    const profile = toApiProfile(profileRow);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      profile,
      recommendations: calculateRecommendedTargets(profile),
    };
  });
}
