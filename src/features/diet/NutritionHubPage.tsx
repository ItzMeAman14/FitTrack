import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Clock, Plus, Search, Trash2, Utensils } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { DietTag, FoodItem, MealLog, PlannedMeal } from '../../types/fittrack';
import { FoodLibraryPage } from './FoodLibraryPage';
import { SavedPlansPanel } from '../plans/SavedPlansPanel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

type NutritionTab = 'daily' | 'foods' | 'templates';

export function NutritionHubPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { dataVersion, bumpDataVersion } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab');
  const activeTab: NutritionTab =
    rawTab === 'foods' || rawTab === 'templates' ? rawTab : 'daily';

  const setActiveTab = (next: NutritionTab) => {
    setSearchParams({ tab: next }, { replace: true });
  };

  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [plannedMeals, setPlannedMeals] = useState<PlannedMeal[]>([]);
  const [logs, setLogs] = useState<MealLog[]>([]);

  const [newMealOpen, setNewMealOpen] = useState(false);
  const [mealName, setMealName] = useState('');
  const [mealTime, setMealTime] = useState('08:30');

  const [addItemMealId, setAddItemMealId] = useState<string | null>(null);
  const [modalFoodSearch, setModalFoodSearch] = useState('');
  const [selectedFoodId, setSelectedFoodId] = useState('');
  const [servings, setServings] = useState('1');

  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickMealName, setQuickMealName] = useState('Extra Food');
  const [loggingMealId, setLoggingMealId] = useState<string | null>(null);
  const [loggingItemId, setLoggingItemId] = useState<string | null>(null);

  // Inline custom food creation inside Add/Log modals
  const [inlineCreatingFood, setInlineCreatingFood] = useState(false);
  const [customFood, setCustomFood] = useState({
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

  const loadData = useCallback(
    async (date: string) => {
      try {
        const [foodsRes, planRes, logsRes] = await Promise.all([
          api.get<FoodItem[]>('/foods'),
          api.get<PlannedMeal[]>('/diet/plan'),
          api.get<{ date: string; logs: MealLog[] }>(`/diet/logs?date=${date}`),
        ]);
        setFoods(foodsRes.data);
        setPlannedMeals(planRes.data);
        setLogs(logsRes.data.logs);
        setSelectedDate(logsRes.data.date);
        if (foodsRes.data.length > 0 && !selectedFoodId) {
          setSelectedFoodId(foodsRes.data[0].id);
        }
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to load diet data.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [selectedFoodId, showToast]
  );

  useEffect(() => {
    loadData(selectedDate);
  }, [dataVersion]);

  const handleDateChange = (nextDate: string) => {
    setSelectedDate(nextDate);
    loadData(nextDate);
  };

  const filteredModalFoods = foods.filter((f) =>
    f.name.toLowerCase().includes(modalFoodSearch.toLowerCase().trim())
  );

  useEffect(() => {
    if (
      filteredModalFoods.length > 0 &&
      !filteredModalFoods.some((f) => f.id === selectedFoodId)
    ) {
      setSelectedFoodId(filteredModalFoods[0].id);
    }
  }, [filteredModalFoods, selectedFoodId]);

  const createInlineCustomFoodIfNeeded = async (): Promise<string | null> => {
    if (!inlineCreatingFood) return selectedFoodId || null;
    const created = await api.post<FoodItem>('/foods', {
      name: customFood.name.trim(),
      category: customFood.category,
      servingLabel: customFood.servingLabel.trim(),
      servingGrams: Number(customFood.servingGrams) || 100,
      calories: Number(customFood.calories) || 0,
      proteinG: Number(customFood.proteinG) || 0,
      carbsG: Number(customFood.carbsG) || 0,
      fatG: Number(customFood.fatG) || 0,
      priceInr: Number(customFood.priceInr) || 0,
    });
    setInlineCreatingFood(false);
    setCustomFood({
      name: '',
      category: 'VEG',
      servingLabel: '100g',
      servingGrams: '100',
      calories: '',
      proteinG: '',
      carbsG: '0',
      fatG: '0',
      priceInr: '0',
    });
    return created.data.id;
  };

  const handleCreateMealSlot = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/diet/meals', { name: mealName.trim(), time: mealTime, items: [] });
      setMealName('');
      setNewMealOpen(false);
      bumpDataVersion('diet');
      showToast('Meal slot created.', 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add meal slot.', 'error');
    }
  };

  const handleAddItemToPlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!addItemMealId) return;
    try {
      const foodId = await createInlineCustomFoodIfNeeded();
      if (!foodId) return;
      await api.post(`/diet/meals/${addItemMealId}/items`, {
        foodId,
        servings: Number(servings),
      });
      setAddItemMealId(null);
      setModalFoodSearch('');
      setServings('1');
      bumpDataVersion('diet');
      showToast('Food added to planned meal.', 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add food.', 'error');
    }
  };

  const handleRemovePlannedItem = async (mealId: string, itemId: string) => {
    try {
      await api.delete(`/diet/meals/${mealId}/items/${itemId}`);
      bumpDataVersion('diet');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to remove item.', 'error');
    }
  };

  const handleDeleteMealSlot = async (mealId: string) => {
    try {
      await api.delete(`/diet/meals/${mealId}`);
      bumpDataVersion('diet');
      showToast('Meal slot removed.', 'info');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete meal.', 'error');
    }
  };

  const handleLogEntireMeal = async (mealId: string) => {
    setLoggingMealId(mealId);
    try {
      await api.post(`/diet/meals/${mealId}/log-all`, { date: selectedDate });
      bumpDataVersion('diet');
      showToast('Planned meal logged to daily intake.', 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log meal.', 'error');
    } finally {
      setLoggingMealId(null);
    }
  };

  const handleLogPlannedItem = async (meal: PlannedMeal, item: PlannedMeal['items'][number]) => {
    setLoggingItemId(item.id);
    try {
      await api.post('/diet/logs', {
        date: selectedDate,
        mealName: meal.name,
        time: meal.time,
        foodId: item.foodId,
        servings: item.servings,
        plannedMealId: meal.id,
      });
      bumpDataVersion('diet');
      showToast(`${item.foodName} logged to ${meal.name}.`, 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log food item.', 'error');
    } finally {
      setLoggingItemId(null);
    }
  };

  const handleQuickLogFood = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const foodId = await createInlineCustomFoodIfNeeded();
      if (!foodId) return;
      await api.post('/diet/logs', {
        date: selectedDate,
        mealName: quickMealName.trim() || 'Extra Food',
        foodId,
        servings: Number(servings),
        plannedMealId: null,
      });
      setQuickLogOpen(false);
      setModalFoodSearch('');
      setServings('1');
      bumpDataVersion('diet');
      showToast('Extra food logged.', 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log food.', 'error');
    }
  };

  const handleDeleteLog = async (logId: string) => {
    try {
      await api.delete(`/diet/logs/${logId}`);
      setLogs((prev) => prev.filter((l) => l.id !== logId));
      bumpDataVersion('diet');
      showToast('Log entry deleted.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete log.', 'error');
    }
  };

  const handleLogFromLibrary = (food: FoodItem) => {
    setSelectedFoodId(food.id);
    setQuickMealName('Extra Food');
    setModalFoodSearch('');
    setInlineCreatingFood(false);
    setServings('1');
    setQuickLogOpen(true);
  };

  const getMealLogStatus = (meal: PlannedMeal) => {
    const counts = new Map<string, number>();
    for (const log of logs) {
      if (log.plannedMealId !== meal.id || !log.foodId) continue;
      counts.set(log.foodId, (counts.get(log.foodId) ?? 0) + 1);
    }
    const loggedItemIds = new Set<string>();
    const remainingItems: PlannedMeal['items'] = [];
    for (const item of meal.items) {
      const count = counts.get(item.foodId) ?? 0;
      if (count > 0) {
        counts.set(item.foodId, count - 1);
        loggedItemIds.add(item.id);
      } else {
        remainingItems.push(item);
      }
    }
    return {
      loggedItemIds,
      remainingItems,
      isFullyLogged: meal.items.length > 0 && remainingItems.length === 0,
      isPartiallyLogged: loggedItemIds.size > 0 && remainingItems.length > 0,
    };
  };

  if (loading) return <LoadingSpinner label="Loading Nutrition hub..." />;

  const profile = user?.profile;
  const totals = logs.reduce(
    (acc, l) => ({
      calories: acc.calories + l.calories,
      proteinG: acc.proteinG + l.proteinG,
      carbsG: acc.carbsG + l.carbsG,
      fatG: acc.fatG + l.fatG,
      priceInr: acc.priceInr + l.priceInr,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, priceInr: 0 }
  );

  return (
    <div className="space-y-4">
      {/* Unified Hub Switcher + Live Macro Summary Bar */}
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-[9px] bg-[#0D121A] border border-[#252D38] w-fit">
            {[
              { id: 'daily' as const, label: 'Daily Plan & Log' },
              { id: 'foods' as const, label: `Food Library (${foods.length})` },
              { id: 'templates' as const, label: 'Diet Templates' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-[7px] transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-[#26351D] text-[#B6F36A]'
                    : 'text-[#929BAA] hover:text-[#F5F7FA]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'daily' && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="h-9 rounded-[9px] bg-[#0D121A] border border-[#252D38] px-3 text-xs font-mono text-[#F5F7FA] focus:outline-none focus:border-[#B6F36A]"
              />
              <Button size="sm" variant="secondary" onClick={() => setNewMealOpen(true)}>
                <Clock className="h-3.5 w-3.5 text-[#B6F36A]" />
                Add Meal Slot
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setInlineCreatingFood(false);
                  setQuickMealName('Extra Food');
                  setModalFoodSearch('');
                  setQuickLogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Log Extra Food
              </Button>
            </div>
          )}
        </div>

        {/* Always-visible Daily Macro & Spend Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-[#202733]">
          <div>
            <div className="text-[11px] text-[#929BAA]">Calories ({selectedDate})</div>
            <div className="font-mono text-base font-semibold text-[#F3B84B] tabular-nums">
              {Math.round(totals.calories)}
              <span className="text-xs font-normal text-[#626C7B]">
                {' '}
                / {profile?.dailyCalorieTarget ?? '—'}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Protein</div>
            <div className="font-mono text-base font-semibold text-[#62A8F7] tabular-nums">
              {totals.proteinG.toFixed(1)}g
              <span className="text-xs font-normal text-[#626C7B]">
                {' '}
                / {profile?.dailyProteinTargetG ?? '—'}g
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Carbs</div>
            <div className="font-mono text-base font-semibold text-[#A88AF5] tabular-nums">
              {totals.carbsG.toFixed(1)}g
              <span className="text-xs font-normal text-[#626C7B]">
                {' '}
                / {profile?.dailyCarbTargetG ?? '—'}g
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Fats</div>
            <div className="font-mono text-base font-semibold text-[#F18C72] tabular-nums">
              {totals.fatG.toFixed(1)}g
              <span className="text-xs font-normal text-[#626C7B]">
                {' '}
                / {profile?.dailyFatTargetG ?? '—'}g
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Daily Spend</div>
            <div className="font-mono text-base font-semibold text-[#39C9BA] tabular-nums">
              ₹{Math.round(totals.priceInr)}
            </div>
          </div>
        </div>
      </Card>

      {activeTab === 'daily' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Card className="lg:col-span-7 p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                Daily Diet Plan (Templates & Timings)
              </h2>
              <p className="text-xs text-[#929BAA]">
                Design timed meal slots and mark them eaten with one click.
              </p>
            </div>

            {plannedMeals.length === 0 ? (
              <EmptyState
                icon={Utensils}
                title="No planned meal slots yet"
                description="Create timed meals like 08:30 Breakfast or 13:30 Lunch and add foods from your library."
                action={
                  <Button size="sm" variant="secondary" onClick={() => setNewMealOpen(true)}>
                    Create First Meal Slot
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-[#202733]">
                {plannedMeals.map((meal) => {
                  const mealKcal = Math.round(meal.items.reduce((s, i) => s + i.calories, 0));
                  const mealPro = Math.round(meal.items.reduce((s, i) => s + i.proteinG, 0));
                  const mealCost = Math.round(meal.items.reduce((s, i) => s + i.priceInr, 0));
                  const { loggedItemIds, remainingItems, isFullyLogged, isPartiallyLogged } =
                    getMealLogStatus(meal);

                  return (
                    <div key={meal.id} className="py-3.5 first:pt-0 last:pb-0 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-[#B6F36A] tabular-nums">
                              {meal.time}
                            </span>
                            <h3 className="text-sm font-semibold text-[#F5F7FA]">{meal.name}</h3>
                          </div>
                          <p className="font-mono text-xs text-[#929BAA] tabular-nums mt-0.5">
                            {mealKcal} kcal · {mealPro}g protein · ₹{mealCost}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setInlineCreatingFood(false);
                              setModalFoodSearch('');
                              setAddItemMealId(meal.id);
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Food
                          </Button>
                          {isFullyLogged ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-[9px] border border-[#36C98F]/30 bg-[#36C98F]/10 px-2.5 py-1.5 text-xs font-medium text-[#36C98F]"
                              title="Already logged for this date"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Logged
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={meal.items.length === 0 || loggingMealId === meal.id}
                              onClick={() => handleLogEntireMeal(meal.id)}
                            >
                              <Check className="h-3.5 w-3.5" />
                              {loggingMealId === meal.id
                                ? 'Logging...'
                                : isPartiallyLogged
                                  ? `Log Remaining (${remainingItems.length})`
                                  : 'Mark Eaten'}
                            </Button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteMealSlot(meal.id)}
                            className="p-2 rounded-md text-[#626C7B] hover:text-[#F16C75] hover:bg-[#171E29] cursor-pointer"
                            aria-label={`Delete ${meal.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {meal.items.length > 0 && (
                        <div className="space-y-1 pl-3 border-l border-[#252D38]">
                          {meal.items.map((item) => {
                            const itemLogged = loggedItemIds.has(item.id);
                            return (
                              <div
                                key={item.id}
                                className="flex items-center justify-between text-xs py-1 gap-2"
                              >
                                <div className="text-[#F5F7FA] min-w-0 truncate">
                                  <span>{item.foodName}</span>
                                  <span className="text-[#626C7B] ml-2">
                                    {item.servings} × {item.servingLabel}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 font-mono tabular-nums text-[#929BAA] shrink-0">
                                  <span>{item.calories} kcal</span>
                                  <span className="text-[#62A8F7]">{item.proteinG}g P</span>
                                  <span className="text-[#39C9BA] hidden sm:inline">₹{item.priceInr}</span>
                                  {itemLogged ? (
                                    <span className="inline-flex items-center gap-0.5 font-sans text-[11px] font-medium text-[#36C98F]">
                                      <Check className="h-3 w-3" />
                                      Logged
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={loggingItemId === item.id}
                                      onClick={() => handleLogPlannedItem(meal, item)}
                                      className="font-sans text-[11px] font-medium text-[#B6F36A] hover:underline disabled:opacity-50 cursor-pointer"
                                    >
                                      {loggingItemId === item.id ? '...' : 'Log'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePlannedItem(meal.id, item.id)}
                                    className="text-[#626C7B] hover:text-[#F16C75] cursor-pointer"
                                    aria-label={`Remove ${item.foodName}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="lg:col-span-5 p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                Logged Intake ({selectedDate})
              </h2>
              <p className="text-xs text-[#929BAA]">Actual foods consumed on this date.</p>
            </div>

            {logs.length === 0 ? (
              <EmptyState
                title="Nothing logged for this date"
                description="Click Mark Eaten on a planned meal or use Log Food to record intake."
              />
            ) : (
              <div className="divide-y divide-[#202733]">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#F5F7FA] truncate">
                        {log.foodName}
                      </div>
                      <div className="text-xs text-[#626C7B]">
                        {log.mealName} · {log.servings} × {log.servingLabel}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="text-right font-mono text-xs tabular-nums">
                        <div className="text-[#F3B84B]">{log.calories} kcal</div>
                        <div className="text-[#62A8F7]">
                          {log.proteinG}g P · ₹{log.priceInr}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteLog(log.id)}
                        className="p-1.5 text-[#626C7B] hover:text-[#F16C75] cursor-pointer"
                        aria-label={`Delete ${log.foodName} log`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'foods' && (
        <FoodLibraryPage
          onQuickLogFood={handleLogFromLibrary}
          onLibraryChanged={() => loadData(selectedDate)}
        />
      )}

      {activeTab === 'templates' && (
        <SavedPlansPanel
          planType="DIET"
          onPlanApplied={() => {
            setActiveTab('daily');
            loadData(selectedDate);
          }}
        />
      )}

      {/* Add Meal Slot Modal */}
      <Modal
        open={newMealOpen}
        onClose={() => setNewMealOpen(false)}
        title="Add Planned Meal Slot"
        subtitle="Set a custom meal name and target time."
      >
        <form onSubmit={handleCreateMealSlot} className="space-y-4">
          <Input
            label="Meal Name"
            placeholder="e.g. Post-Workout Shake"
            value={mealName}
            onChange={(e) => setMealName(e.target.value)}
            required
          />
          <Input
            label="Scheduled Time"
            type="time"
            value={mealTime}
            onChange={(e) => setMealTime(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewMealOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Meal Slot</Button>
          </div>
        </form>
      </Modal>

      {/* Add Food to Planned Meal Modal (with Search + Inline Custom Food) */}
      <Modal
        open={Boolean(addItemMealId)}
        onClose={() => setAddItemMealId(null)}
        title="Add Food to Meal Slot"
      >
        <form onSubmit={handleAddItemToPlan} className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#929BAA]">Pick from library or create inline</span>
            <button
              type="button"
              onClick={() => setInlineCreatingFood((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] hover:underline cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              {inlineCreatingFood ? 'Select Existing Food' : 'New Custom Food'}
            </button>
          </div>

          {!inlineCreatingFood ? (
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-[#626C7B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={modalFoodSearch}
                  onChange={(e) => setModalFoodSearch(e.target.value)}
                  placeholder="Search foods..."
                  className="w-full h-9 rounded-[9px] bg-[#0D121A] border border-[#252D38] pl-8 pr-3 text-xs text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A]"
                />
              </div>
              <Select
                label={`Select Food (${filteredModalFoods.length})`}
                value={selectedFoodId}
                onChange={(e) => setSelectedFoodId(e.target.value)}
                options={
                  filteredModalFoods.length > 0
                    ? filteredModalFoods.map((f) => ({
                        value: f.id,
                        label: `${f.name} (${f.servingLabel} · ${f.calories} kcal · ${f.proteinG}g P)`,
                      }))
                    : [{ value: '', label: 'No matching foods found' }]
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 rounded-[10px] border border-[#252D38] bg-[#0D121A] p-3">
              <div className="col-span-2">
                <Input
                  label="Food Name"
                  value={customFood.name}
                  onChange={(e) => setCustomFood({ ...customFood, name: e.target.value })}
                  required
                />
              </div>
              <Input
                label="Serving Label"
                value={customFood.servingLabel}
                onChange={(e) => setCustomFood({ ...customFood, servingLabel: e.target.value })}
                required
              />
              <Input
                label="Calories"
                type="number"
                value={customFood.calories}
                onChange={(e) => setCustomFood({ ...customFood, calories: e.target.value })}
                required
              />
              <Input
                label="Protein (g)"
                type="number"
                step="0.1"
                value={customFood.proteinG}
                onChange={(e) => setCustomFood({ ...customFood, proteinG: e.target.value })}
                required
              />
              <Input
                label="Price (₹)"
                type="number"
                step="0.5"
                value={customFood.priceInr}
                onChange={(e) => setCustomFood({ ...customFood, priceInr: e.target.value })}
              />
            </div>
          )}

          <Input
            label="Servings / Quantity"
            type="number"
            step="0.25"
            min="0.25"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddItemMealId(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!inlineCreatingFood && !selectedFoodId}>
              Add to Meal
            </Button>
          </div>
        </form>
      </Modal>

      {/* Ad-hoc Extra Single Food Modal */}
      <Modal
        open={quickLogOpen}
        onClose={() => setQuickLogOpen(false)}
        title="Log Extra Food Item"
        subtitle={`Record a single extra food item for ${selectedDate} (always allowed)`}
      >
        <form onSubmit={handleQuickLogFood} className="space-y-4">
          <div className="flex items-center justify-between">
            <Input
              label="Label"
              placeholder="e.g. Extra Food, Snack, Post-Workout"
              value={quickMealName}
              onChange={(e) => setQuickMealName(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[#929BAA]">Food Selection</span>
            <button
              type="button"
              onClick={() => setInlineCreatingFood((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] hover:underline cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              {inlineCreatingFood ? 'Select Existing Food' : 'New Custom Food'}
            </button>
          </div>

          {!inlineCreatingFood ? (
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-[#626C7B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={modalFoodSearch}
                  onChange={(e) => setModalFoodSearch(e.target.value)}
                  placeholder="Search foods..."
                  className="w-full h-9 rounded-[9px] bg-[#0D121A] border border-[#252D38] pl-8 pr-3 text-xs text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A]"
                />
              </div>
              <Select
                label={`Food Item (${filteredModalFoods.length})`}
                value={selectedFoodId}
                onChange={(e) => setSelectedFoodId(e.target.value)}
                options={
                  filteredModalFoods.length > 0
                    ? filteredModalFoods.map((f) => ({
                        value: f.id,
                        label: `${f.name} (${f.servingLabel} · ${f.calories} kcal · ₹${f.priceInr})`,
                      }))
                    : [{ value: '', label: 'No matching foods found' }]
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 rounded-[10px] border border-[#252D38] bg-[#0D121A] p-3">
              <div className="col-span-2">
                <Input
                  label="Food Name"
                  value={customFood.name}
                  onChange={(e) => setCustomFood({ ...customFood, name: e.target.value })}
                  required
                />
              </div>
              <Input
                label="Serving Label"
                value={customFood.servingLabel}
                onChange={(e) => setCustomFood({ ...customFood, servingLabel: e.target.value })}
                required
              />
              <Input
                label="Calories"
                type="number"
                value={customFood.calories}
                onChange={(e) => setCustomFood({ ...customFood, calories: e.target.value })}
                required
              />
              <Input
                label="Protein (g)"
                type="number"
                step="0.1"
                value={customFood.proteinG}
                onChange={(e) => setCustomFood({ ...customFood, proteinG: e.target.value })}
                required
              />
              <Input
                label="Price (₹)"
                type="number"
                step="0.5"
                value={customFood.priceInr}
                onChange={(e) => setCustomFood({ ...customFood, priceInr: e.target.value })}
              />
            </div>
          )}

          <Input
            label="Servings"
            type="number"
            step="0.25"
            min="0.25"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setQuickLogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!inlineCreatingFood && !selectedFoodId}>
              Log Extra Food
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
