import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { Exercise, MuscleGroup } from '../../types/fittrack';
import { displayToKg, kgToDisplay, weightUnitSuffix } from '../../utils/units';
import {
  ExerciseMediaFields,
  ExerciseMediaModal,
  ExerciseMediaThumbnail,
  type ExerciseDetailItem,
} from '../../components/workouts/ExerciseMedia';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

interface ExerciseLibraryPageProps {
  onAddToSplit?: (exercise: Exercise) => void;
  onLibraryChanged?: () => void;
}

const MUSCLE_GROUPS: Array<{ value: 'ALL' | MuscleGroup; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'CHEST', label: 'Chest' },
  { value: 'BACK', label: 'Back' },
  { value: 'LEGS', label: 'Legs' },
  { value: 'SHOULDERS', label: 'Shoulders' },
  { value: 'ARMS', label: 'Arms' },
  { value: 'CORE', label: 'Core' },
  { value: 'CARDIO', label: 'Cardio' },
];

const EMPTY_EXERCISE = {
  name: '',
  muscleGroup: 'CHEST' as MuscleGroup,
  equipment: 'Barbell',
  defaultSets: '3',
  defaultReps: '8-12',
  defaultRestSeconds: '90',
  defaultWeight: '',
  instructions: '',
  imageUrl: '',
  videoUrl: '',
};

