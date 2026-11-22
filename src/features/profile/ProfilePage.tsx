import { useEffect, useState, type FormEvent } from 'react';
import { Calculator, Save } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type {
  ActivityLevel,
  FitnessGoal,
  FitnessProfile,
  Gender,
  TargetRecommendations,
} from '../../types/fittrack';
import {
  cmToDisplay,
  displayToCm,
  displayToKg,
  kgToDisplay,
  measurePlaceholder,
  measureUnitSuffix,
  weightUnitSuffix,
} from '../../utils/units';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

interface ProfileResponse {
  id: string;
  name: string;
  email: string;
  profile: FitnessProfile;
  recommendations: TargetRecommendations | null;
}

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recommendations, setRecommendations] = useState<TargetRecommendations | null>(null);

  const measureUnit = user?.profile?.preferredMeasureUnit || 'CM';
  const weightUnit = user?.profile?.preferredWeightUnit || 'KG';
  const mSuffix = measureUnitSuffix(measureUnit);
  const wSuffix = weightUnitSuffix(weightUnit);

  const [form, setForm] = useState({
    name: '',
    age: '',
    gender: '',
    height: '',
    startingWeight: '',
    currentWeight: '',
    targetWeight: '',
    targetWaist: '',
    targetBodyFatPct: '',
    fitnessGoal: 'MAINTENANCE' as FitnessGoal,
    activityLevel: 'MODERATELY_ACTIVE' as ActivityLevel,
    dailyCalorieTarget: '',
    dailyProteinTargetG: '',
    dailyCarbTargetG: '',
    dailyFatTargetG: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<ProfileResponse>('/profile');
        const u = res.data;
        const p = u.profile;
        const activeM = p?.preferredMeasureUnit || 'CM';
        const activeW = p?.preferredWeightUnit || 'KG';
        setRecommendations(u.recommendations);
        const h = cmToDisplay(p?.heightCm ?? null, activeM);
        const sw = kgToDisplay(p?.startingWeightKg ?? null, activeW);
        const cw = kgToDisplay(p?.currentWeightKg ?? null, activeW);
        const tw = kgToDisplay(p?.targetWeightKg ?? null, activeW);
        const twaist = cmToDisplay(p?.targetWaistCm ?? null, activeM);

        setForm({
          name: u.name || '',
          age: p?.age ? String(p.age) : '',
          gender: p?.gender || '',
          height: h !== null ? String(h) : '',
          startingWeight: sw !== null ? String(sw) : '',
          currentWeight: cw !== null ? String(cw) : '',
          targetWeight: tw !== null ? String(tw) : '',
          targetWaist: twaist !== null ? String(twaist) : '',
          targetBodyFatPct: p?.targetBodyFatPct ? String(p.targetBodyFatPct) : '',
          fitnessGoal: p?.fitnessGoal || 'MAINTENANCE',
          activityLevel: p?.activityLevel || 'MODERATELY_ACTIVE',
          dailyCalorieTarget: p?.dailyCalorieTarget ? String(p.dailyCalorieTarget) : '',
          dailyProteinTargetG: p?.dailyProteinTargetG ? String(p.dailyProteinTargetG) : '',
          dailyCarbTargetG: p?.dailyCarbTargetG ? String(p.dailyCarbTargetG) : '',
          dailyFatTargetG: p?.dailyFatTargetG ? String(p.dailyFatTargetG) : '',
        });
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to load profile.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [showToast]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put<ProfileResponse>('/profile', {
        name: form.name.trim(),
        age: form.age || null,
        gender: (form.gender as Gender) || null,
        heightCm: displayToCm(form.height, measureUnit),
        startingWeightKg: displayToKg(form.startingWeight, weightUnit),
        currentWeightKg: displayToKg(form.currentWeight, weightUnit),
        targetWeightKg: displayToKg(form.targetWeight, weightUnit),
        targetWaistCm: displayToCm(form.targetWaist, measureUnit),
        targetBodyFatPct: form.targetBodyFatPct || null,
        fitnessGoal: form.fitnessGoal,
        activityLevel: form.activityLevel,
        dailyCalorieTarget: form.dailyCalorieTarget || null,
        dailyProteinTargetG: form.dailyProteinTargetG || null,
        dailyCarbTargetG: form.dailyCarbTargetG || null,
        dailyFatTargetG: form.dailyFatTargetG || null,
      });
      setRecommendations(res.data.recommendations);
      setUser((prev) =>
        prev ? { ...prev, name: res.data.name, profile: res.data.profile } : prev
      );
      showToast('Profile and fitness targets saved.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const applyRecommendations = () => {
    if (!recommendations) return;
    setForm((prev) => ({
      ...prev,
      dailyCalorieTarget: String(recommendations.recommendedCalories),
      dailyProteinTargetG: String(recommendations.recommendedProteinG),
      dailyCarbTargetG: String(recommendations.recommendedCarbG),
      dailyFatTargetG: String(recommendations.recommendedFatG),
    }));
    showToast('Calculated targets populated. Click Save Changes to apply.', 'info');
  };

  if (loading) return <LoadingSpinner label="Loading profile..." />;

  return (
    <div className="space-y-6 max-w-4xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              Personal Information & Body Goals
            </h2>
            <p className="text-xs text-[#929BAA]">
              Displaying lengths in {mSuffix} and weights in {wSuffix}. Used for BMR/TDEE macro recommendations.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Input
              label="Full Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Input
              label="Age"
              type="number"
              placeholder="25"
              value={form.age}
              onChange={(e) => setForm({ ...form, age: e.target.value })}
            />
            <Select
              label="Gender"
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
              options={[
                { value: '', label: 'Select gender' },
                { value: 'MALE', label: 'Male' },
                { value: 'FEMALE', label: 'Female' },
                { value: 'OTHER', label: 'Other' },
              ]}
            />
            <Input
              label={`Height (${mSuffix})`}
              type="number"
              step="0.1"
              placeholder={measurePlaceholder(175, measureUnit)}
              value={form.height}
              onChange={(e) => setForm({ ...form, height: e.target.value })}
            />
            <Input
              label={`Starting Weight (${wSuffix})`}
              type="number"
              step="0.1"
              placeholder={weightUnit === 'LBS' ? '180.0' : '82.0'}
              value={form.startingWeight}
              onChange={(e) => setForm({ ...form, startingWeight: e.target.value })}
            />
            <Input
              label={`Current Weight (${wSuffix})`}
              type="number"
              step="0.1"
              placeholder={weightUnit === 'LBS' ? '173.0' : '78.5'}
              value={form.currentWeight}
              onChange={(e) => setForm({ ...form, currentWeight: e.target.value })}
            />
            <Input
              label={`Target Weight (${wSuffix})`}
              type="number"
              step="0.1"
              placeholder={weightUnit === 'LBS' ? '160.0' : '72.0'}
              value={form.targetWeight}
              onChange={(e) => setForm({ ...form, targetWeight: e.target.value })}
            />
            <Input
              label={`Target Waist (${mSuffix})`}
              type="number"
              step="0.1"
              placeholder={measurePlaceholder(78, measureUnit)}
              value={form.targetWaist}
              onChange={(e) => setForm({ ...form, targetWaist: e.target.value })}
            />
            <Input
              label="Target Body Fat (%)"
              type="number"
              step="0.1"
              placeholder="14.0"
              value={form.targetBodyFatPct}
              onChange={(e) => setForm({ ...form, targetBodyFatPct: e.target.value })}
            />
            <Select
              label="Fitness Goal"
              value={form.fitnessGoal}
              onChange={(e) => setForm({ ...form, fitnessGoal: e.target.value as FitnessGoal })}
              options={[
                { value: 'FAT_LOSS', label: 'Fat Loss' },
                { value: 'MUSCLE_GAIN', label: 'Muscle Gain' },
                { value: 'MAINTENANCE', label: 'Maintenance' },
                { value: 'RECOMPOSITION', label: 'Body Recomposition' },
              ]}
            />
            <Select
              label="Activity Level"
              value={form.activityLevel}
              onChange={(e) =>
                setForm({ ...form, activityLevel: e.target.value as ActivityLevel })
              }
              options={[
                { value: 'SEDENTARY', label: 'Sedentary' },
                { value: 'LIGHTLY_ACTIVE', label: 'Lightly Active (1-3 days/wk)' },
                { value: 'MODERATELY_ACTIVE', label: 'Moderately Active (3-5 days/wk)' },
                { value: 'VERY_ACTIVE', label: 'Very Active (6-7 days/wk)' },
                { value: 'EXTREMELY_ACTIVE', label: 'Extremely Active' },
              ]}
            />
          </div>
        </Card>

        {recommendations && (
          <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#171E29]">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-[#B6F36A]">Calculated Recommendation</span>
                <span aria-hidden="true" className="text-[#626C7B]">
                  ·
                </span>
                <span className="font-mono text-[#929BAA] tabular-nums">
                  BMR {recommendations.bmr} kcal · TDEE {recommendations.tdee} kcal
                </span>
              </div>
              <p className="font-mono text-xs text-[#F5F7FA] tabular-nums">
                Suggested: <strong>{recommendations.recommendedCalories} kcal</strong> ·{' '}
                {recommendations.recommendedProteinG}g P · {recommendations.recommendedCarbG}g C ·{' '}
                {recommendations.recommendedFatG}g F
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={applyRecommendations}>
              <Calculator className="h-3.5 w-3.5 text-[#B6F36A]" />
              Apply Targets
            </Button>
          </Card>
        )}

        <Card className="space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              Daily Nutrition Targets
            </h2>
            <p className="text-xs text-[#929BAA]">
              Override manually or use the calculated recommendation above.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input
              label="Daily Calories (kcal)"
              type="number"
              placeholder="2100"
              value={form.dailyCalorieTarget}
              onChange={(e) => setForm({ ...form, dailyCalorieTarget: e.target.value })}
            />
            <Input
              label="Protein Target (g)"
              type="number"
              placeholder="150"
              value={form.dailyProteinTargetG}
              onChange={(e) => setForm({ ...form, dailyProteinTargetG: e.target.value })}
            />
            <Input
              label="Carbs Target (g)"
              type="number"
              placeholder="200"
              value={form.dailyCarbTargetG}
              onChange={(e) => setForm({ ...form, dailyCarbTargetG: e.target.value })}
            />
            <Input
              label="Fat Target (g)"
              type="number"
              placeholder="60"
              value={form.dailyFatTargetG}
              onChange={(e) => setForm({ ...form, dailyFatTargetG: e.target.value })}
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
