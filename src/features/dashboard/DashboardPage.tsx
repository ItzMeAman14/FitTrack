import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  Check,
  Dumbbell,
  Play,
  Plus,
  Ruler,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { api } from '../../services/api';
import type { DashboardOverview } from '../../types/fittrack';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { formatMeasure, kgToDisplay, measureUnitSuffix, weightUnitSuffix } from '../../utils/units';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

export function DashboardPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { dataVersion, openQuickLog, openAiDrawer } = useWorkspace();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loggingMealId, setLoggingMealId] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<DashboardOverview>('/dashboard/overview?range=7D');
      setData(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load today overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview, dataVersion]);

  const handleLogPlannedMeal = async (mealId: string, isoDate: string) => {
    setLoggingMealId(mealId);
    try {
      await api.post(`/diet/meals/${mealId}/log-all`, { date: isoDate });
      showToast('Meal logged to today’s nutrition.', 'success');
      await fetchOverview();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to log meal.', 'error');
    } finally {
      setLoggingMealId(null);
    }
  };

  if (loading && !data) return <LoadingSpinner label="Loading today's cockpit..." />;

  if (error && !data) {
    return (
      <Card>
        <div className="text-center py-8 space-y-3">
          <p className="text-sm text-[#F16C75]">{error}</p>
          <Button variant="secondary" onClick={fetchOverview}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const {
    welcome,
    overviewCards,
    nutrition,
    todaysSchedule,
    workoutOverview,
    measurementOverview,
  } = data;

  const activeWeightUnit = user?.profile?.preferredWeightUnit || overviewCards.weightUnit;
  const activeMeasureUnit = user?.profile?.preferredMeasureUnit || measurementOverview.unit;
  const weightLabel = weightUnitSuffix(activeWeightUnit);
  const measureLabel = measureUnitSuffix(activeMeasureUnit);
  const currencySymbol = overviewCards.currency === 'INR' ? '₹' : '$';
  const formatWeight = (kg: number | null) => {
    if (kg === null) return 'Not set';
    return `${kgToDisplay(kg, activeWeightUnit)} ${weightLabel}`;
  };
  const formatMeasureDisplay = (cm: number | null | undefined) =>
    formatMeasure(cm ?? null, activeMeasureUnit);

  const weightChangeDisplay =
    overviewCards.weightLostKg !== null
      ? `${overviewCards.weightLostKg >= 0 ? '-' : '+'}${
          activeWeightUnit === 'LBS'
            ? (Math.abs(overviewCards.weightLostKg) * 2.20462).toFixed(1)
            : Math.abs(overviewCards.weightLostKg)
        } ${weightLabel}`
      : null;

  const caloriePct = nutrition.caloriesTarget
    ? Math.min(100, Math.round((nutrition.caloriesConsumed / nutrition.caloriesTarget) * 100))
    : 0;
  const proteinPct = nutrition.proteinTargetG
    ? Math.min(100, Math.round((nutrition.proteinConsumedG / nutrition.proteinTargetG) * 100))
    : 0;

  return (
    <div className="space-y-4">
      {/* Compact Today Command Strip */}
      <Card className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#929BAA]">
            <span className="font-medium text-[#B6F36A]">{welcome.formattedDate}</span>
            <span aria-hidden="true">·</span>
            <span>{welcome.timezone}</span>
            {overviewCards.currentWeightKg !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[#F5F7FA] tabular-nums">
                  {formatWeight(overviewCards.currentWeightKg)}
                  {overviewCards.targetWeightKg !== null
                    ? ` → ${formatWeight(overviewCards.targetWeightKg)}`
                    : ''}
                  {weightChangeDisplay ? ` (${weightChangeDisplay})` : ''}
                </span>
              </>
            )}
          </div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-[#F5F7FA]">
            {welcome.greeting}, {welcome.name}
          </h2>
          <p className="text-xs sm:text-sm text-[#929BAA]">{welcome.motivation}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={() => openQuickLog('meal')}>
            <Utensils className="h-3.5 w-3.5 text-[#F3B84B]" />
            Log Meal
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openQuickLog('measurement')}>
            <Ruler className="h-3.5 w-3.5 text-[#39C9BA]" />
            Log Weight
          </Button>
          {todaysSchedule.workout && !todaysSchedule.workout.isRestDay ? (
            <Link to="/training?tab=split&autostart=1">
              <Button size="sm">
                <Play className="h-3.5 w-3.5" />
                {todaysSchedule.workout.completedToday ? 'Log Extra Session' : 'Start Workout'}
              </Button>
            </Link>
          ) : (
            <Button size="sm" onClick={openAiDrawer}>
              <Sparkles className="h-3.5 w-3.5" />
              Ask AI Coach
            </Button>
          )}
        </div>
      </Card>

      {/* Primary Row: Today's Meal Checklist (7 cols) + Live Nutrition & Spend (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-7 p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-[#F5F7FA]">
                Today&apos;s Meal Checklist
              </h3>
              <p className="text-xs text-[#929BAA]">
                One-click log planned meals or open Nutrition to adjust timings
              </p>
            </div>
            <Link
              to="/nutrition"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] hover:underline whitespace-nowrap shrink-0"
            >
              Nutrition Hub <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {todaysSchedule.meals.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No planned meal slots yet"
              description="Create timed meals in Nutrition to check them off in one tap here."
              action={
                <Link to="/nutrition">
                  <Button variant="secondary" size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    Open Nutrition
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-[#202733]">
              {todaysSchedule.meals.map((meal) => (
                <div
                  key={meal.id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#B6F36A] tabular-nums">
                        {meal.time}
                      </span>
                      <span className="text-sm font-medium text-[#F5F7FA] truncate">
                        {meal.name}
                      </span>
                    </div>
                    <p className="text-xs text-[#929BAA] font-mono tabular-nums mt-0.5">
                      {meal.itemCount} items · {meal.plannedCalories} kcal · {meal.plannedProteinG}g P
                    </p>
                  </div>
                  {meal.loggedToday ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-[#36C98F] whitespace-nowrap shrink-0">
                      <Check className="h-3.5 w-3.5" /> Logged
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={loggingMealId === meal.id || meal.itemCount === 0}
                      onClick={() => handleLogPlannedMeal(meal.id, welcome.isoDate)}
                    >
                      {loggingMealId === meal.id ? 'Logging...' : 'Mark Eaten'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-5 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-[#F5F7FA]">
                Daily Nutrition & Spend
              </h3>
              <p className="text-xs text-[#929BAA]">Actual intake vs daily target</p>
            </div>
            <span className="font-mono text-xs font-medium text-[#B6F36A] tabular-nums whitespace-nowrap">
              {nutrition.caloriesTarget ? `${caloriePct}% of goal` : 'No target'}
            </span>
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-[#929BAA]">Calories</span>
                <span className="font-mono text-[#F5F7FA] font-medium tabular-nums">
                  {nutrition.caloriesConsumed} / {nutrition.caloriesTarget ?? '—'} kcal
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#171E29] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#F3B84B] transition-all"
                  style={{ width: `${caloriePct}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-[#929BAA]">Protein</span>
                <span className="font-mono text-[#F5F7FA] font-medium tabular-nums">
                  {nutrition.proteinConsumedG}g / {nutrition.proteinTargetG ?? '—'}g
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#171E29] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#62A8F7] transition-all"
                  style={{ width: `${proteinPct}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2.5 border-t border-[#202733]">
              <div>
                <div className="text-[11px] text-[#929BAA]">Carbs</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-[#A88AF5] tabular-nums">
                  {nutrition.carbsConsumedG}g
                  <span className="text-[11px] font-normal text-[#626C7B]">
                    /{nutrition.carbsTargetG ?? '—'}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#929BAA]">Fats</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-[#F18C72] tabular-nums">
                  {nutrition.fatConsumedG}g
                  <span className="text-[11px] font-normal text-[#626C7B]">
                    /{nutrition.fatTargetG ?? '—'}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#929BAA]">Today Spend</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-[#39C9BA] tabular-nums">
                  {currencySymbol}
                  {overviewCards.todaysFoodExpense}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Secondary Row: Today's Training (6 cols) + Latest Body Check-In (6 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-[#F5F7FA]">
                Today&apos;s Training
              </h3>
              <p className="text-xs font-mono text-[#929BAA] tabular-nums">
                {workoutOverview.weeklyCompletedCount}/{workoutOverview.weeklyTargetCount} sessions
                completed this week
              </p>
            </div>
            <Link
              to="/training"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] hover:underline whitespace-nowrap shrink-0"
            >
              Training Hub <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {workoutOverview.todaysWorkout ? (
            <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#202733] bg-[#0D121A] p-3.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#F5F7FA] truncate">
                  {workoutOverview.todaysWorkout.title}
                </div>
                <div className="text-xs text-[#929BAA] font-mono tabular-nums mt-0.5">
                  {workoutOverview.todaysWorkout.durationMinutes} min ·{' '}
                  {workoutOverview.todaysWorkout.totalVolumeKg.toLocaleString()} kg volume
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#36C98F] whitespace-nowrap shrink-0">
                <Check className="h-3.5 w-3.5" /> Completed
              </span>
            </div>
          ) : todaysSchedule.workout ? (
            <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#202733] bg-[#0D121A] p-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[#62A8F7]">
                    {todaysSchedule.workout.day}
                  </span>
                  <span className="text-sm font-semibold text-[#F5F7FA] truncate">
                    {todaysSchedule.workout.focus}
                  </span>
                </div>
                <p className="text-xs text-[#929BAA] mt-0.5">
                  {todaysSchedule.workout.isRestDay
                    ? 'Scheduled recovery day'
                    : `${todaysSchedule.workout.exerciseCount} exercises queued`}
                </p>
              </div>
              {!todaysSchedule.workout.isRestDay && (
                <Link to="/training?tab=split&autostart=1">
                  <Button size="sm">
                    <Play className="h-3.5 w-3.5" />
                    Start
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Dumbbell}
              title="No workout scheduled today"
              description="Configure your weekly training split or start a session from Training Hub."
              action={
                <Link to="/training">
                  <Button variant="secondary" size="sm">
                    Open Training
                  </Button>
                </Link>
              }
            />
          )}
        </Card>

        <Card className="p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-[#F5F7FA]">
                Latest Body Check-In
              </h3>
              <p className="text-xs text-[#929BAA]">
                View multi-range trends, photos & comparisons in Progress
              </p>
            </div>
            <Link
              to="/progress"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] hover:underline whitespace-nowrap shrink-0"
            >
              Progress Hub <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 pt-1">
            <div>
              <div className="text-[11px] text-[#929BAA]">Weight</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-[#B6F36A] tabular-nums">
                {measurementOverview.latestWeightKg !== null
                  ? formatWeight(measurementOverview.latestWeightKg)
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#929BAA]">Waist ({measureLabel})</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-[#39C9BA] tabular-nums">
                {formatMeasureDisplay(measurementOverview.latestWaist)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#929BAA]">Chest ({measureLabel})</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-[#F5F7FA] tabular-nums">
                {formatMeasureDisplay(measurementOverview.latestChest)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#929BAA]">Hips ({measureLabel})</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-[#F5F7FA] tabular-nums">
                {formatMeasureDisplay(measurementOverview.latestHips)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#929BAA]">Calves ({measureLabel})</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-[#F5F7FA] tabular-nums">
                {formatMeasureDisplay(measurementOverview.latestCalves)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#929BAA]">Body Fat</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-[#F5F7FA] tabular-nums">
                {measurementOverview.latestBodyFat !== null
                  ? `${measurementOverview.latestBodyFat}%`
                  : '—'}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