export function ExerciseLibraryPage({ onAddToSplit, onLibraryChanged }: ExerciseLibraryPageProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { dataVersion, bumpDataVersion } = useWorkspace();
  const weightUnit = user?.profile?.preferredWeightUnit || 'KG';
  const weightSuffix = weightUnitSuffix(weightUnit);

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<'ALL' | MuscleGroup>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_EXERCISE);
  const [previewEx, setPreviewEx] = useState<Exercise | null>(null);

  const loadExercises = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Exercise[]>('/exercises');
      setExercises(res.data);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load exercises.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadExercises();
  }, [loadExercises, dataVersion]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_EXERCISE);
    setModalOpen(true);
  };

  const openEdit = (ex: Exercise) => {
    setEditingId(ex.id);
    const displayW = kgToDisplay(ex.defaultWeightKg ?? null, weightUnit);
    setForm({
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      equipment: ex.equipment,
      defaultSets: String(ex.defaultSets),
      defaultReps: ex.defaultReps,
      defaultRestSeconds: String(ex.defaultRestSeconds ?? 90),
      defaultWeight: displayW !== null ? String(displayW) : '',
      instructions: ex.instructions,
      imageUrl: ex.imageUrl || '',
      videoUrl: ex.videoUrl || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedRest = Number(form.defaultRestSeconds);
      const payload = {
        name: form.name.trim(),
        muscleGroup: form.muscleGroup,
        equipment: form.equipment.trim(),
        defaultSets: Number(form.defaultSets),
        defaultReps: form.defaultReps.trim(),
        defaultRestSeconds: Number.isFinite(parsedRest) && parsedRest >= 0 ? parsedRest : 90,
        defaultWeightKg: form.defaultWeight.trim()
          ? displayToKg(form.defaultWeight, weightUnit)
          : null,
        instructions: form.instructions.trim(),
        imageUrl: form.imageUrl.trim() || null,
        videoUrl: form.videoUrl.trim() || null,
      };
      if (editingId) {
        await api.put(`/exercises/${editingId}`, payload);
        showToast('Exercise updated.', 'success');
      } else {
        await api.post('/exercises', payload);
        showToast('Exercise added to library.', 'success');
      }
      setModalOpen(false);
      await loadExercises();
      bumpDataVersion('workout');
      onLibraryChanged?.();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save exercise.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/exercises/${id}`);
      setExercises((prev) => prev.filter((e) => e.id !== id));
      bumpDataVersion('workout');
      onLibraryChanged?.();
      showToast('Exercise deleted.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete exercise.', 'error');
    }
  };

  const filtered = exercises.filter((ex) => {
    const matchesGroup = groupFilter === 'ALL' || ex.muscleGroup === groupFilter;
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase().trim());
    return matchesGroup && matchesSearch;
  });

  if (loading) return <LoadingSpinner label="Loading exercise library..." />;

  const previewDetail: ExerciseDetailItem | null = previewEx
    ? {
        name: previewEx.name,
        muscleGroup: previewEx.muscleGroup,
        equipment: previewEx.equipment,
        sets: previewEx.defaultSets,
        reps: previewEx.defaultReps,
        restSeconds: previewEx.defaultRestSeconds ?? 90,
        targetWeightKg: previewEx.defaultWeightKg ?? null,
        instructions: previewEx.instructions,
        imageUrl: previewEx.imageUrl ?? null,
        videoUrl: previewEx.videoUrl ?? null,
      }
    : null;

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 text-[#626C7B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exercises..."
              className="w-full h-9 rounded-[9px] bg-[#0D121A] border border-[#252D38] pl-9 pr-3 text-sm text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-[9px] bg-[#0D121A] border border-[#252D38]">
            {MUSCLE_GROUPS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGroupFilter(g.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-[6px] transition-colors cursor-pointer ${
                  groupFilter === g.value
                    ? 'bg-[#26351D] text-[#B6F36A]'
                    : 'text-[#929BAA] hover:text-[#F5F7FA]'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4" />
          Add Exercise
        </Button>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No exercises match your filter"
            description="Adjust your muscle group filter or add a custom movement."
            action={
              <Button size="sm" variant="secondary" onClick={openCreate}>
                Add Exercise
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((ex) => {
            const displayW = kgToDisplay(ex.defaultWeightKg ?? null, weightUnit);
            return (
              <Card key={ex.id} className="p-4 flex flex-col justify-between gap-3">
                <div className="space-y-2.5">
                  <div className="flex items-start gap-3">
                    <ExerciseMediaThumbnail
                      name={ex.name}
                      muscleGroup={ex.muscleGroup}
                      imageUrl={ex.imageUrl}
                      videoUrl={ex.videoUrl}
                      size="md"
                      onClick={() => setPreviewEx(ex)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="text-xs font-medium text-[#B6F36A] truncate">
                          {ex.muscleGroup} · {ex.equipment}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setPreviewEx(ex)}
                            className="p-1 rounded-md text-[#626C7B] hover:text-[#B6F36A] hover:bg-[#171E29] cursor-pointer"
                            aria-label={`View ${ex.name} media and details`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(ex)}
                            className="p-1 rounded-md text-[#626C7B] hover:text-[#F5F7FA] hover:bg-[#171E29] cursor-pointer"
                            aria-label={`Edit ${ex.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(ex.id)}
                            className="p-1 rounded-md text-[#626C7B] hover:text-[#F16C75] hover:bg-[#171E29] cursor-pointer"
                            aria-label={`Delete ${ex.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <h3 className="mt-0.5 font-display text-sm font-semibold text-[#F5F7FA] truncate">
                        {ex.name}
                      </h3>
                      <div className="mt-1 font-mono text-[11px] text-[#929BAA] tabular-nums">
                        {ex.defaultSets} sets × {ex.defaultReps} · {ex.defaultRestSeconds ?? 90}s rest
                        {displayW !== null ? ` · ${displayW} ${weightSuffix}` : ''}
                      </div>
                    </div>
                  </div>
                  {ex.instructions && (
                    <p className="text-xs leading-relaxed text-[#929BAA] line-clamp-2">
                      {ex.instructions}
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-[#202733] flex items-center justify-between gap-2 text-[11px] text-[#626C7B]">
                  <span className="truncate">
                    {ex.videoUrl && ex.imageUrl
                      ? 'Image & Video attached'
                      : ex.videoUrl
                        ? 'Video demo attached'
                        : ex.imageUrl
                          ? 'Image attached'
                          : 'No media attached'}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(ex)}
                      className="font-medium text-[#929BAA] hover:text-[#F5F7FA] cursor-pointer"
                    >
                      {ex.imageUrl || ex.videoUrl ? 'Edit Media' : 'Add Media'}
                    </button>
                    {onAddToSplit && (
                      <button
                        type="button"
                        onClick={() => onAddToSplit(ex)}
                        className="inline-flex items-center gap-1 rounded-[7px] bg-[#26351D] px-2.5 py-1 text-[11px] font-semibold text-[#B6F36A] hover:bg-[#2F4124] cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                        Split
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ExerciseMediaModal
        open={Boolean(previewEx)}
        onClose={() => setPreviewEx(null)}
        exercise={previewDetail}
        weightUnitLabel={weightSuffix}
        displayWeight={kgToDisplay(previewEx?.defaultWeightKg ?? null, weightUnit)}
        onEditMedia={() => {
          if (previewEx) {
            const target = previewEx;
            setPreviewEx(null);
            openEdit(target);
          }
        }}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Exercise' : 'Add Exercise'}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Exercise Name"
            placeholder="e.g. Bulgarian Split Squat"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Muscle Group"
              value={form.muscleGroup}
              onChange={(e) => setForm({ ...form, muscleGroup: e.target.value as MuscleGroup })}
              options={MUSCLE_GROUPS.filter((g) => g.value !== 'ALL')}
            />
            <Input
              label="Equipment"
              placeholder="Barbell, Dumbbell, Cable..."
              value={form.equipment}
              onChange={(e) => setForm({ ...form, equipment: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Input
              label="Default Sets"
              type="number"
              min="1"
              value={form.defaultSets}
              onChange={(e) => setForm({ ...form, defaultSets: e.target.value })}
              required
            />
            <Input
              label="Default Reps"
              placeholder="e.g. 8-12"
              value={form.defaultReps}
              onChange={(e) => setForm({ ...form, defaultReps: e.target.value })}
              required
            />
            <Input
              label="Rest (sec)"
              type="number"
              min="0"
              value={form.defaultRestSeconds}
              onChange={(e) => setForm({ ...form, defaultRestSeconds: e.target.value })}
              required
            />
            <Input
              label={`Weight (${weightSuffix})`}
              type="number"
              min="0"
              step="0.5"
              placeholder="Optional"
              value={form.defaultWeight}
              onChange={(e) => setForm({ ...form, defaultWeight: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#929BAA]">Form Cues / Instructions</label>
            <textarea
              rows={2}
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              className="w-full rounded-[9px] bg-[#0D121A] border border-[#252D38] p-3 text-sm text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A]"
              placeholder="Key cues for execution..."
            />
          </div>

          <ExerciseMediaFields
            imageUrl={form.imageUrl}
            videoUrl={form.videoUrl}
            onImageChange={(next) => setForm((prev) => ({ ...prev, imageUrl: next }))}
            onVideoChange={(next) => setForm((prev) => ({ ...prev, videoUrl: next }))}
            onError={(msg) => showToast(msg, 'error')}
          />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Exercise'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
