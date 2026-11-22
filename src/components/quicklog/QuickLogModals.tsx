import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ChevronDown, ChevronUp, Plus, Search } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { DietTag, FoodItem, MealLog, PlannedMeal } from '../../types/fittrack';
import {
  displayToCm,
  displayToKg,
  getMeasureBounds,
  measurePlaceholder,
  measureUnitSuffix,
  weightUnitSuffix,
} from '../../utils/units';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';

const todayIso = () => new Date().toISOString().slice(0, 10);

export function QuickLogModals() {
  const { user, refreshAuth } = useAuth();
  const { showToast } = useToast();
  const { quickLogModal, closeQuickLog, bumpDataVersion } = useWorkspace();

  const measureUnit = user?.profile?.preferredMeasureUnit || 'CM';
  const weightUnit = user?.profile?.preferredWeightUnit || 'KG';
  const mSuffix = measureUnitSuffix(measureUnit);
  const wSuffix = weightUnitSuffix(weightUnit);

  // --- Quick Log Meal State ---
  const [mealDate, setMealDate] = useState(todayIso);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [plannedMeals, setPlannedMeals] = useState<PlannedMeal[]>([]);
  const [dateLogs, setDateLogs] = useState<MealLog[]>([]);
  const [loadingFoods, setLoadingFoods] = useState(false);
  const [foodSearch, setFoodSearch] = useState('');
  const [selectedFoodId, setSelectedFoodId] = useState('');
  const [mealLabel, setMealLabel] = useState('Extra Food');
  const [servings, setServings] = useState('1');
  const [loggingMealId, setLoggingMealId] = useState<string | null>(null);
  const [savingMeal, setSavingMeal] = useState(false);

  // Inline Create Food mini-drawer inside Quick Log Meal
  const [creatingFood, setCreatingFood] = useState(false);
  const [newFood, setNewFood] = useState({
    name: '',
    category: 'VEG' as DietTag,
    servingLabel: '100g',
    servingGrams: '100',
    calories: '',
    proteinG: '',
    carbsG: '0',
    fatG: '0',
    priceInr: '0',
  });

  // --- Quick Log Measurement State ---
  const [measDate, setMeasDate] = useState(todayIso);
  const [weight, setWeight] = useState('');
  const [bodyFatPct, setBodyFatPct] = useState('');
  const [waist, setWaist] = useState('');
  const [chest, setChest] = useState('');
  const [hips, setHips] = useState('');
  const [arms, setArms] = useState('');
  const [thighs, setThighs] = useState('');
  const [neck, setNeck] = useState('');
  const [calves, setCalves] = useState('');
  const [notes, setNotes] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [showAllTape, setShowAllTape] = useState(false);
  const [savingMeas, setSavingMeas] = useState(false);

  useEffect(() => {
    if (quickLogModal === 'meal') {
      const today = todayIso();
      setMealDate(today);
      setMealLabel('Extra Food');
      setFoodSearch('');
      setCreatingFood(false);
      setLoadingFoods(true);
      Promise.all([
        api.get<FoodItem[]>('/foods'),
        api.get<PlannedMeal[]>('/diet/plan'),
        api.get<{ date: string; logs: MealLog[] }>(`/diet/logs?date=${today}`),
      ])
        .then(([foodsRes, mealsRes, logsRes]) => {
          setFoods(foodsRes.data);
          setPlannedMeals(mealsRes.data);
          setDateLogs(logsRes.data.logs);
          if (foodsRes.data.length > 0) {
            setSelectedFoodId((prev) =>
              prev && foodsRes.data.some((f) => f.id === prev) ? prev : foodsRes.data[0].id
            );
          }
        })
        .catch((err: unknown) => {
          showToast(err instanceof Error ? err.message : 'Failed to load foods.', 'error');
        })
        .finally(() => setLoadingFoods(false));
    } else if (quickLogModal === 'measurement') {
      setMeasDate(todayIso());
      setWeight('');
      setBodyFatPct('');
      setWaist('');
      setChest('');
      setHips('');
      setArms('');
      setThighs('');
      setNeck('');
      setCalves('');
      setNotes('');
      setPhotoDataUrl('');
      setShowAllTape(false);
    }
  }, [quickLogModal, showToast]);

  useEffect(() => {
    if (quickLogModal !== 'meal' || !mealDate) return;
    let cancelled = false;
    api
      .get<{ date: string; logs: MealLog[] }>(`/diet/logs?date=${mealDate}`)
      .then((res) => {
        if (!cancelled) setDateLogs(res.data.logs);
      })
      .catch(() => {
        // ignore transient date-change fetch errors
      });
    return () => {
      cancelled = true;
    };
  }, [quickLogModal, mealDate]);

  const filteredFoods = foods.filter((f) =>
    f.name.toLowerCase().includes(foodSearch.toLowerCase().trim())
  );

  useEffect(() => {
    if (filteredFoods.length > 0 && !filteredFoods.some((f) => f.id === selectedFoodId)) {
      setSelectedFoodId(filteredFoods[0].id);
    }
  }, [filteredFoods, selectedFoodId]);

  const handleQuickLogPlannedMeal = async (mealId: string) => {
    setLoggingMealId(mealId);
    try {
      await api.post(`/diet/meals/${mealId}/log-all`, { date: mealDate });
      bumpDataVersion('diet');
      showToast('Planned meal logged to daily intake.', 'success');
      closeQuickLog();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log meal.', 'error');
    } finally {
      setLoggingMealId(null);
    }
  };

  const handleSubmitQuickFood = async (e: FormEvent) => {
    e.preventDefault();
    setSavingMeal(true);
    try {
      let foodIdToLog = selectedFoodId;

      if (creatingFood) {
        const created = await api.post<FoodItem>('/foods', {
          name: newFood.name.trim(),
          category: newFood.category,
          servingLabel: newFood.servingLabel.trim(),
          servingGrams: Number(newFood.servingGrams) || 100,
          calories: Number(newFood.calories) || 0,
          proteinG: Number(newFood.proteinG) || 0,
          carbsG: Number(newFood.carbsG) || 0,
          fatG: Number(newFood.fatG) || 0,
          priceInr: Number(newFood.priceInr) || 0,
        });
        foodIdToLog = created.data.id;
      }

      if (!foodIdToLog) {
        showToast('Please select or create a food item.', 'error');
        return;
      }

      await api.post('/diet/logs', {
        date: mealDate,
        mealName: mealLabel.trim() || 'Extra Food',
        foodId: foodIdToLog,
        servings: Number(servings) || 1,
        plannedMealId: null,
      });
      bumpDataVersion('diet');
      showToast('Extra food intake logged.', 'success');
      closeQuickLog();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log food.', 'error');
    } finally {
      setSavingMeal(false);
    }
  };

  const isPlannedMealFullyLogged = (meal: PlannedMeal) => {
    if (meal.items.length === 0) return false;
    const counts = new Map<string, number>();
    for (const log of dateLogs) {
      if (log.plannedMealId !== meal.id || !log.foodId) continue;
      counts.set(log.foodId, (counts.get(log.foodId) ?? 0) + 1);
    }
    let remaining = 0;
    for (const item of meal.items) {
      const count = counts.get(item.foodId) ?? 0;
      if (count > 0) {
        counts.set(item.foodId, count - 1);
      } else {
        remaining += 1;
      }
    }
    return remaining === 0;
  };

  const validateTapeField = (raw: string, label: string, maxCm: number) => {
    if (!raw.trim()) return true;
    const val = Number(raw);
    const bounds = getMeasureBounds(maxCm, measureUnit);
    if (!Number.isFinite(val) || val < bounds.min || val > bounds.max) {
      showToast(
        `${label} must be between ${bounds.min} and ${bounds.max} ${bounds.suffix}.`,
        'error'
      );
      return false;
    }
    return true;
  };

  const handlePhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('Please select an image smaller than 2 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitQuickMeasurement = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !validateTapeField(waist, 'Waist', 300) ||
      !validateTapeField(chest, 'Chest', 300) ||
      !validateTapeField(hips, 'Hips', 300) ||
      !validateTapeField(arms, 'Arms', 150) ||
      !validateTapeField(thighs, 'Thighs', 200) ||
      !validateTapeField(neck, 'Neck', 120) ||
      !validateTapeField(calves, 'Calves', 150)
    ) {
      return;
    }

    setSavingMeas(true);
    try {
      await api.post('/measurements', {
        date: measDate,
        weightKg: displayToKg(weight, weightUnit),
        bodyFatPct: bodyFatPct.trim() ? Number(bodyFatPct) : null,
        waistCm: displayToCm(waist, measureUnit),
        chestCm: displayToCm(chest, measureUnit),
        hipsCm: displayToCm(hips, measureUnit),
        armsCm: displayToCm(arms, measureUnit),
        thighsCm: displayToCm(thighs, measureUnit),
        neckCm: displayToCm(neck, measureUnit),
        calvesCm: displayToCm(calves, measureUnit),
        customMeasurements: [],
        notes: notes.trim(),
        photoDataUrl: photoDataUrl || null,
      });
      await refreshAuth();
      bumpDataVersion('measurements');
      showToast('Measurement saved & profile weight synced.', 'success');
      closeQuickLog();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save measurement.', 'error');
    } finally {
      setSavingMeas(false);
    }
  };

  return (
    <>
      {/* Quick Log Meal Modal */}
      <Modal
        open={quickLogModal === 'meal'}
        onClose={closeQuickLog}
        title="Quick Log Meal"
        subtitle="Log a planned meal slot in one click or search/create a food item."
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-4">
          {plannedMeals.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[#929BAA]">One-Click Planned Meals</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                {plannedMeals.map((m) => {
                  const kcal = Math.round(m.items.reduce((s, i) => s + i.calories, 0));
                  const pro = Math.round(m.items.reduce((s, i) => s + i.proteinG, 0));
                  const isLogged = isPlannedMealFullyLogged(m);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={m.items.length === 0 || loggingMealId === m.id || isLogged}
                      onClick={() => handleQuickLogPlannedMeal(m.id)}
                      className={`flex items-center justify-between gap-2 rounded-[9px] border px-3 py-2 text-left transition-colors ${
                        isLogged
                          ? 'border-[#36C98F]/30 bg-[#36C98F]/10 cursor-default'
                          : 'border-[#252D38] bg-[#0D121A] hover:border-[#B6F36A]/50 disabled:opacity-50 cursor-pointer'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#F5F7FA] truncate">
                          <span className="font-mono text-[#B6F36A] mr-1.5">{m.time}</span>
                          {m.name}
                        </div>
                        <div className="text-[11px] font-mono text-[#929BAA] tabular-nums">
                          {kcal} kcal · {pro}g P
                        </div>
                      </div>
                      {isLogged ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#36C98F] shrink-0">
                          <Check className="h-3.5 w-3.5" />
                          Logged
                        </span>
                      ) : (
                        <Check className="h-4 w-4 shrink-0 text-[#B6F36A]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmitQuickFood} className="space-y-3.5 border-t border-[#202733] pt-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#929BAA]">
                Or Log Extra Single Food Item
              </span>
              <button
                type="button"
                onClick={() => setCreatingFood((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] hover:underline cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                {creatingFood ? 'Pick Existing Food' : 'New Custom Food'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Date"
                type="date"
                value={mealDate}
                onChange={(e) => setMealDate(e.target.value)}
                required
              />
              <Input
                label="Label"
                value={mealLabel}
                onChange={(e) => setMealLabel(e.target.value)}
                placeholder="Extra Food, Snack, Shake"
                required
              />
              <Input
                label="Servings"
                type="number"
                step="0.25"
                min="0.25"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                required
              />
            </div>

            {!creatingFood ? (
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-[#626C7B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={foodSearch}
                    onChange={(e) => setFoodSearch(e.target.value)}
                    placeholder="Filter food library..."
                    className="w-full h-9 rounded-[9px] bg-[#0D121A] border border-[#252D38] pl-8 pr-3 text-xs text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A]"
                  />
                </div>
                <Select
                  label={loadingFoods ? 'Loading foods...' : `Food Item (${filteredFoods.length})`}
                  value={selectedFoodId}
                  onChange={(e) => setSelectedFoodId(e.target.value)}
                  options={
                    filteredFoods.length > 0
                      ? filteredFoods.map((f) => ({
                          value: f.id,
                          label: `${f.name} (${f.servingLabel} · ${f.calories} kcal · ${f.proteinG}g P)`,
                        }))
                      : [{ value: '', label: 'No matching foods — click New Custom Food' }]
                  }
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 rounded-[10px] border border-[#252D38] bg-[#0D121A] p-3">
                <div className="col-span-2 sm:col-span-2">
                  <Input
                    label="Food Name"
                    placeholder="e.g. Whey Isolate"
                    value={newFood.name}
                    onChange={(e) => setNewFood({ ...newFood, name: e.target.value })}
                    required
                  />
                </div>
                <Select
                  label="Category"
                  value={newFood.category}
                  onChange={(e) => setNewFood({ ...newFood, category: e.target.value as DietTag })}
                  options={[
                    { value: 'VEG', label: 'Veg' },
                    { value: 'NON_VEG', label: 'Non-Veg' },
                    { value: 'VEGAN', label: 'Vegan' },
                    { value: 'SUPPLEMENT', label: 'Supplement' },
                  ]}
                />
                <Input
                  label="Serving Label"
                  value={newFood.servingLabel}
                  onChange={(e) => setNewFood({ ...newFood, servingLabel: e.target.value })}
                  required
                />
                <Input
                  label="Calories"
                  type="number"
                  value={newFood.calories}
                  onChange={(e) => setNewFood({ ...newFood, calories: e.target.value })}
                  required
                />
                <Input
                  label="Protein (g)"
                  type="number"
                  step="0.1"
                  value={newFood.proteinG}
                  onChange={(e) => setNewFood({ ...newFood, proteinG: e.target.value })}
                  required
                />
                <Input
                  label="Carbs (g)"
                  type="number"
                  step="0.1"
                  value={newFood.carbsG}
                  onChange={(e) => setNewFood({ ...newFood, carbsG: e.target.value })}
                />
                <Input
                  label="Fat (g)"
                  type="number"
                  step="0.1"
                  value={newFood.fatG}
                  onChange={(e) => setNewFood({ ...newFood, fatG: e.target.value })}
                />
                <Input
                  label="Price (₹)"
                  type="number"
                  step="0.5"
                  value={newFood.priceInr}
                  onChange={(e) => setNewFood({ ...newFood, priceInr: e.target.value })}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={closeQuickLog}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingMeal || (!creatingFood && !selectedFoodId)}>
                {savingMeal ? 'Logging...' : 'Log Extra Food'}
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Quick Log Measurement Modal */}
      <Modal
        open={quickLogModal === 'measurement'}
        onClose={closeQuickLog}
        title="Quick Log Body Check-In"
        subtitle={`Entering in ${wSuffix} and ${mSuffix}. Automatically updates your profile weight.`}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSubmitQuickMeasurement} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Input
              label="Date"
              type="date"
              value={measDate}
              onChange={(e) => setMeasDate(e.target.value)}
              required
            />
            <Input
              label={`Weight (${wSuffix})`}
              type="number"
              step="0.1"
              placeholder={weightUnit === 'LBS' ? '168.5' : '76.4'}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <Input
              label={`Waist (${mSuffix})`}
              type="number"
              step="0.01"
              placeholder={measurePlaceholder(82, measureUnit)}
              value={waist}
              onChange={(e) => setWaist(e.target.value)}
            />
            <Input
              label="Body Fat (%)"
              type="number"
              step="0.1"
              placeholder="16.5"
              value={bodyFatPct}
              onChange={(e) => setBodyFatPct(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAllTape((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B6F36A] hover:underline cursor-pointer"
          >
            {showAllTape ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showAllTape ? 'Hide extra tape metrics' : 'Add Chest, Hips, Arms, Thighs, Neck, Calves & Photo'}
          </button>

          {showAllTape && (
            <div className="space-y-3 rounded-[10px] border border-[#202733] bg-[#0D121A] p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Input
                  label={`Chest (${mSuffix})`}
                  type="number"
                  step="0.01"
                  value={chest}
                  onChange={(e) => setChest(e.target.value)}
                />
                <Input
                  label={`Hips (${mSuffix})`}
                  type="number"
                  step="0.01"
                  value={hips}
                  onChange={(e) => setHips(e.target.value)}
                />
                <Input
                  label={`Arms (${mSuffix})`}
                  type="number"
                  step="0.01"
                  value={arms}
                  onChange={(e) => setArms(e.target.value)}
                />
                <Input
                  label={`Thighs (${mSuffix})`}
                  type="number"
                  step="0.01"
                  value={thighs}
                  onChange={(e) => setThighs(e.target.value)}
                />
                <Input
                  label={`Neck (${mSuffix})`}
                  type="number"
                  step="0.01"
                  value={neck}
                  onChange={(e) => setNeck(e.target.value)}
                />
                <Input
                  label={`Calves (${mSuffix})`}
                  type="number"
                  step="0.01"
                  value={calves}
                  onChange={(e) => setCalves(e.target.value)}
                />
              </div>

              <label className="flex items-center gap-2 rounded-[9px] border border-dashed border-[#252D38] bg-[#121720] px-3 py-2 text-xs text-[#929BAA] hover:border-[#B6F36A] cursor-pointer">
                <Camera className="h-4 w-4 text-[#B6F36A]" />
                <span>{photoDataUrl ? 'Photo attached (replace)' : 'Upload progress photo (max 2 MB)'}</span>
                <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
              </label>
            </div>
          )}

          <Input
            label="Notes (Optional)"
            placeholder="Morning fasted check-in..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={closeQuickLog}>
              Cancel
            </Button>
            <Button type="submit" disabled={savingMeas}>
              {savingMeas ? 'Saving...' : 'Save Check-In'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
