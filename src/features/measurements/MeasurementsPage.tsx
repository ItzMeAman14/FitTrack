import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeftRight, Camera, Pencil, Plus, Ruler, Trash2 } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { BodyMeasurement } from '../../types/fittrack';
import {
  cmToDisplay,
  displayToCm,
  displayToKg,
  formatMeasure,
  formatMeasureDelta,
  formatWeight,
  getMeasureBounds,
  kgToDisplay,
  measurePlaceholder,
  measureUnitSuffix,
  weightUnitSuffix,
} from '../../utils/units';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

interface CustomFieldDraft {
  id: string;
  label: string;
  value: string;
}

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  weight: '',
  bodyFatPct: '',
  waist: '',
  chest: '',
  hips: '',
  arms: '',
  thighs: '',
  neck: '',
  calves: '',
  notes: '',
  photoDataUrl: '' as string,
};

export function MeasurementsPage() {
  const { user, refreshAuth } = useAuth();
  const { showToast } = useToast();

  const measureUnit = user?.profile?.preferredMeasureUnit || 'CM';
  const weightUnit = user?.profile?.preferredWeightUnit || 'KG';
  const mSuffix = measureUnitSuffix(measureUnit);
  const wSuffix = weightUnitSuffix(weightUnit);

  const [loading, setLoading] = useState(true);
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>([]);
  const [chartMetric, setChartMetric] = useState<'weight' | 'circumference'>('weight');

  const [compareFromId, setCompareFromId] = useState<string>('');
  const [compareToId, setCompareToId] = useState<string>('');

  const loadMeasurements = async () => {
    setLoading(true);
    try {
      const res = await api.get<BodyMeasurement[]>('/measurements');
      setMeasurements(res.data);
      if (res.data.length >= 2) {
        setCompareToId(res.data[0].id);
        setCompareFromId(res.data[res.data.length - 1].id);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load measurements.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeasurements();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
    setCustomFields([]);
    setModalOpen(true);
  };

  const openEditModal = (m: BodyMeasurement) => {
    setEditingId(m.id);
    const toStr = (v: number | null) => (v !== null ? String(v) : '');
    setForm({
      date: m.date,
      weight: toStr(kgToDisplay(m.weightKg, weightUnit)),
      bodyFatPct: m.bodyFatPct !== null ? String(m.bodyFatPct) : '',
      waist: toStr(cmToDisplay(m.waistCm, measureUnit)),
      chest: toStr(cmToDisplay(m.chestCm, measureUnit)),
      hips: toStr(cmToDisplay(m.hipsCm ?? null, measureUnit)),
      arms: toStr(cmToDisplay(m.armsCm, measureUnit)),
      thighs: toStr(cmToDisplay(m.thighsCm, measureUnit)),
      neck: toStr(cmToDisplay(m.neckCm, measureUnit)),
      calves: toStr(cmToDisplay(m.calvesCm ?? null, measureUnit)),
      notes: m.notes || '',
      photoDataUrl: m.photoDataUrl || '',
    });
    setCustomFields(
      (m.customMeasurements || []).map((c) => ({
        id: c.id,
        label: c.label,
        value: toStr(cmToDisplay(c.valueCm, measureUnit)),
      }))
    );
    setModalOpen(true);
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
        setForm((prev) => ({ ...prev, photoDataUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const validateField = (raw: string, label: string, maxCm: number): boolean => {
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

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();

    if (
      !validateField(form.waist, 'Waist', 300) ||
      !validateField(form.chest, 'Chest', 300) ||
      !validateField(form.hips, 'Hips', 300) ||
      !validateField(form.arms, 'Arms', 150) ||
      !validateField(form.thighs, 'Thighs', 200) ||
      !validateField(form.neck, 'Neck', 120) ||
      !validateField(form.calves, 'Calves', 150)
    ) {
      return;
    }

    for (const cf of customFields) {
      if (cf.label.trim() && cf.value.trim()) {
        if (!validateField(cf.value, cf.label, 350)) return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        date: form.date,
        weightKg: displayToKg(form.weight, weightUnit),
        bodyFatPct: form.bodyFatPct.trim() ? Number(form.bodyFatPct) : null,
        waistCm: displayToCm(form.waist, measureUnit),
        chestCm: displayToCm(form.chest, measureUnit),
        hipsCm: displayToCm(form.hips, measureUnit),
        armsCm: displayToCm(form.arms, measureUnit),
        thighsCm: displayToCm(form.thighs, measureUnit),
        neckCm: displayToCm(form.neck, measureUnit),
        calvesCm: displayToCm(form.calves, measureUnit),
        customMeasurements: customFields
          .filter((c) => c.label.trim() && c.value.trim())
          .map((c) => ({
            id: c.id,
            label: c.label.trim(),
            valueCm: displayToCm(c.value, measureUnit)!,
          })),
        notes: form.notes.trim(),
        photoDataUrl: form.photoDataUrl || null,
      };

      if (editingId) {
        await api.put(`/measurements/${editingId}`, payload);
        showToast('Measurement updated.', 'success');
      } else {
        await api.post('/measurements', payload);
        showToast('Measurement saved & profile weight synced.', 'success');
      }

      setModalOpen(false);
      setEditingId(null);
      await loadMeasurements();
      await refreshAuth();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save measurement.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/measurements/${id}`);
      setMeasurements((prev) => prev.filter((m) => m.id !== id));
      showToast('Measurement entry deleted.', 'info');
      await refreshAuth();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete entry.', 'error');
    }
  };

  const latest = measurements[0] || null;
  const earliest = measurements[measurements.length - 1] || null;

  const weightDeltaKg =
    latest?.weightKg != null && earliest?.weightKg != null && measurements.length > 1
      ? Number((latest.weightKg - earliest.weightKg).toFixed(2))
      : null;
  const waistDeltaCm =
    latest?.waistCm != null && earliest?.waistCm != null && measurements.length > 1
      ? Number((latest.waistCm - earliest.waistCm).toFixed(2))
      : null;

  const chartData = useMemo(
    () =>
      [...measurements]
        .reverse()
        .filter((m) => m.weightKg !== null || m.waistCm !== null || (m.hipsCm ?? null) !== null)
        .map((m) => ({
          date: m.date,
          weight: kgToDisplay(m.weightKg, weightUnit),
          waist: cmToDisplay(m.waistCm, measureUnit),
          hips: cmToDisplay(m.hipsCm ?? null, measureUnit),
        })),
    [measurements, weightUnit, measureUnit]
  );

  const compareFrom = measurements.find((m) => m.id === compareFromId) || earliest;
  const compareTo = measurements.find((m) => m.id === compareToId) || latest;
  const photos = measurements.filter((m) => m.photoDataUrl);

  if (loading) return <LoadingSpinner label="Loading measurements..." />;

  const comparisonRows =
    compareFrom && compareTo && compareFrom.id !== compareTo.id
      ? [
          {
            label: `Weight (${wSuffix})`,
            from: formatWeight(compareFrom.weightKg, weightUnit),
            to: formatWeight(compareTo.weightKg, weightUnit),
            delta:
              compareFrom.weightKg !== null && compareTo.weightKg !== null
                ? (() => {
                    const diff =
                      weightUnit === 'LBS'
                        ? Number(((compareTo.weightKg - compareFrom.weightKg) * 2.20462).toFixed(1))
                        : Number((compareTo.weightKg - compareFrom.weightKg).toFixed(1));
                    return `${diff > 0 ? '+' : ''}${diff} ${wSuffix}`;
                  })()
                : '—',
          },
          {
            label: `Waist (${mSuffix})`,
            from: formatMeasure(compareFrom.waistCm, measureUnit),
            to: formatMeasure(compareTo.waistCm, measureUnit),
            delta:
              compareFrom.waistCm !== null && compareTo.waistCm !== null
                ? formatMeasureDelta(compareTo.waistCm - compareFrom.waistCm, measureUnit)
                : '—',
          },
          {
            label: `Chest (${mSuffix})`,
            from: formatMeasure(compareFrom.chestCm, measureUnit),
            to: formatMeasure(compareTo.chestCm, measureUnit),
            delta:
              compareFrom.chestCm !== null && compareTo.chestCm !== null
                ? formatMeasureDelta(compareTo.chestCm - compareFrom.chestCm, measureUnit)
                : '—',
          },
          {
            label: `Hips (${mSuffix})`,
            from: formatMeasure(compareFrom.hipsCm ?? null, measureUnit),
            to: formatMeasure(compareTo.hipsCm ?? null, measureUnit),
            delta:
              compareFrom.hipsCm != null && compareTo.hipsCm != null
                ? formatMeasureDelta(compareTo.hipsCm - compareFrom.hipsCm, measureUnit)
                : '—',
          },
          {
            label: `Arms (${mSuffix})`,
            from: formatMeasure(compareFrom.armsCm, measureUnit),
            to: formatMeasure(compareTo.armsCm, measureUnit),
            delta:
              compareFrom.armsCm !== null && compareTo.armsCm !== null
                ? formatMeasureDelta(compareTo.armsCm - compareFrom.armsCm, measureUnit)
                : '—',
          },
          {
            label: `Thighs (${mSuffix})`,
            from: formatMeasure(compareFrom.thighsCm, measureUnit),
            to: formatMeasure(compareTo.thighsCm, measureUnit),
            delta:
              compareFrom.thighsCm !== null && compareTo.thighsCm !== null
                ? formatMeasureDelta(compareTo.thighsCm - compareFrom.thighsCm, measureUnit)
                : '—',
          },
          {
            label: `Neck (${mSuffix})`,
            from: formatMeasure(compareFrom.neckCm, measureUnit),
            to: formatMeasure(compareTo.neckCm, measureUnit),
            delta:
              compareFrom.neckCm !== null && compareTo.neckCm !== null
                ? formatMeasureDelta(compareTo.neckCm - compareFrom.neckCm, measureUnit)
                : '—',
          },
          {
            label: `Calves (${mSuffix})`,
            from: formatMeasure(compareFrom.calvesCm ?? null, measureUnit),
            to: formatMeasure(compareTo.calvesCm ?? null, measureUnit),
            delta:
              compareFrom.calvesCm != null && compareTo.calvesCm != null
                ? formatMeasureDelta(compareTo.calvesCm - compareFrom.calvesCm, measureUnit)
                : '—',
          },
        ]
      : [];

  return (
    <div className="space-y-6">
      {/* Top KPI Summary Strip */}
      <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 flex-1">
          <div>
            <div className="text-[11px] text-[#929BAA]">Latest Weight</div>
            <div className="font-mono text-lg font-semibold text-[#B6F36A] tabular-nums mt-0.5">
              {latest?.weightKg != null ? formatWeight(latest.weightKg, weightUnit) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Latest Waist ({mSuffix})</div>
            <div className="font-mono text-lg font-semibold text-[#39C9BA] tabular-nums mt-0.5">
              {formatMeasure(latest?.waistCm ?? null, measureUnit)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Weight Delta</div>
            <div className="font-mono text-lg font-semibold text-[#F5F7FA] tabular-nums mt-0.5">
              {weightDeltaKg !== null
                ? (() => {
                    const diff =
                      weightUnit === 'LBS'
                        ? Number((weightDeltaKg * 2.20462).toFixed(1))
                        : Number(weightDeltaKg.toFixed(1));
                    return `${diff > 0 ? '+' : ''}${diff} ${wSuffix}`;
                  })()
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#929BAA]">Waist Delta ({mSuffix})</div>
            <div className="font-mono text-lg font-semibold text-[#36C98F] tabular-nums mt-0.5">
              {formatMeasureDelta(waistDeltaCm, measureUnit)}
            </div>
          </div>
        </div>

        <Button size="sm" onClick={openCreateModal}>
          <Plus className="h-4 w-4" />
          Log Measurement
        </Button>
      </Card>

      {/* Progression Chart */}
      {chartData.length > 0 && (
        <Card className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              {chartMetric === 'weight'
                ? `Weight Progression (${wSuffix})`
                : `Waist & Hips Progression (${mSuffix})`}
            </h2>
            <div className="flex items-center gap-1 p-1 rounded-[9px] bg-[#0D121A] border border-[#252D38] w-fit">
              <button
                type="button"
                onClick={() => setChartMetric('weight')}
                className={`px-2.5 py-1 text-xs font-medium rounded-[6px] cursor-pointer ${
                  chartMetric === 'weight'
                    ? 'bg-[#26351D] text-[#B6F36A]'
                    : 'text-[#929BAA] hover:text-[#F5F7FA]'
                }`}
              >
                Weight ({wSuffix})
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('circumference')}
                className={`px-2.5 py-1 text-xs font-medium rounded-[6px] cursor-pointer ${
                  chartMetric === 'circumference'
                    ? 'bg-[#26351D] text-[#B6F36A]'
                    : 'text-[#929BAA] hover:text-[#F5F7FA]'
                }`}
              >
                Waist & Hips ({mSuffix})
              </button>
            </div>
          </div>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartMetric === 'weight' ? (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="measWeightFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#B6F36A" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#B6F36A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
                  <Area
                    type="monotone"
                    dataKey="weight"
                    name={`Weight (${wSuffix})`}
                    stroke="#B6F36A"
                    strokeWidth={2}
                    fill="url(#measWeightFill)"
                    connectNulls
                  />
                </AreaChart>
              ) : (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="measWaistFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#39C9BA" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#39C9BA" stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
                  <Area
                    type="monotone"
                    dataKey="waist"
                    name={`Waist (${mSuffix})`}
                    stroke="#39C9BA"
                    strokeWidth={2}
                    fill="url(#measWaistFill)"
                    connectNulls
                  />
                  <Area
                    type="monotone"
                    dataKey="hips"
                    name={`Hips (${mSuffix})`}
                    stroke="#A88AF5"
                    strokeWidth={2}
                    fillOpacity={0}
                    connectNulls
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Side-by-Side Comparison View */}
      {measurements.length >= 2 && (
        <Card className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-[#B6F36A]" />
              <div>
                <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                  Measurement Comparison ({mSuffix.toUpperCase()} / {wSuffix.toUpperCase()})
                </h2>
                <p className="text-xs text-[#929BAA]">
                  Compare any two check-in dates to track circumference and weight shifts.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:w-auto">
              <Select
                label="Baseline"
                value={compareFrom?.id || ''}
                onChange={(e) => setCompareFromId(e.target.value)}
                options={measurements.map((m) => ({
                  value: m.id,
                  label: `${m.date}${m.weightKg ? ` (${formatWeight(m.weightKg, weightUnit)})` : ''}`,
                }))}
              />
              <Select
                label="Comparison"
                value={compareTo?.id || ''}
                onChange={(e) => setCompareToId(e.target.value)}
                options={measurements.map((m) => ({
                  value: m.id,
                  label: `${m.date}${m.weightKg ? ` (${formatWeight(m.weightKg, weightUnit)})` : ''}`,
                }))}
              />
            </div>
          </div>

          {comparisonRows.length === 0 ? (
            <p className="text-xs text-[#929BAA]">Select two different dates to compare.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {comparisonRows.map((row) => (
                <div
                  key={row.label}
                  className="rounded-[10px] border border-[#202733] bg-[#0D121A] p-3 space-y-1"
                >
                  <div className="text-[11px] text-[#929BAA]">{row.label}</div>
                  <div className="font-mono text-xs text-[#626C7B] tabular-nums">
                    {row.from} → <span className="text-[#F5F7FA] font-medium">{row.to}</span>
                  </div>
                  <div className="font-mono text-sm font-semibold text-[#39C9BA] tabular-nums">
                    {row.delta}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Progress Photos */}
      {photos.length > 0 && (
        <Card className="space-y-4">
          <h2 className="font-display text-base font-semibold text-[#F5F7FA]">Progress Photos</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {photos.map((p) => (
              <div key={p.id} className="space-y-1.5">
                <img
                  src={p.photoDataUrl!}
                  alt={`Progress check-in on ${p.date}`}
                  referrerPolicy="no-referrer"
                  className="aspect-3/4 w-full rounded-[10px] object-cover border border-[#252D38]"
                />
                <div className="font-mono text-[11px] text-[#929BAA] tabular-nums">
                  {p.date} {p.weightKg ? `· ${formatWeight(p.weightKg, weightUnit)}` : ''}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* History Table */}
      <Card className="p-0 overflow-hidden">
        {measurements.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Ruler}
              title="No measurements recorded yet"
              description={`Log your weight (${wSuffix}), waist, chest, hips, arms, thighs, neck, calves (${mSuffix}), and progress photos.`}
              action={
                <Button size="sm" variant="secondary" onClick={openCreateModal}>
                  Log First Measurement
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#202733] text-[11px] font-medium text-[#626C7B]">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-3 text-right">Weight ({wSuffix})</th>
                  <th className="py-3 px-3 text-right">Body Fat</th>
                  <th className="py-3 px-3 text-right">Waist ({mSuffix})</th>
                  <th className="py-3 px-3 text-right">Chest ({mSuffix})</th>
                  <th className="py-3 px-3 text-right">Hips ({mSuffix})</th>
                  <th className="py-3 px-3 text-right">Arms ({mSuffix})</th>
                  <th className="py-3 px-3 text-right">Thighs ({mSuffix})</th>
                  <th className="py-3 px-3 text-right">Neck ({mSuffix})</th>
                  <th className="py-3 px-3 text-right">Calves ({mSuffix})</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202733] text-sm">
                {measurements.map((m) => (
                  <tr key={m.id} className="hover:bg-[#171E29]/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-[#F5F7FA] tabular-nums whitespace-nowrap">
                      {m.date}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#B6F36A]">
                      {kgToDisplay(m.weightKg, weightUnit) ?? '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#929BAA]">
                      {m.bodyFatPct ? `${m.bodyFatPct}%` : '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#39C9BA]">
                      {cmToDisplay(m.waistCm, measureUnit) ?? '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#929BAA]">
                      {cmToDisplay(m.chestCm, measureUnit) ?? '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#929BAA]">
                      {cmToDisplay(m.hipsCm ?? null, measureUnit) ?? '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#929BAA]">
                      {cmToDisplay(m.armsCm, measureUnit) ?? '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#929BAA]">
                      {cmToDisplay(m.thighsCm, measureUnit) ?? '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#929BAA]">
                      {cmToDisplay(m.neckCm, measureUnit) ?? '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#929BAA]">
                      {cmToDisplay(m.calvesCm ?? null, measureUnit) ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#929BAA] max-w-[200px] truncate">
                      {m.customMeasurements && m.customMeasurements.length > 0
                        ? `${m.customMeasurements
                            .map((c) => `${c.label}: ${formatMeasure(c.valueCm, measureUnit)}`)
                            .join(', ')}${m.notes ? ` · ${m.notes}` : ''}`
                        : m.notes || '—'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(m)}
                        className="p-1.5 rounded-md text-[#626C7B] hover:text-[#F5F7FA] cursor-pointer"
                        aria-label={`Edit measurement on ${m.date}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        className="p-1.5 rounded-md text-[#626C7B] hover:text-[#F16C75] cursor-pointer"
                        aria-label={`Delete measurement on ${m.date}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add / Edit Measurement Modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingId(null);
        }}
        title={editingId ? 'Edit Body Measurement' : 'Log Body Measurement'}
        subtitle={`Entering values in ${measureUnit === 'INCHES' ? 'inches (in)' : 'centimeters (cm)'} and ${wSuffix}. Stored canonically so toggling units anytime converts without data loss.`}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
            <Input
              label={`Weight (${wSuffix})`}
              type="number"
              step="0.1"
              placeholder={weightUnit === 'LBS' ? '168.5' : '76.4'}
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
            />
            <Input
              label="Body Fat (%)"
              type="number"
              step="0.1"
              placeholder="16.5"
              value={form.bodyFatPct}
              onChange={(e) => setForm({ ...form, bodyFatPct: e.target.value })}
            />
            <Input
              label={`Waist (${mSuffix})`}
              type="number"
              step="0.01"
              placeholder={measurePlaceholder(82, measureUnit)}
              value={form.waist}
              onChange={(e) => setForm({ ...form, waist: e.target.value })}
            />
            <Input
              label={`Chest (${mSuffix})`}
              type="number"
              step="0.01"
              placeholder={measurePlaceholder(101, measureUnit)}
              value={form.chest}
              onChange={(e) => setForm({ ...form, chest: e.target.value })}
            />
            <Input
              label={`Hips (${mSuffix})`}
              type="number"
              step="0.01"
              placeholder={measurePlaceholder(95, measureUnit)}
              value={form.hips}
              onChange={(e) => setForm({ ...form, hips: e.target.value })}
            />
            <Input
              label={`Arms (${mSuffix})`}
              type="number"
              step="0.01"
              placeholder={measurePlaceholder(37.5, measureUnit)}
              value={form.arms}
              onChange={(e) => setForm({ ...form, arms: e.target.value })}
            />
            <Input
              label={`Thighs (${mSuffix})`}
              type="number"
              step="0.01"
              placeholder={measurePlaceholder(57, measureUnit)}
              value={form.thighs}
              onChange={(e) => setForm({ ...form, thighs: e.target.value })}
            />
            <Input
              label={`Neck (${mSuffix})`}
              type="number"
              step="0.01"
              placeholder={measurePlaceholder(38.5, measureUnit)}
              value={form.neck}
              onChange={(e) => setForm({ ...form, neck: e.target.value })}
            />
            <Input
              label={`Calves (${mSuffix})`}
              type="number"
              step="0.01"
              placeholder={measurePlaceholder(37, measureUnit)}
              value={form.calves}
              onChange={(e) => setForm({ ...form, calves: e.target.value })}
            />
          </div>

          {/* Custom Measurements */}
          <div className="space-y-2 rounded-[10px] border border-[#202733] bg-[#0D121A] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#929BAA]">
                Custom Measurements ({mSuffix})
              </span>
              <button
                type="button"
                onClick={() =>
                  setCustomFields((prev) => [
                    ...prev,
                    { id: `cf_${Date.now()}`, label: '', value: '' },
                  ])
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] hover:underline cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" /> Add Custom Field
              </button>
            </div>
            {customFields.map((cf, idx) => (
              <div key={cf.id} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-6">
                  <input
                    type="text"
                    placeholder="e.g. Shoulders / Forearms"
                    value={cf.label}
                    onChange={(e) =>
                      setCustomFields((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, label: e.target.value } : item
                        )
                      )
                    }
                    className="w-full h-9 rounded-[8px] bg-[#121720] border border-[#252D38] px-3 text-xs text-[#F5F7FA] placeholder-[#626C7B]"
                  />
                </div>
                <div className="col-span-5 relative">
                  <input
                    type="number"
                    step="0.01"
                    placeholder={measurePlaceholder(32, measureUnit)}
                    value={cf.value}
                    onChange={(e) =>
                      setCustomFields((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, value: e.target.value } : item
                        )
                      )
                    }
                    className="w-full h-9 rounded-[8px] bg-[#121720] border border-[#252D38] px-3 pr-8 text-xs font-mono text-[#F5F7FA]"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#626C7B]">
                    {mSuffix}
                  </span>
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setCustomFields((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="p-1.5 text-[#626C7B] hover:text-[#F16C75] cursor-pointer"
                    aria-label="Remove custom measurement"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Input
            label="Notes"
            placeholder="Morning fasted check-in..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#929BAA]">
              Progress Photo (Optional, max 2 MB)
            </label>
            <label className="flex items-center gap-2 rounded-[9px] border border-dashed border-[#252D38] bg-[#0D121A] px-3.5 py-2.5 text-xs text-[#929BAA] hover:border-[#B6F36A] cursor-pointer">
              <Camera className="h-4 w-4 text-[#B6F36A]" />
              <span>
                {form.photoDataUrl ? 'Photo attached (click to replace)' : 'Upload progress photo'}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setModalOpen(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Save Measurement'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
