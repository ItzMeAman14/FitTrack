import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Clock, Plus, Trash2, Utensils } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { FoodItem, MealLog, PlannedMeal } from '../../types/fittrack';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

export function DietPlannerPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [plannedMeals, setPlannedMeals] = useState<PlannedMeal[]>([]);
  const [logs, setLogs] = useState<MealLog[]>([]);

  const [newMealOpen, setNewMealOpen] = useState(false);
  const [mealName, setMealName] = useState('');
  const [mealTime, setMealTime] = useState('08:30');

  const [addItemMealId, setAddItemMealId] = useState<string | null>(null);
  const [selectedFoodId, setSelectedFoodId] = useState('');
  const [servings, setServings] = useState('1');

  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickMealName, setQuickMealName] = useState('Extra Food');

  const loadData = useCallback(async (date: string) => {
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
  }, [selectedFoodId, showToast]);

  useEffect(() => {
    loadData(selectedDate);
  }, []);

  const handleDateChange = (nextDate: string) => {
    setSelectedDate(nextDate);
    loadData(nextDate);
  };

  const handleCreateMealSlot = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/diet/meals', { name: mealName.trim(), time: mealTime, items: [] });
      setMealName('');
      setNewMealOpen(false);
      showToast('Meal slot created.', 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add meal slot.', 'error');
    }
  };

  const handleAddItemToPlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!addItemMealId || !selectedFoodId) return;
    try {
      await api.post(`/diet/meals/${addItemMealId}/items`, {
        foodId: selectedFoodId,
        servings: Number(servings),
      });
      setAddItemMealId(null);
      setServings('1');
      showToast('Food added to planned meal.', 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add food.', 'error');
    }
  };

  const handleRemovePlannedItem = async (mealId: string, itemId: string) => {
    try {
      await api.delete(`/diet/meals/${mealId}/items/${itemId}`);
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to remove item.', 'error');
    }
  };

  const handleDeleteMealSlot = async (mealId: string) => {
    try {
      await api.delete(`/diet/meals/${mealId}`);
      showToast('Meal slot removed.', 'info');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete meal.', 'error');
    }
  };

  const handleLogEntireMeal = async (mealId: string) => {
    try {
      await api.post(`/diet/meals/${mealId}/log-all`, { date: selectedDate });
      showToast('Planned meal logged to daily intake.', 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log meal.', 'error');
    }
  };

  const handleQuickLogFood = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFoodId) return;
    try {
      await api.post('/diet/logs', {
        date: selectedDate,
        mealName: quickMealName.trim() || 'Extra Food',
        foodId: selectedFoodId,
        servings: Number(servings),
        plannedMealId: null,
      });
      setQuickLogOpen(false);
      setServings('1');
      showToast('Food logged.', 'success');
      await loadData(selectedDate);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log food.', 'error');
    }
  };

  const handleDeleteLog = async (logId: string) => {
    try {
      await api.delete(`/diet/logs/${logId}`);
      setLogs((prev) => prev.filter((l) => l.id !== logId));
      showToast('Log entry deleted.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete log.', 'error');
    }
  };

  if (loading) return <LoadingSpinner label="Loading diet planner..." />;

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
    <div className="space-y-6">
      {/* Top Controls & Daily Summary */}
      <Card className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 flex-1">
          <div>
            <div className="text-[11px] text-[#929BAA]">Calories</div>
            <div className="font-mono text-base font-semibold text-[#F3B84B] tabular-nums mt-0.5">
              {Math.round(totals.calories)}
              <span className="text-xs font-normal text-[#626C7B]">
                {' '}
                / {profile?.dailyCalorieTarget ?? '—'}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Protein</div>
            <div className="font-mono text-base font-semibold text-[#62A8F7] tabular-nums mt-0.5">
              {totals.proteinG.toFixed(1)}g
              <span className="text-xs font-normal text-[#626C7B]">
                {' '}
                / {profile?.dailyProteinTargetG ?? '—'}g
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Carbs</div>
            <div className="font-mono text-base font-semibold text-[#A88AF5] tabular-nums mt-0.5">
              {totals.carbsG.toFixed(1)}g
              <span className="text-xs font-normal text-[#626C7B]">
                {' '}
                / {profile?.dailyCarbTargetG ?? '—'}g
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Fats</div>
            <div className="font-mono text-base font-semibold text-[#F18C72] tabular-nums mt-0.5">
              {totals.fatG.toFixed(1)}g
              <span className="text-xs font-normal text-[#626C7B]">
                {' '}
                / {profile?.dailyFatTargetG ?? '—'}g
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Daily Spend</div>
            <div className="font-mono text-base font-semibold text-[#39C9BA] tabular-nums mt-0.5">
              ₹{Math.round(totals.priceInr)}
            </div>
          </div>
        </div>

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
          <Button size="sm" onClick={() => setQuickLogOpen(true)}>
            <Plus className="h-4 w-4" />
            Log Extra Food
          </Button>
        </div>
      </Card>

      {/* Main Split: Planned Daily Schedule vs Actual Consumption Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                Daily Diet Plan (Templates & Timings)
              </h2>
              <p className="text-xs text-[#929BAA]">
                Design your timed meal slots and mark them eaten with one click.
              </p>
            </div>
          </div>

          {plannedMeals.length === 0 ? (
            <EmptyState
              icon={Utensils}
              title="No planned meal slots yet"
              description="Create timed meals like 08:30 Breakfast or 13:30 Lunch and add foods from your Food Library."
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
                const isLogged = logs.some((l) => l.plannedMealId === meal.id);

                return (
                  <div key={meal.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
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
                          onClick={() => setAddItemMealId(meal.id)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Food
                        </Button>
                        {isLogged ? (
                          <span className="inline-flex items-center gap-1 rounded-[9px] border border-[#36C98F]/30 bg-[#36C98F]/10 px-2.5 py-1.5 text-xs font-medium text-[#36C98F]">
                            <Check className="h-3.5 w-3.5" />
                            Logged
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={meal.items.length === 0}
                            onClick={() => handleLogEntireMeal(meal.id)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Mark Eaten
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
                      <div className="space-y-1.5 pl-3 border-l border-[#252D38]">
                        {meal.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between text-xs py-1"
                          >
                            <div className="text-[#F5F7FA]">
                              <span>{item.foodName}</span>
                              <span className="text-[#626C7B] ml-2">
                                {item.servings} × {item.servingLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 font-mono tabular-nums text-[#929BAA]">
                              <span>{item.calories} kcal</span>
                              <span className="text-[#62A8F7]">{item.proteinG}g P</span>
                              <span className="text-[#39C9BA]">₹{item.priceInr}</span>
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
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-5 space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              Logged Intake ({selectedDate})
            </h2>
            <p className="text-xs text-[#929BAA]">
              Actual foods consumed on this date.
            </p>
          </div>

          {logs.length === 0 ? (
            <EmptyState
              title="Nothing logged for this date"
              description="Click Mark Eaten on a planned meal or use Log Food to record ad-hoc intake."
            />
          ) : (
            <div className="divide-y divide-[#202733]">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#F5F7FA] truncate">
                      {log.foodName}
                    </div>
                    <div className="text-xs text-[#626C7B]">
                      {log.mealName} · {log.servings} × {log.servingLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
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

      {/* Add Food to Planned Meal Modal */}
      <Modal
        open={Boolean(addItemMealId)}
        onClose={() => setAddItemMealId(null)}
        title="Add Food to Meal Slot"
      >
        <form onSubmit={handleAddItemToPlan} className="space-y-4">
          <Select
            label="Select Food"
            value={selectedFoodId}
            onChange={(e) => setSelectedFoodId(e.target.value)}
            options={foods.map((f) => ({
              value: f.id,
              label: `${f.name} (${f.servingLabel} · ${f.calories} kcal · ${f.proteinG}g P)`,
            }))}
          />
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
            <Button type="submit">Add to Meal</Button>
          </div>
        </form>
      </Modal>

      {/* Quick Ad-hoc Log Modal */}
      <Modal
        open={quickLogOpen}
        onClose={() => setQuickLogOpen(false)}
        title="Log Food Consumption"
        subtitle={`Recording intake for ${selectedDate}`}
      >
        <form onSubmit={handleQuickLogFood} className="space-y-4">
          <Input
            label="Meal Label"
            placeholder="e.g. Breakfast, Lunch, Snack"
            value={quickMealName}
            onChange={(e) => setQuickMealName(e.target.value)}
            required
          />
          <Select
            label="Food Item"
            value={selectedFoodId}
            onChange={(e) => setSelectedFoodId(e.target.value)}
            options={foods.map((f) => ({
              value: f.id,
              label: `${f.name} (${f.servingLabel} · ${f.calories} kcal · ₹${f.priceInr})`,
            }))}
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
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setQuickLogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Log Food</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
