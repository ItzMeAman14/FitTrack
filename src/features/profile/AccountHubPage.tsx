import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Calculator, KeyRound, LogOut, Save, Sparkles } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type {
  ActivityLevel,
  AiModelsResponse,
  FitnessGoal,
  FitnessProfile,
  Gender,
  MeasurementUnit,
  TargetRecommendations,
  WeightUnit,
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
import { Modal } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { DataPortabilityCard } from './DataPortabilityCard';
import { AiModelManagerModal } from '../ai/AiModelManagerModal';

interface ProfileResponse {
  id: string;
  name: string;
  email: string;
  profile: FitnessProfile;
  recommendations: TargetRecommendations | null;
}

export function AccountHubPage() {
  const { user, setUser, logout } = useAuth();
  const { showToast } = useToast();
  const { dataVersion, bumpDataVersion } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [recommendations, setRecommendations] = useState<TargetRecommendations | null>(null);
  const [modelsData, setModelsData] = useState<AiModelsResponse | null>(null);
  const [aiModelsOpen, setAiModelsOpen] = useState(false);

  const [profileForm, setProfileForm] = useState({
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

  const [prefsForm, setPrefsForm] = useState({
    preferredWeightUnit: 'KG' as WeightUnit,
    preferredMeasureUnit: 'CM' as MeasurementUnit,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    geminiEnabled: true,
  });

  const populateForms = useCallback((u: ProfileResponse) => {
    const p = u.profile;
    const activeM = p?.preferredMeasureUnit || 'CM';
    const activeW = p?.preferredWeightUnit || 'KG';
    setRecommendations(u.recommendations);

    const h = cmToDisplay(p?.heightCm ?? null, activeM);
    const sw = kgToDisplay(p?.startingWeightKg ?? null, activeW);
    const cw = kgToDisplay(p?.currentWeightKg ?? null, activeW);
    const tw = kgToDisplay(p?.targetWeightKg ?? null, activeW);
    const twaist = cmToDisplay(p?.targetWaistCm ?? null, activeM);

    setProfileForm({
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

    setPrefsForm({
      preferredWeightUnit: activeW,
      preferredMeasureUnit: activeM,
      currency: p?.currency || 'INR',
      timezone: p?.timezone || 'Asia/Kolkata',
      geminiEnabled: p?.geminiEnabled ?? true,
    });
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const res = await api.get<AiModelsResponse>('/ai/models');
      setModelsData(res.data);
    } catch {
      // Optional load
    }
  }, []);

  const loadAccount = useCallback(async () => {
    try {
      const [res] = await Promise.all([api.get<ProfileResponse>('/profile'), loadModels()]);
      populateForms(res.data);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load account settings.', 'error');
    } finally {
      setLoading(false);
    }
  }, [loadModels, populateForms, showToast]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount, dataVersion]);

  const measureUnit = user?.profile?.preferredMeasureUnit || prefsForm.preferredMeasureUnit || 'CM';
  const weightUnit = user?.profile?.preferredWeightUnit || prefsForm.preferredWeightUnit || 'KG';
  const mSuffix = measureUnitSuffix(measureUnit);
  const wSuffix = weightUnitSuffix(weightUnit);

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await api.put<ProfileResponse>('/profile', {
        name: profileForm.name.trim(),
        age: profileForm.age || null,
        gender: (profileForm.gender as Gender) || null,
        heightCm: displayToCm(profileForm.height, measureUnit),
        startingWeightKg: displayToKg(profileForm.startingWeight, weightUnit),
        currentWeightKg: displayToKg(profileForm.currentWeight, weightUnit),
        targetWeightKg: displayToKg(profileForm.targetWeight, weightUnit),
        targetWaistCm: displayToCm(profileForm.targetWaist, measureUnit),
        targetBodyFatPct: profileForm.targetBodyFatPct || null,
        fitnessGoal: profileForm.fitnessGoal,
        activityLevel: profileForm.activityLevel,
        dailyCalorieTarget: profileForm.dailyCalorieTarget || null,
        dailyProteinTargetG: profileForm.dailyProteinTargetG || null,
        dailyCarbTargetG: profileForm.dailyCarbTargetG || null,
        dailyFatTargetG: profileForm.dailyFatTargetG || null,
      });
      setRecommendations(res.data.recommendations);
      setUser((prev) =>
        prev ? { ...prev, name: res.data.name, profile: res.data.profile } : prev
      );
      bumpDataVersion('profile');
      showToast('Profile and fitness targets saved.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update profile.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePrefs = async (e: FormEvent) => {
    e.preventDefault();
    setSavingPrefs(true);
    try {
      const res = await api.put<ProfileResponse>('/profile', prefsForm);
      setUser((prev) => (prev ? { ...prev, profile: res.data.profile } : prev));
      populateForms(res.data);
      bumpDataVersion('profile');
      showToast('Preferences saved.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save preferences.', 'error');
    } finally {
      setSavingPrefs(false);
    }
  };

  const applyRecommendations = () => {
    if (!recommendations) return;
    setProfileForm((prev) => ({
      ...prev,
      dailyCalorieTarget: String(recommendations.recommendedCalories),
      dailyProteinTargetG: String(recommendations.recommendedProteinG),
      dailyCarbTargetG: String(recommendations.recommendedCarbG),
      dailyFatTargetG: String(recommendations.recommendedFatG),
    }));
    showToast('Calculated targets populated. Click Save Profile & Targets to apply.', 'info');
  };

  const handleClearLogs = async () => {
    setClearing(true);
    try {
      await api.post('/profile/clear-logs');
      setConfirmClearOpen(false);
      bumpDataVersion('all');
      showToast('All meal, workout, measurement, and AI chat logs cleared.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to clear logs.', 'error');
    } finally {
      setClearing(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      showToast('Signed out of FitTrack.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log out.', 'error');
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading Account hub..." />;

  const userInitials = (user?.name || 'FT')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const activeCustomModel =
    modelsData?.customModels.find((m) => m.id === modelsData.activeModelId) || null;

  return (
    <div className="max-w-6xl space-y-5">
      <Card className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#26351D] border border-[#B6F36A]/35 text-sm font-bold text-[#B6F36A]">
            {userInitials}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-[#F5F7FA] truncate">
              {user?.name || 'FitTrack Member'}
            </h2>
            <p className="text-xs text-[#929BAA] truncate">{user?.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => setAiModelsOpen(true)}>
            <KeyRound className="h-4 w-4 text-[#B6F36A]" />
            AI Models & Keys ({modelsData?.customModels.length || 0})
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={loggingOut}
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? 'Logging out...' : 'Log Out'}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Body Profile, TDEE Recommendation & Macro Targets */}
        <form onSubmit={handleSaveProfile} className="lg:col-span-7 space-y-5">
          <Card className="p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                Personal Information & Body Goals
              </h2>
              <p className="text-xs text-[#929BAA]">
                Displaying lengths in {mSuffix} and weights in {wSuffix}. Used for BMR/TDEE macro
                calculations.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <Input
                label="Full Name"
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                required
              />
              <Input
                label="Age"
                type="number"
                placeholder="25"
                value={profileForm.age}
                onChange={(e) => setProfileForm({ ...profileForm, age: e.target.value })}
              />
              <Select
                label="Gender"
                value={profileForm.gender}
                onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}
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
                value={profileForm.height}
                onChange={(e) => setProfileForm({ ...profileForm, height: e.target.value })}
              />
              <Input
                label={`Starting Weight (${wSuffix})`}
                type="number"
                step="0.1"
                placeholder={weightUnit === 'LBS' ? '180.0' : '82.0'}
                value={profileForm.startingWeight}
                onChange={(e) => setProfileForm({ ...profileForm, startingWeight: e.target.value })}
              />
              <Input
                label={`Current Weight (${wSuffix})`}
                type="number"
                step="0.1"
                placeholder={weightUnit === 'LBS' ? '173.0' : '78.5'}
                value={profileForm.currentWeight}
                onChange={(e) => setProfileForm({ ...profileForm, currentWeight: e.target.value })}
              />
              <Input
                label={`Target Weight (${wSuffix})`}
                type="number"
                step="0.1"
                placeholder={weightUnit === 'LBS' ? '160.0' : '72.0'}
                value={profileForm.targetWeight}
                onChange={(e) => setProfileForm({ ...profileForm, targetWeight: e.target.value })}
              />
              <Input
                label={`Target Waist (${mSuffix})`}
                type="number"
                step="0.1"
                placeholder={measurePlaceholder(78, measureUnit)}
                value={profileForm.targetWaist}
                onChange={(e) => setProfileForm({ ...profileForm, targetWaist: e.target.value })}
              />
              <Input
                label="Target Body Fat (%)"
                type="number"
                step="0.1"
                placeholder="14.0"
                value={profileForm.targetBodyFatPct}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, targetBodyFatPct: e.target.value })
                }
              />
              <Select
                label="Fitness Goal"
                value={profileForm.fitnessGoal}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, fitnessGoal: e.target.value as FitnessGoal })
                }
                options={[
                  { value: 'FAT_LOSS', label: 'Fat Loss' },
                  { value: 'MUSCLE_GAIN', label: 'Muscle Gain' },
                  { value: 'MAINTENANCE', label: 'Maintenance' },
                  { value: 'RECOMPOSITION', label: 'Body Recomposition' },
                ]}
              />
              <div className="sm:col-span-2">
                <Select
                  label="Activity Level"
                  value={profileForm.activityLevel}
                  onChange={(e) =>
                    setProfileForm({
                      ...profileForm,
                      activityLevel: e.target.value as ActivityLevel,
                    })
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
            </div>
          </Card>

          {recommendations && (
            <Card className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#171E29]">
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

          <Card className="p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                Daily Nutrition Targets
              </h2>
              <p className="text-xs text-[#929BAA]">
                Override manually or apply the calculated recommendation above.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <Input
                label="Daily Calories (kcal)"
                type="number"
                placeholder="2100"
                value={profileForm.dailyCalorieTarget}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, dailyCalorieTarget: e.target.value })
                }
              />
              <Input
                label="Protein Target (g)"
                type="number"
                placeholder="150"
                value={profileForm.dailyProteinTargetG}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, dailyProteinTargetG: e.target.value })
                }
              />
              <Input
                label="Carbs Target (g)"
                type="number"
                placeholder="200"
                value={profileForm.dailyCarbTargetG}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, dailyCarbTargetG: e.target.value })
                }
              />
              <Input
                label="Fat Target (g)"
                type="number"
                placeholder="60"
                value={profileForm.dailyFatTargetG}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, dailyFatTargetG: e.target.value })
                }
              />
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" disabled={savingProfile}>
                <Save className="h-4 w-4" />
                {savingProfile ? 'Saving...' : 'Save Profile & Targets'}
              </Button>
            </div>
          </Card>
        </form>

        {/* Right Column: Unit & AI Preferences + JSON Data Portability */}
        <div className="lg:col-span-5 space-y-5">
          <form onSubmit={handleSavePrefs}>
            <Card className="p-4 sm:p-5 space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                  Units, Region & AI Preferences
                </h2>
                <p className="text-xs text-[#929BAA]">
                  Defaults to INR (₹), kg, cm, and Asia/Kolkata timezone.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <Select
                  label="Weight Unit"
                  value={prefsForm.preferredWeightUnit}
                  onChange={(e) =>
                    setPrefsForm({
                      ...prefsForm,
                      preferredWeightUnit: e.target.value as WeightUnit,
                    })
                  }
                  options={[
                    { value: 'KG', label: 'Kilograms (kg)' },
                    { value: 'LBS', label: 'Pounds (lbs)' },
                  ]}
                />
                <Select
                  label="Body Measurement Unit"
                  value={prefsForm.preferredMeasureUnit}
                  onChange={(e) =>
                    setPrefsForm({
                      ...prefsForm,
                      preferredMeasureUnit: e.target.value as MeasurementUnit,
                    })
                  }
                  options={[
                    { value: 'CM', label: 'Centimeters (cm)' },
                    { value: 'INCHES', label: 'Inches (in)' },
                  ]}
                />
                <Select
                  label="Currency"
                  value={prefsForm.currency}
                  onChange={(e) => setPrefsForm({ ...prefsForm, currency: e.target.value })}
                  options={[
                    { value: 'INR', label: 'Indian Rupee (INR ₹)' },
                    { value: 'USD', label: 'US Dollar (USD $)' },
                  ]}
                />
                <Input
                  label="Timezone (IANA)"
                  value={prefsForm.timezone}
                  onChange={(e) => setPrefsForm({ ...prefsForm, timezone: e.target.value })}
                  placeholder="Asia/Kolkata"
                />
              </div>

              <div className="pt-3 border-t border-[#202733] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[#B6F36A]" />
                    <span className="text-sm font-semibold text-[#F5F7FA]">
                      FitTrack AI Coach
                    </span>
                  </div>
                  <span className="text-[11px] text-[#62A8F7]">
                    {activeCustomModel
                      ? activeCustomModel.modelName
                      : modelsData?.builtIn.model || 'Server AI'}
                  </span>
                </div>
                <label className="flex items-center gap-2.5 text-xs text-[#F5F7FA] cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[#252D38] bg-[#0D121A] accent-[#B6F36A]"
                    checked={prefsForm.geminiEnabled}
                    onChange={(e) =>
                      setPrefsForm({ ...prefsForm, geminiEnabled: e.target.checked })
                    }
                  />
                  Enable FitTrack AI Coach (uses live profile, meals, workouts & check-ins)
                </label>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#202733] bg-[#0D121A] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[#F5F7FA]">
                      Custom AI Models & API Keys
                    </div>
                    <div className="text-[11px] text-[#929BAA] truncate">
                      {activeCustomModel
                        ? `Active: ${activeCustomModel.label} (${activeCustomModel.keyPreview})`
                        : `Using FitTrack default (${modelsData?.builtIn.model || 'gemini-4-hydrogen'})`}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setAiModelsOpen(true)}
                  >
                    <KeyRound className="h-3.5 w-3.5 text-[#B6F36A]" />
                    {modelsData?.customModels.length ? 'Manage Models' : 'Add Model'}
                  </Button>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={savingPrefs}>
                  <Save className="h-4 w-4" />
                  {savingPrefs ? 'Saving...' : 'Save Preferences'}
                </Button>
              </div>
            </Card>
          </form>

          <DataPortabilityCard onOpenClearLogs={() => setConfirmClearOpen(true)} />
        </div>
      </div>

      <AiModelManagerModal
        open={aiModelsOpen}
        onClose={() => setAiModelsOpen(false)}
        modelsData={modelsData}
        onUpdated={async () => {
          await loadModels();
          bumpDataVersion('ai');
        }}
      />

      <Modal
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Clear all activity logs?"
        subtitle="This removes meal logs, workout sessions, measurements, and AI chat history. Your Food Library, Exercise Library, and Profile targets remain intact."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmClearOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={clearing} onClick={handleClearLogs}>
            {clearing ? 'Clearing...' : 'Confirm Clear'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
