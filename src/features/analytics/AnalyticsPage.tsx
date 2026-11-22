import { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { MeasurementUnit, WeightUnit } from '../../types/fittrack';
import {
  cmToDisplay,
  kgToDisplay,
  measureUnitSuffix,
  weightUnitSuffix,
} from '../../utils/units';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

interface AnalyticsPayload {
  range: string;
  units?: {
    weightUnit: WeightUnit;
    measureUnit: MeasurementUnit;
    currency: string;
  };
  summary: {
    totalFoodExpense: number;
    avgDailyCalories: number;
    avgDailyProtein: number;
    loggedDaysCount: number;
    workoutsCompleted: number;
    totalTrainingVolume: number;
  };
  dailyNutrition: Array<{
    date: string;
    calories: number;
    proteinG: number;
    expenseInr: number;
  }>;
  bodySeries: Array<{
    date: string;
    weightKg: number | null;
    waistCm: number | null;
    hipsCm?: number | null;
    chestCm?: number | null;
    armsCm?: number | null;
    thighsCm?: number | null;
    calvesCm?: number | null;
  }>;
  workoutSeries: Array<{
    date: string;
    title: string;
    volumeKg: number;
  }>;
}

const RANGES = ['7D', '30D', '90D', '6M', '1Y', 'ALL'] as const;

export function AnalyticsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [range, setRange] = useState<string>('30D');
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [bodyMetricTab, setBodyMetricTab] = useState<'weight' | 'circumference' | 'volume'>('weight');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<AnalyticsPayload>(`/analytics?range=${range}`);
        setData(res.data);
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to load analytics.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [range, showToast]);

  const measureUnit = user?.profile?.preferredMeasureUnit || data?.units?.measureUnit || 'CM';
  const weightUnit = user?.profile?.preferredWeightUnit || data?.units?.weightUnit || 'KG';
  const mSuffix = measureUnitSuffix(measureUnit);
  const wSuffix = weightUnitSuffix(weightUnit);

  const convertedBodySeries = useMemo(
    () =>
      (data?.bodySeries || []).map((pt) => ({
        date: pt.date,
        weight: kgToDisplay(pt.weightKg, weightUnit),
        waist: cmToDisplay(pt.waistCm, measureUnit),
        hips: cmToDisplay(pt.hipsCm ?? null, measureUnit),
      })),
    [data, weightUnit, measureUnit]
  );

  if (loading && !data) return <LoadingSpinner label="Computing analytics..." />;
  if (!data) return null;

  const { summary, dailyNutrition, workoutSeries } = data;

  return (
    <div className="space-y-6">
      <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
            Transformation & Expense Analytics
          </h2>
          <p className="text-xs text-[#929BAA]">
            Cross-module trends aggregated from your logged meals, workouts, and measurements ({wSuffix} / {mSuffix}).
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-[7px] px-2.5 py-1 text-xs font-mono font-medium transition-colors cursor-pointer ${
                range === r
                  ? 'bg-[#26351D] text-[#B6F36A] border border-[#B6F36A]/30'
                  : 'bg-[#0D121A] text-[#929BAA] border border-[#252D38] hover:text-[#F5F7FA]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className="p-4">
          <div className="text-[11px] text-[#929BAA]">Avg Daily Calories</div>
          <div className="font-mono text-xl font-bold text-[#F3B84B] tabular-nums mt-1">
            {summary.avgDailyCalories} kcal
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] text-[#929BAA]">Avg Daily Protein</div>
          <div className="font-mono text-xl font-bold text-[#62A8F7] tabular-nums mt-1">
            {summary.avgDailyProtein} g
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] text-[#929BAA]">Total Food Spend</div>
          <div className="font-mono text-xl font-bold text-[#39C9BA] tabular-nums mt-1">
            ₹{summary.totalFoodExpense.toLocaleString()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] text-[#929BAA]">Workouts Completed</div>
          <div className="font-mono text-xl font-bold text-[#B6F36A] tabular-nums mt-1">
            {summary.workoutsCompleted}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] text-[#929BAA]">Total Volume Lifted</div>
          <div className="font-mono text-xl font-bold text-[#F5F7FA] tabular-nums mt-1">
            {summary.totalTrainingVolume.toLocaleString()} kg
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="space-y-4">
          <h3 className="font-display text-sm font-semibold text-[#F5F7FA]">
            Daily Calories & Food Spend (₹)
          </h3>
          {dailyNutrition.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No nutrition data in this range"
              description="Log meals in Diet Planner to visualize calorie intake and daily INR expenditure."
            />
          ) : (
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyNutrition}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#202733" />
                  <XAxis dataKey="date" stroke="#626C7B" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#626C7B" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#121720',
                      borderColor: '#252D38',
                      borderRadius: '10px',
                      color: '#F5F7FA',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="calories" name="Calories (kcal)" fill="#F3B84B" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenseInr" name="Spend (₹)" fill="#39C9BA" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[#F5F7FA]">
              Body Metrics & Training Volume
            </h3>
            <div className="flex items-center gap-1 p-1 rounded-[9px] bg-[#0D121A] border border-[#252D38]">
              {[
                { key: 'weight', label: `Weight (${wSuffix})` },
                { key: 'circumference', label: `Waist & Hips (${mSuffix})` },
                { key: 'volume', label: 'Volume' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setBodyMetricTab(t.key as 'weight' | 'circumference' | 'volume')}
                  className={`px-2 py-1 text-[11px] font-medium rounded-[6px] cursor-pointer ${
                    bodyMetricTab === t.key
                      ? 'bg-[#26351D] text-[#B6F36A]'
                      : 'text-[#929BAA] hover:text-[#F5F7FA]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {bodyMetricTab === 'weight' &&
            (convertedBodySeries.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No body measurements in this range"
                description="Log weight and circumference measurements to see your trend."
              />
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={convertedBodySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#202733" />
                    <XAxis dataKey="date" stroke="#626C7B" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#626C7B" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#121720',
                        borderColor: '#252D38',
                        borderRadius: '10px',
                        color: '#F5F7FA',
                        fontSize: '12px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="weight"
                      name={`Weight (${wSuffix})`}
                      stroke="#B6F36A"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}

          {bodyMetricTab === 'circumference' &&
            (convertedBodySeries.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No circumference entries in this range"
                description={`Log waist or hips measurements to track changes in ${mSuffix}.`}
              />
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={convertedBodySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#202733" />
                    <XAxis dataKey="date" stroke="#626C7B" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#626C7B" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#121720',
                        borderColor: '#252D38',
                        borderRadius: '10px',
                        color: '#F5F7FA',
                        fontSize: '12px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="waist"
                      name={`Waist (${mSuffix})`}
                      stroke="#39C9BA"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="hips"
                      name={`Hips (${mSuffix})`}
                      stroke="#A88AF5"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}

          {bodyMetricTab === 'volume' &&
            (workoutSeries.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No workout logs in this range"
                description="Complete a workout session to chart training volume."
              />
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={workoutSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#202733" />
                    <XAxis dataKey="date" stroke="#626C7B" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#626C7B" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#121720',
                        borderColor: '#252D38',
                        borderRadius: '10px',
                        color: '#F5F7FA',
                        fontSize: '12px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="volumeKg"
                      name="Volume (kg)"
                      stroke="#62A8F7"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
        </Card>
      </div>
    </div>
  );
}
