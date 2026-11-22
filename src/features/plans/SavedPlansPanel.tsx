import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BookMarked, Check, Download, Eye, Plus, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { PlannedMeal, SavedPlan, WorkoutDaySplit } from '../../types/fittrack';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

interface SavedPlansPanelProps {
  planType: 'DIET' | 'WORKOUT';
  onPlanApplied?: () => void;
}

export function SavedPlansPanel({ planType, onPlanApplied }: SavedPlansPanelProps) {
  const { showToast } = useToast();
  const { dataVersion, bumpDataVersion } = useWorkspace();
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewPlan, setPreviewPlan] = useState<SavedPlan | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const label = planType === 'DIET' ? 'Diet Plan' : 'Workout Split';

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<SavedPlan[]>('/saved-plans');
      setPlans(res.data.filter((p) => p.type === planType));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load saved plans.', 'error');
    } finally {
      setLoading(false);
    }
  }, [planType, showToast]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans, dataVersion]);

  const handleSaveSnapshot = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/saved-plans', {
        type: planType,
        name: name.trim(),
        description: description.trim(),
      });
      setModalOpen(false);
      setName('');
      setDescription('');
      showToast(`Current ${label.toLowerCase()} saved as template.`, 'success');
      await loadPlans();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async (id: string) => {
    try {
      await api.post(`/saved-plans/${id}/apply`);
      setPreviewPlan(null);
      bumpDataVersion(planType === 'DIET' ? 'diet' : 'workout');
      onPlanApplied?.();
      showToast(`${label} template applied to your active schedule.`, 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to apply plan.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/saved-plans/${id}`);
      setPlans((prev) => prev.filter((p) => p.id !== id));
      if (previewPlan?.id === id) setPreviewPlan(null);
      showToast('Template deleted.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete plan.', 'error');
    }
  };

  const handleExportSavedPlan = (plan: SavedPlan) => {
    const exportPayload =
      plan.type === 'DIET'
        ? {
            schemaVersion: '1.0',
            exportType: 'DIET',
            exportedAt: new Date().toISOString(),
            plannedMeals: plan.payload,
            savedPlans: [plan],
          }
        : {
            schemaVersion: '1.0',
            exportType: 'WORKOUT',
            exportedAt: new Date().toISOString(),
            workoutSplit: plan.payload,
            savedPlans: [plan],
          };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    a.download = `fittrack-${plan.type.toLowerCase()}-${slug || 'plan'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported "${plan.name}" as JSON.`, 'success');
  };

  if (loading) return <LoadingSpinner label={`Loading ${label.toLowerCase()} templates...`} />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
            Saved {label} Templates
          </h2>
          <p className="text-xs text-[#929BAA]">
            Snapshot your active {label.toLowerCase()} or review FitTrack AI templates before activating.
          </p>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Save Current {label}
        </Button>
      </Card>

      {plans.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={BookMarked}
            title={`No saved ${label.toLowerCase()} templates yet`}
            description={`Configure your active ${label.toLowerCase()} or ask FitTrack AI to generate a new plan to store a reusable template.`}
            action={
              <Button size="sm" variant="secondary" onClick={() => setModalOpen(true)}>
                Save Current {label}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <Card key={plan.id} className="flex flex-col justify-between gap-4 p-4 sm:p-5">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#B6F36A]">{label}</span>
                  <span className="font-mono text-[#626C7B] tabular-nums">
                    {plan.createdAt.slice(0, 10)}
                  </span>
                </div>
                <h3 className="mt-1.5 font-display text-base font-semibold text-[#F5F7FA]">
                  {plan.name}
                </h3>
                {plan.description && (
                  <p className="mt-1 text-xs text-[#929BAA]">{plan.description}</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[#202733] gap-2">
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => handleApply(plan.id)}>
                    <Check className="h-3.5 w-3.5 text-[#B6F36A]" />
                    Apply
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPreviewPlan(plan)}>
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Button>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleExportSavedPlan(plan)}
                    className="p-2 text-[#626C7B] hover:text-[#B6F36A] cursor-pointer"
                    aria-label={`Export ${plan.name}`}
                    title="Export JSON"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(plan.id)}
                    className="p-2 text-[#626C7B] hover:text-[#F16C75] cursor-pointer"
                    aria-label={`Delete ${plan.name}`}
                    title="Delete template"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(previewPlan)}
        onClose={() => setPreviewPlan(null)}
        title={previewPlan?.name || 'Plan Preview'}
        subtitle={previewPlan?.description || undefined}
        maxWidthClass="max-w-2xl"
      >
        {previewPlan && (
          <div className="space-y-4">
            <div className="max-h-[55vh] overflow-y-auto space-y-2.5">
              {previewPlan.type === 'DIET'
                ? ((previewPlan.payload as PlannedMeal[]) || []).map((meal) => (
                    <div
                      key={meal.id}
                      className="rounded-[9px] border border-[#202733] bg-[#0D121A] p-3 text-xs space-y-1"
                    >
                      <div className="font-semibold text-[#F5F7FA]">
                        <span className="font-mono text-[#B6F36A] mr-2">{meal.time}</span>
                        {meal.name}
                      </div>
                      <ul className="space-y-0.5 text-[#929BAA] font-mono text-[11px]">
                        {meal.items.map((it) => (
                          <li key={it.id}>
                            • {it.foodName} ({it.servings}×) — {it.calories} kcal, {it.proteinG}g P
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                : ((previewPlan.payload as WorkoutDaySplit[]) || []).map((d) => (
                    <div
                      key={d.day}
                      className="rounded-[9px] border border-[#202733] bg-[#0D121A] p-3 text-xs space-y-1"
                    >
                      <div className="font-semibold text-[#F5F7FA]">
                        <span className="font-mono text-[#62A8F7] mr-2">{d.day}</span>
                        {d.focus}
                      </div>
                      {d.isRestDay ? (
                        <div className="text-[#626C7B]">Scheduled Rest Day</div>
                      ) : d.exercises.length === 0 ? (
                        <div className="text-[#626C7B]">No exercises assigned</div>
                      ) : (
                        <ul className="space-y-0.5 text-[#929BAA] font-mono text-[11px]">
                          {d.exercises.map((ex) => (
                            <li key={ex.id}>
                              • {ex.exerciseName}: {ex.targetSets}×{ex.targetReps} ({ex.restSeconds}s
                              rest)
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreviewPlan(null)}>
                Close
              </Button>
              <Button variant="secondary" onClick={() => handleExportSavedPlan(previewPlan)}>
                <Download className="h-4 w-4 text-[#B6F36A]" />
                Export JSON
              </Button>
              <Button onClick={() => handleApply(previewPlan.id)}>
                <Check className="h-4 w-4" />
                Apply as Active Plan
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Save Current ${label} as Template`}
      >
        <form onSubmit={handleSaveSnapshot} className="space-y-4">
          <Input
            label="Template Name"
            placeholder={planType === 'DIET' ? 'e.g. Lean Cut 2100 kcal' : 'e.g. 6-Day PPL'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            label="Description (Optional)"
            placeholder={
              planType === 'DIET'
                ? 'High-protein vegetarian cut...'
                : 'Hypertrophy upper/lower split...'
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Template'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
