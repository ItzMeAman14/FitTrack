import { useEffect, useState, type FormEvent } from 'react';
import { Save, Sparkles } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { FitnessProfile, MeasurementUnit, WeightUnit } from '../../types/fittrack';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { DataPortabilityCard } from './DataPortabilityCard';

export function SettingsPage() {
  const { setUser } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [form, setForm] = useState({
    preferredWeightUnit: 'KG' as WeightUnit,
    preferredMeasureUnit: 'CM' as MeasurementUnit,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    geminiEnabled: true,
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ profile: FitnessProfile }>('/profile');
        const p = res.data.profile;
        setForm({
          preferredWeightUnit: p?.preferredWeightUnit || 'KG',
          preferredMeasureUnit: p?.preferredMeasureUnit || 'CM',
          currency: p?.currency || 'INR',
          timezone: p?.timezone || 'Asia/Kolkata',
          geminiEnabled: p?.geminiEnabled ?? true,
        });
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to load settings.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [showToast]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put<{ profile: FitnessProfile }>('/profile', form);
      setUser((prev) => (prev ? { ...prev, profile: res.data.profile } : prev));
      showToast('Preferences saved.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save preferences.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClearLogs = async () => {
    setClearing(true);
    try {
      await api.post('/profile/clear-logs');
      setConfirmClearOpen(false);
      showToast('All meal, workout, measurement, and AI chat logs cleared.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to clear logs.', 'error');
    } finally {
      setClearing(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading settings..." />;

  return (
    <div className="space-y-6 max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              Regional & Unit Preferences
            </h2>
            <p className="text-xs text-[#929BAA]">
              Defaults to INR (₹), kg, cm, and Asia/Kolkata timezone.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Weight Unit"
              value={form.preferredWeightUnit}
              onChange={(e) =>
                setForm({ ...form, preferredWeightUnit: e.target.value as WeightUnit })
              }
              options={[
                { value: 'KG', label: 'Kilograms (kg)' },
                { value: 'LBS', label: 'Pounds (lbs)' },
              ]}
            />
            <Select
              label="Body Measurement Unit"
              value={form.preferredMeasureUnit}
              onChange={(e) =>
                setForm({ ...form, preferredMeasureUnit: e.target.value as MeasurementUnit })
              }
              options={[
                { value: 'CM', label: 'Centimeters (cm)' },
                { value: 'INCHES', label: 'Inches (in)' },
              ]}
            />
            <Select
              label="Currency"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              options={[
                { value: 'INR', label: 'Indian Rupee (INR ₹)' },
                { value: 'USD', label: 'US Dollar (USD $)' },
              ]}
            />
            <Input
              label="Timezone (IANA)"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              placeholder="Asia/Kolkata"
            />
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#B6F36A]" />
              <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                FitTrack AI Assistant
              </h2>
            </div>
            <span className="text-xs text-[#62A8F7]">Server-Side Gemini</span>
          </div>
          <p className="text-xs text-[#929BAA]">
            Gemini queries are processed securely on the server using your live FitTrack profile,
            nutrition logs, workouts, and measurements.
          </p>
          <label className="flex items-center gap-2.5 text-sm text-[#F5F7FA] cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[#252D38] bg-[#0D121A] accent-[#B6F36A]"
              checked={form.geminiEnabled}
              onChange={(e) => setForm({ ...form, geminiEnabled: e.target.checked })}
            />
            Enable FitTrack AI Assistant
          </label>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Preferences'}
            </Button>
          </div>
        </Card>
      </form>

      <DataPortabilityCard onOpenClearLogs={() => setConfirmClearOpen(true)} />

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
