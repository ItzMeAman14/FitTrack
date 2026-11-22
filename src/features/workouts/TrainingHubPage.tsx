import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Dumbbell,
  Eye,
  Pencil,
  Play,
  Plus,
  Save,
  Timer,
  Trash2,
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type {
  DayOfWeek,
  Exercise,
  LoggedExercise,
  SplitExercise,
  WorkoutDaySplit,
  WorkoutSession,
} from '../../types/fittrack';
import { displayToKg, kgToDisplay, weightUnitSuffix } from '../../utils/units';
import {
  ExerciseMediaFields,
  ExerciseMediaModal,
  ExerciseMediaThumbnail,
  type ExerciseDetailItem,
} from '../../components/workouts/ExerciseMedia';
import { ExerciseLibraryPage } from './ExerciseLibraryPage';
import { SavedPlansPanel } from '../plans/SavedPlansPanel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

type TrainingTab = 'split' | 'exercises' | 'templates';

const DAYS: DayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const WEEKDAY_MAP: Record<string, DayOfWeek> = {
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
  Sun: 'SUN',
};

function resolveTodayDay(timezone?: string): DayOfWeek {
  try {
    const short = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Asia/Kolkata',
      weekday: 'short',
    }).format(new Date());
    return WEEKDAY_MAP[short] || 'MON';
  } catch {
    const fallback: DayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return fallback[new Date().getDay()] || 'MON';
  }
}

export function TrainingHubPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { dataVersion, bumpDataVersion } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab');
  const activeTab: TrainingTab =
    rawTab === 'exercises' || rawTab === 'templates' ? rawTab : 'split';

  const setActiveTab = (next: TrainingTab) => {
    setSearchParams({ tab: next }, { replace: true });
  };

  const weightUnit = user?.profile?.preferredWeightUnit || 'KG';
  const weightSuffix = weightUnitSuffix(weightUnit);
  const todayDay = resolveTodayDay(user?.profile?.timezone);

  const [loading, setLoading] = useState(true);
  const [split, setSplit] = useState<WorkoutDaySplit[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(() =>
    resolveTodayDay(user?.profile?.timezone)
  );

  // Add Exercise to Split Modal
  const [addExOpen, setAddExOpen] = useState(false);
  const [addTargetDay, setAddTargetDay] = useState<DayOfWeek>(() =>
    resolveTodayDay(user?.profile?.timezone)
  );
  const [exIdToAdd, setExIdToAdd] = useState('');
  const [targetSets, setTargetSets] = useState('3');
  const [targetReps, setTargetReps] = useState('8-12');
  const [restSeconds, setRestSeconds] = useState('90');
  const [targetWeightInput, setTargetWeightInput] = useState('');

  // Edit Split Exercise + Media Modal
  const [editingSplitEx, setEditingSplitEx] = useState<SplitExercise | null>(null);
  const [editSets, setEditSets] = useState('3');
  const [editReps, setEditReps] = useState('8-12');
  const [editRest, setEditRest] = useState('90');
  const [editWeight, setEditWeight] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Media Viewer & History Detail Modals
  const [mediaModalItem, setMediaModalItem] = useState<ExerciseDetailItem | null>(null);
  const [mediaModalSplitEx, setMediaModalSplitEx] = useState<SplitExercise | null>(null);
  const [selectedSession, setSelectedSession] = useState<WorkoutSession | null>(null);

  // Live Session State
  const [liveMode, setLiveMode] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('55');
  const [sessionNotes, setSessionNotes] = useState('');
  const [loggedExercises, setLoggedExercises] = useState<LoggedExercise[]>([]);
  const [restRemaining, setRestRemaining] = useState<number>(0);

  const loadAll = useCallback(async () => {
    try {
      const [splitRes, exRes, sesRes] = await Promise.all([
        api.get<WorkoutDaySplit[]>('/workouts/split'),
        api.get<Exercise[]>('/exercises'),
        api.get<WorkoutSession[]>('/workouts/sessions'),
      ]);
      setSplit(splitRes.data);
      setExercises(exRes.data);
      setSessions(sesRes.data);
      if (exRes.data.length > 0 && !exIdToAdd) {
        const first = exRes.data[0];
        setExIdToAdd(first.id);
        setTargetSets(String(first.defaultSets));
        setTargetReps(first.defaultReps);
        setRestSeconds(String(first.defaultRestSeconds ?? 90));
        const dw = kgToDisplay(first.defaultWeightKg ?? null, weightUnit);
        setTargetWeightInput(dw !== null ? String(dw) : '');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load workouts.', 'error');
    } finally {
      setLoading(false);
    }
  }, [exIdToAdd, showToast, weightUnit]);

  useEffect(() => {
    loadAll();
  }, [dataVersion, loadAll]);

  useEffect(() => {
    if (restRemaining <= 0) return;
    const timer = setInterval(() => {
      setRestRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [restRemaining]);

  const startLiveSessionForDay = useCallback(
    (daySplit: WorkoutDaySplit) => {
      if (daySplit.isRestDay) {
        showToast(
          `${daySplit.day} is scheduled as a Rest Day. Switch it to Training Day first to log sets.`,
          'info'
        );
        return;
      }
      setSelectedDay(daySplit.day);
      setSessionTitle(`${daySplit.day} — ${daySplit.focus}`);
      setDurationMinutes('55');
      setSessionNotes('');
      setLoggedExercises(
        daySplit.exercises.map((ex) => ({
          exerciseId: ex.exerciseId,
          exerciseName: ex.exerciseName,
          muscleGroup: ex.muscleGroup,
          imageUrl: ex.imageUrl ?? null,
          videoUrl: ex.videoUrl ?? null,
          instructions: ex.instructions ?? '',
          sets: Array.from({ length: ex.targetSets }, (_, i) => ({
            setNumber: i + 1,
            reps: parseInt(ex.targetReps, 10) || 10,
            weightKg: ex.targetWeightKg ?? 20,
            completed: false,
          })),
        }))
      );
      setLiveMode(true);
    },
    [showToast]
  );

  // Handle ?autostart=1 deep-link from Today / TopBar Quick Log
  useEffect(() => {
    if (loading || split.length === 0) return;
    if (searchParams.get('autostart') !== '1') return;

    const todaySplit = split.find((d) => d.day === todayDay) || {
      day: todayDay,
      focus: 'Training Day',
      isRestDay: false,
      exercises: [],
    };
    setSelectedDay(todayDay);
    startLiveSessionForDay(todaySplit);
    const next = new URLSearchParams(searchParams);
    next.delete('autostart');
    if (!next.get('tab')) next.set('tab', 'split');
    setSearchParams(next, { replace: true });
  }, [loading, split, searchParams, todayDay, startLiveSessionForDay, setSearchParams]);

  const currentDaySplit = split.find((d) => d.day === selectedDay) || {
    day: selectedDay,
    focus: 'Training Day',
    isRestDay: false,
    exercises: [],
  };

  const saveDaySplit = async (nextDay: WorkoutDaySplit) => {
    try {
      const res = await api.put<WorkoutDaySplit[]>(`/workouts/split/${nextDay.day}`, {
        focus: nextDay.focus,
        isRestDay: nextDay.isRestDay,
        exercises: nextDay.exercises.map((e) => ({
          id: e.id,
          exerciseId: e.exerciseId,
          targetSets: e.targetSets,
          targetReps: e.targetReps,
          restSeconds: e.restSeconds,
          targetWeightKg: e.targetWeightKg ?? null,
        })),
      });
      setSplit(res.data);
      bumpDataVersion('workout');
      showToast(`${nextDay.day} split saved.`, 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save split.', 'error');
    }
  };

  const handleSelectExerciseToAdd = (id: string) => {
    setExIdToAdd(id);
    const ex = exercises.find((e) => e.id === id);
    if (ex) {
      setTargetSets(String(ex.defaultSets));
      setTargetReps(ex.defaultReps);
      setRestSeconds(String(ex.defaultRestSeconds ?? 90));
      const dw = kgToDisplay(ex.defaultWeightKg ?? null, weightUnit);
      setTargetWeightInput(dw !== null ? String(dw) : '');
    }
  };

  const openAddModalForDay = (day: DayOfWeek, preselectedEx?: Exercise) => {
    setAddTargetDay(day);
    if (preselectedEx) {
      setExIdToAdd(preselectedEx.id);
      setTargetSets(String(preselectedEx.defaultSets));
      setTargetReps(preselectedEx.defaultReps);
      setRestSeconds(String(preselectedEx.defaultRestSeconds ?? 90));
      const dw = kgToDisplay(preselectedEx.defaultWeightKg ?? null, weightUnit);
      setTargetWeightInput(dw !== null ? String(dw) : '');
    }
    setAddExOpen(true);
  };

  const handleAddExerciseToDay = async (e: FormEvent) => {
    e.preventDefault();
    const ex = exercises.find((item) => item.id === exIdToAdd);
    if (!ex) return;

    const targetSplit = split.find((d) => d.day === addTargetDay) || {
      day: addTargetDay,
      focus: 'Training Day',
      isRestDay: false,
      exercises: [],
    };

    const weightKg = targetWeightInput.trim()
      ? displayToKg(targetWeightInput, weightUnit)
      : ex.defaultWeightKg ?? null;
    const parsedRest = Number(restSeconds);

    const nextDay: WorkoutDaySplit = {
      ...targetSplit,
      isRestDay: false,
      exercises: [
        ...targetSplit.exercises,
        {
          id: `tmp_${Date.now()}`,
          exerciseId: ex.id,
          exerciseName: ex.name,
          muscleGroup: ex.muscleGroup,
          targetSets: Number(targetSets),
          targetReps: targetReps.trim(),
          restSeconds: Number.isFinite(parsedRest) && parsedRest >= 0 ? parsedRest : 90,
          targetWeightKg: weightKg,
          instructions: ex.instructions,
          imageUrl: ex.imageUrl ?? null,
          videoUrl: ex.videoUrl ?? null,
        },
      ],
    };
    setAddExOpen(false);
    setSelectedDay(addTargetDay);
    await saveDaySplit(nextDay);
  };

  const openEditSplitExercise = (spEx: SplitExercise) => {
    setEditingSplitEx(spEx);
    setEditSets(String(spEx.targetSets));
    setEditReps(spEx.targetReps);
    setEditRest(String(spEx.restSeconds));
    const dw = kgToDisplay(spEx.targetWeightKg ?? null, weightUnit);
    setEditWeight(dw !== null ? String(dw) : '');
    setEditInstructions(spEx.instructions || '');
    setEditImageUrl(spEx.imageUrl || '');
    setEditVideoUrl(spEx.videoUrl || '');
  };

  const handleSaveSplitExerciseEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingSplitEx) return;
    setSavingEdit(true);
    try {
      const nextWeightKg = editWeight.trim() ? displayToKg(editWeight, weightUnit) : null;
      const parsedRest = Number(editRest);

      await api.patch(`/exercises/${editingSplitEx.exerciseId}/media`, {
        imageUrl: editImageUrl.trim() || null,
        videoUrl: editVideoUrl.trim() || null,
        instructions: editInstructions.trim(),
        defaultWeightKg: nextWeightKg,
      });

      const nextDay: WorkoutDaySplit = {
        ...currentDaySplit,
        exercises: currentDaySplit.exercises.map((item) =>
          item.id === editingSplitEx.id
            ? {
                ...item,
                targetSets: Number(editSets) || item.targetSets,
                targetReps: editReps.trim() || item.targetReps,
                restSeconds:
                  Number.isFinite(parsedRest) && parsedRest >= 0 ? parsedRest : item.restSeconds,
                targetWeightKg: nextWeightKg,
                instructions: editInstructions.trim(),
                imageUrl: editImageUrl.trim() || null,
                videoUrl: editVideoUrl.trim() || null,
              }
            : item
        ),
      };
      await saveDaySplit(nextDay);
      setEditingSplitEx(null);
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update exercise.', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRemoveExerciseFromDay = async (spId: string) => {
    const nextDay: WorkoutDaySplit = {
      ...currentDaySplit,
      exercises: currentDaySplit.exercises.filter((e) => e.id !== spId),
    };
    await saveDaySplit(nextDay);
  };

  const updateSetField = (
    exIdx: number,
    setIdx: number,
    field: 'reps' | 'weightKg' | 'completed',
    value: number | boolean
  ) => {
    setLoggedExercises((prev) =>
      prev.map((ex, i) =>
        i !== exIdx
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, j) => (j !== setIdx ? s : { ...s, [field]: value })),
            }
      )
    );
  };

  const markAllExercisesInSession = (completed: boolean) => {
    setLoggedExercises((prev) =>
      prev.map((ex) => ({
        ...ex,
        sets: ex.sets.map((s) => ({ ...s, completed })),
      }))
    );
    showToast(
      completed ? 'Marked all exercises as done.' : 'Cleared all exercise marks.',
      completed ? 'success' : 'info'
    );
  };

  const markExerciseSets = (exIdx: number, completed: boolean) => {
    setLoggedExercises((prev) =>
      prev.map((ex, i) =>
        i !== exIdx
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s) => ({ ...s, completed })),
            }
      )
    );
  };

  const handleFinishSession = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/workouts/sessions', {
        day: selectedDay,
        title: sessionTitle.trim() || currentDaySplit.focus,
        durationMinutes: Number(durationMinutes),
        notes: sessionNotes.trim(),
        exercises: loggedExercises,
      });
      setLiveMode(false);
      setRestRemaining(0);
      bumpDataVersion('workout');
      showToast('Workout session saved!', 'success');
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save session.', 'error');
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await api.delete(`/workouts/sessions/${id}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (selectedSession?.id === id) setSelectedSession(null);
      bumpDataVersion('workout');
      showToast('Session deleted.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete session.', 'error');
    }
  };

  const openSplitExercisePreview = (ex: SplitExercise) => {
    setMediaModalSplitEx(ex);
    setMediaModalItem({
      name: ex.exerciseName,
      muscleGroup: ex.muscleGroup,
      sets: ex.targetSets,
      reps: ex.targetReps,
      restSeconds: ex.restSeconds,
      targetWeightKg: ex.targetWeightKg ?? null,
      instructions: ex.instructions,
      imageUrl: ex.imageUrl ?? null,
      videoUrl: ex.videoUrl ?? null,
    });
  };

  if (loading) return <LoadingSpinner label="Loading Training hub..." />;

  const selectedAddEx = exercises.find((e) => e.id === exIdToAdd);
  const activeTrainingDays = split.filter((d) => !d.isRestDay).length;
  const totalSessionSets = loggedExercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  const completedSessionSets = loggedExercises.reduce(
    (sum, ex) => sum + ex.sets.filter((s) => s.completed).length,
    0
  );
  const allSessionMarked = totalSessionSets > 0 && completedSessionSets === totalSessionSets;

  return (
    <div className="space-y-4">
      {/* Unified Hub Switcher + Quick Context Header */}
      <Card className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-[9px] bg-[#0D121A] border border-[#252D38] w-fit">
            {[
              { id: 'split' as const, label: 'Weekly Split & Logger' },
              { id: 'exercises' as const, label: `Exercise Library (${exercises.length})` },
              { id: 'templates' as const, label: 'Workout Templates' },
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

          <div className="flex flex-wrap items-center gap-3 text-xs text-[#929BAA] font-mono tabular-nums">
            <span>{activeTrainingDays}/7 training days</span>
            <span aria-hidden="true" className="text-[#626C7B]">
              ·
            </span>
            <span>{sessions.length} logged sessions</span>
            {restRemaining > 0 && (
              <div className="flex items-center gap-1.5 rounded-[8px] bg-[#26351D] border border-[#B6F36A]/35 px-2.5 py-1 text-xs font-mono text-[#B6F36A]">
                <Timer className="h-3.5 w-3.5" />
                Rest: {restRemaining}s
              </div>
            )}
          </div>
        </div>

        {activeTab === 'split' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#202733]">
            <div className="flex flex-wrap items-center gap-1.5">
              {DAYS.map((d) => {
                const info = split.find((s) => s.day === d);
                const isToday = d === todayDay;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setSelectedDay(d);
                      setLiveMode(false);
                    }}
                    className={`relative px-3 py-2 rounded-[9px] text-xs font-medium transition-colors cursor-pointer ${
                      selectedDay === d
                        ? 'bg-[#26351D] text-[#B6F36A] border border-[#B6F36A]/30'
                        : 'bg-[#0D121A] text-[#929BAA] border border-[#252D38] hover:text-[#F5F7FA]'
                    }`}
                  >
                    <span className="font-mono">{d}</span>
                    {isToday && (
                      <span
                        className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#B6F36A] align-middle"
                        title="Today"
                      />
                    )}
                    {info?.isRestDay && (
                      <span className="ml-1.5 text-[10px] text-[#626C7B]">Rest</span>
                    )}
                  </button>
                );
              })}
            </div>

            {!liveMode && (
              <Button
                size="sm"
                onClick={() => startLiveSessionForDay(currentDaySplit)}
                disabled={currentDaySplit.isRestDay}
              >
                <Play className="h-3.5 w-3.5" />
                Start {selectedDay} Session
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* Active Tab Content */}
      {activeTab === 'split' &&
        (liveMode ? (
          <Card className="p-4 sm:p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#202733] pb-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                  Live Workout Logger
                </h2>
                <p className="text-xs text-[#929BAA]">
                  Tap Mark as you finish each set to auto-start your rest timer.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {loggedExercises.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant={allSessionMarked ? 'primary' : 'secondary'}
                    onClick={() => markAllExercisesInSession(!allSessionMarked)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {allSessionMarked ? 'Unmark All' : 'Mark All'}
                    {totalSessionSets > 0 ? ` (${completedSessionSets}/${totalSessionSets})` : ''}
                  </Button>
                )}
                {[60, 90, 120].map((sec) => (
                  <Button
                    key={sec}
                    size="sm"
                    variant="secondary"
                    onClick={() => setRestRemaining(sec)}
                  >
                    <Timer className="h-3.5 w-3.5 text-[#B6F36A]" />
                    {sec}s
                  </Button>
                ))}
                {restRemaining > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setRestRemaining(0)}>
                    Skip
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setLiveMode(false)}>
                  Cancel
                </Button>
              </div>
            </div>

            <form onSubmit={handleFinishSession} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Session Title"
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  required
                />
                <Input
                  label="Duration (minutes)"
                  type="number"
                  min="1"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  required
                />
              </div>

              {loggedExercises.length === 0 ? (
                <EmptyState
                  title="No exercises in this day's split"
                  description="Add exercises to this day's split first, or save a quick conditioning log."
                />
              ) : (
                <div className="space-y-5 divide-y divide-[#202733]">
                  {loggedExercises.map((ex, exIdx) => {
                    const matchingSplit = currentDaySplit.exercises[exIdx];
                    return (
                      <div key={`${ex.exerciseId}-${exIdx}`} className="pt-4 first:pt-0 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <ExerciseMediaThumbnail
                              name={ex.exerciseName}
                              muscleGroup={ex.muscleGroup}
                              imageUrl={ex.imageUrl}
                              videoUrl={ex.videoUrl}
                              size="sm"
                              onClick={() => {
                                setMediaModalSplitEx(null);
                                setMediaModalItem({
                                  name: ex.exerciseName,
                                  muscleGroup: ex.muscleGroup,
                                  sets: matchingSplit?.targetSets,
                                  reps: matchingSplit?.targetReps,
                                  restSeconds: matchingSplit?.restSeconds,
                                  targetWeightKg: matchingSplit?.targetWeightKg ?? null,
                                  instructions: ex.instructions,
                                  imageUrl: ex.imageUrl ?? null,
                                  videoUrl: ex.videoUrl ?? null,
                                });
                              }}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[#F5F7FA] truncate">
                                {ex.exerciseName}
                              </div>
                              <div className="text-[11px] text-[#929BAA]">
                                {ex.muscleGroup}
                                {matchingSplit?.restSeconds !== undefined
                                  ? ` · ${matchingSplit.restSeconds}s rest`
                                  : ''}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                const exDone =
                                  ex.sets.length > 0 && ex.sets.every((s) => s.completed);
                                markExerciseSets(exIdx, !exDone);
                              }}
                              className={`inline-flex items-center gap-1 rounded-[7px] px-2.5 py-1.5 text-[11px] font-medium border transition-colors cursor-pointer ${
                                ex.sets.length > 0 && ex.sets.every((s) => s.completed)
                                  ? 'bg-[#26351D] text-[#B6F36A] border-[#B6F36A]/35'
                                  : 'bg-[#171E29] text-[#929BAA] border-[#252D38] hover:text-[#F5F7FA]'
                              }`}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {ex.sets.length > 0 && ex.sets.every((s) => s.completed)
                                ? 'Done'
                                : 'Mark Ex'}
                            </button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setMediaModalSplitEx(null);
                                setMediaModalItem({
                                  name: ex.exerciseName,
                                  muscleGroup: ex.muscleGroup,
                                  sets: matchingSplit?.targetSets,
                                  reps: matchingSplit?.targetReps,
                                  restSeconds: matchingSplit?.restSeconds,
                                  targetWeightKg: matchingSplit?.targetWeightKg ?? null,
                                  instructions: ex.instructions,
                                  imageUrl: ex.imageUrl ?? null,
                                  videoUrl: ex.videoUrl ?? null,
                                });
                              }}
                            >
                              <Eye className="h-3.5 w-3.5 text-[#B6F36A]" />
                              Demo
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {ex.sets.map((s, setIdx) => {
                            const displayWeightVal =
                              weightUnit === 'LBS'
                                ? kgToDisplay(s.weightKg, 'LBS') ?? 0
                                : s.weightKg;
                            return (
                              <div
                                key={s.setNumber}
                                className="grid grid-cols-12 items-center gap-2 text-xs"
                              >
                                <div className="col-span-2 font-mono text-[#929BAA]">
                                  Set {s.setNumber}
                                </div>
                                <div className="col-span-4 relative">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={displayWeightVal}
                                    onChange={(e) => {
                                      const kg = displayToKg(e.target.value, weightUnit) ?? 0;
                                      updateSetField(exIdx, setIdx, 'weightKg', kg);
                                    }}
                                    className="w-full h-11 sm:h-9 rounded-[8px] bg-[#0D121A] border border-[#252D38] px-2.5 pr-9 font-mono text-[#F5F7FA]"
                                    aria-label={`Weight (${weightSuffix})`}
                                  />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#626C7B]">
                                    {weightSuffix}
                                  </span>
                                </div>
                                <div className="col-span-3 relative">
                                  <input
                                    type="number"
                                    min="0"
                                    value={s.reps}
                                    onChange={(e) =>
                                      updateSetField(exIdx, setIdx, 'reps', Number(e.target.value))
                                    }
                                    className="w-full h-11 sm:h-9 rounded-[8px] bg-[#0D121A] border border-[#252D38] px-2.5 pr-10 font-mono text-[#F5F7FA]"
                                    aria-label="Reps"
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#626C7B]">
                                    reps
                                  </span>
                                </div>
                                <div className="col-span-3 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = !s.completed;
                                      updateSetField(exIdx, setIdx, 'completed', next);
                                      if (next) {
                                        const restSec = matchingSplit?.restSeconds ?? 90;
                                        if (restSec > 0) setRestRemaining(restSec);
                                      }
                                    }}
                                    className={`inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3 min-h-[44px] sm:min-h-[36px] font-medium transition-colors cursor-pointer ${
                                      s.completed
                                        ? 'bg-[#26351D] text-[#B6F36A] border border-[#B6F36A]/30'
                                        : 'bg-[#171E29] text-[#929BAA] border border-[#252D38]'
                                    }`}
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    {s.completed ? 'Done' : 'Mark'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <Input
                label="Session Notes (Optional)"
                placeholder="How did strength and energy feel today?"
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
              />

              <div className="flex justify-end">
                <Button type="submit">
                  <Save className="h-4 w-4" />
                  Complete & Save Session
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Selected Day Split Config */}
            <Card className="lg:col-span-7 p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                    {selectedDay} Split — {currentDaySplit.focus}
                  </h2>
                  <p className="text-xs text-[#929BAA]">
                    Click any movement to view demo media & form cues.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      saveDaySplit({ ...currentDaySplit, isRestDay: !currentDaySplit.isRestDay })
                    }
                  >
                    {currentDaySplit.isRestDay ? 'Set Training Day' : 'Set Rest Day'}
                  </Button>
                  <Button size="sm" onClick={() => openAddModalForDay(selectedDay)}>
                    <Plus className="h-4 w-4" />
                    Add Exercise
                  </Button>
                </div>
              </div>

              {currentDaySplit.isRestDay ? (
                <EmptyState
                  title="Scheduled Rest & Recovery Day"
                  description="Use this day for mobility, stretching, or light walking. Toggle to Training Day anytime."
                />
              ) : currentDaySplit.exercises.length === 0 ? (
                <EmptyState
                  icon={Dumbbell}
                  title={`No exercises scheduled for ${selectedDay}`}
                  description="Add movements from your Exercise Library to build your weekly split."
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openAddModalForDay(selectedDay)}
                    >
                      Add First Exercise
                    </Button>
                  }
                />
              ) : (
                <div className="divide-y divide-[#202733]">
                  {currentDaySplit.exercises.map((ex, idx) => {
                    const dw = kgToDisplay(ex.targetWeightKg ?? null, weightUnit);
                    return (
                      <div
                        key={ex.id}
                        className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <ExerciseMediaThumbnail
                            name={ex.exerciseName}
                            muscleGroup={ex.muscleGroup}
                            imageUrl={ex.imageUrl}
                            videoUrl={ex.videoUrl}
                            size="sm"
                            onClick={() => openSplitExercisePreview(ex)}
                          />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => openSplitExercisePreview(ex)}
                              className="text-left text-sm font-medium text-[#F5F7FA] hover:text-[#B6F36A] transition-colors truncate block cursor-pointer"
                            >
                              {idx + 1}. {ex.exerciseName}
                            </button>
                            <div className="text-xs text-[#929BAA] font-mono tabular-nums mt-0.5">
                              {ex.muscleGroup} · {ex.targetSets} sets × {ex.targetReps} reps ·{' '}
                              {ex.restSeconds}s rest
                              {dw !== null ? ` · ${dw} ${weightSuffix}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openSplitExercisePreview(ex)}
                            className="p-1.5 rounded-md text-[#626C7B] hover:text-[#B6F36A] hover:bg-[#171E29] cursor-pointer"
                            aria-label={`View ${ex.exerciseName} media`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditSplitExercise(ex)}
                            className="p-1.5 rounded-md text-[#626C7B] hover:text-[#F5F7FA] hover:bg-[#171E29] cursor-pointer"
                            aria-label={`Edit ${ex.exerciseName}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveExerciseFromDay(ex.id)}
                            className="p-1.5 rounded-md text-[#626C7B] hover:text-[#F16C75] hover:bg-[#171E29] cursor-pointer"
                            aria-label={`Remove ${ex.exerciseName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Recent Completed Sessions */}
            <Card className="lg:col-span-5 p-4 sm:p-5 space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                  Recent Sessions
                </h2>
                <p className="text-xs text-[#929BAA]">
                  Click a session to inspect logged sets and weights.
                </p>
              </div>

              {sessions.length === 0 ? (
                <EmptyState
                  title="No completed workouts yet"
                  description="Click Start Session above to log sets, reps, and weights in real time."
                />
              ) : (
                <div className="divide-y divide-[#202733]">
                  {sessions.slice(0, 8).map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedSession(s)}
                        className="min-w-0 text-left flex-1 group cursor-pointer"
                      >
                        <div className="text-sm font-medium text-[#F5F7FA] group-hover:text-[#B6F36A] transition-colors truncate">
                          {s.title}
                        </div>
                        <div className="text-xs font-mono text-[#929BAA] tabular-nums mt-0.5">
                          {s.date} · {s.durationMinutes} min · {s.totalVolumeKg.toLocaleString()} kg ·{' '}
                          {s.exercises.length} exercises
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedSession(s)}
                          className="p-1.5 text-[#626C7B] hover:text-[#B6F36A] cursor-pointer"
                          aria-label={`Inspect session ${s.title}`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSession(s.id)}
                          className="p-1.5 text-[#626C7B] hover:text-[#F16C75] cursor-pointer"
                          aria-label="Delete session"
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
        ))}

      {activeTab === 'exercises' && (
        <ExerciseLibraryPage
          onAddToSplit={(ex) => openAddModalForDay(selectedDay, ex)}
          onLibraryChanged={loadAll}
        />
      )}

      {activeTab === 'templates' && (
        <SavedPlansPanel planType="WORKOUT" onPlanApplied={loadAll} />
      )}

      {/* Exercise Media & Details Modal */}
      <ExerciseMediaModal
        open={Boolean(mediaModalItem)}
        onClose={() => {
          setMediaModalItem(null);
          setMediaModalSplitEx(null);
        }}
        exercise={mediaModalItem}
        weightUnitLabel={weightSuffix}
        displayWeight={
          mediaModalItem
            ? kgToDisplay(mediaModalItem.targetWeightKg ?? null, weightUnit)
            : null
        }
        onEditMedia={
          mediaModalSplitEx
            ? () => {
                const target = mediaModalSplitEx;
                setMediaModalItem(null);
                setMediaModalSplitEx(null);
                openEditSplitExercise(target);
              }
            : undefined
        }
      />

      {/* Session History Detail Modal */}
      <Modal
        open={Boolean(selectedSession)}
        onClose={() => setSelectedSession(null)}
        title={selectedSession?.title || 'Workout Session'}
        subtitle={
          selectedSession
            ? `${selectedSession.date} · ${selectedSession.durationMinutes} min · ${selectedSession.totalVolumeKg.toLocaleString()} kg volume`
            : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {selectedSession && (
          <div className="space-y-4">
            {selectedSession.notes && (
              <p className="text-xs text-[#929BAA] rounded-[9px] bg-[#0D121A] border border-[#202733] p-3">
                {selectedSession.notes}
              </p>
            )}
            <div className="space-y-3 divide-y divide-[#202733]">
              {selectedSession.exercises.map((ex, idx) => (
                <div key={`${ex.exerciseId}-${idx}`} className="pt-3 first:pt-0 space-y-2">
                  <div className="flex items-center gap-3">
                    <ExerciseMediaThumbnail
                      name={ex.exerciseName}
                      muscleGroup={ex.muscleGroup}
                      imageUrl={ex.imageUrl}
                      videoUrl={ex.videoUrl}
                      size="sm"
                      onClick={() => {
                        setMediaModalSplitEx(null);
                        setMediaModalItem({
                          name: ex.exerciseName,
                          muscleGroup: ex.muscleGroup,
                          instructions: ex.instructions,
                          imageUrl: ex.imageUrl ?? null,
                          videoUrl: ex.videoUrl ?? null,
                        });
                      }}
                    />
                    <div>
                      <div className="text-sm font-semibold text-[#F5F7FA]">{ex.exerciseName}</div>
                      <div className="text-[11px] text-[#929BAA]">{ex.muscleGroup}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ex.sets.map((s) => (
                      <div
                        key={s.setNumber}
                        className={`rounded-[7px] px-2.5 py-1 text-xs font-mono tabular-nums border ${
                          s.completed
                            ? 'bg-[#26351D]/60 border-[#B6F36A]/30 text-[#F5F7FA]'
                            : 'bg-[#0D121A] border-[#252D38] text-[#626C7B]'
                        }`}
                      >
                        #{s.setNumber}: {kgToDisplay(s.weightKg, weightUnit)} {weightSuffix} ×{' '}
                        {s.reps}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={() => setSelectedSession(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Split Exercise + Media Modal */}
      <Modal
        open={Boolean(editingSplitEx)}
        onClose={() => setEditingSplitEx(null)}
        title={`Edit ${editingSplitEx?.exerciseName || 'Exercise'}`}
        subtitle="Adjust split targets and update demonstration image/video."
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSaveSplitExerciseEdit} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Input
              label="Target Sets"
              type="number"
              min="1"
              value={editSets}
              onChange={(e) => setEditSets(e.target.value)}
              required
            />
            <Input
              label="Reps"
              value={editReps}
              onChange={(e) => setEditReps(e.target.value)}
              required
            />
            <Input
              label="Rest (sec)"
              type="number"
              min="0"
              value={editRest}
              onChange={(e) => setEditRest(e.target.value)}
              required
            />
            <Input
              label={`Weight (${weightSuffix})`}
              type="number"
              min="0"
              step="0.5"
              placeholder="Optional"
              value={editWeight}
              onChange={(e) => setEditWeight(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#929BAA]">Form Cues / Instructions</label>
            <textarea
              rows={2}
              value={editInstructions}
              onChange={(e) => setEditInstructions(e.target.value)}
              className="w-full rounded-[9px] bg-[#0D121A] border border-[#252D38] p-3 text-sm text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A]"
              placeholder="Key cues for execution..."
            />
          </div>

          <ExerciseMediaFields
            imageUrl={editImageUrl}
            videoUrl={editVideoUrl}
            onImageChange={setEditImageUrl}
            onVideoChange={setEditVideoUrl}
            onError={(msg) => showToast(msg, 'error')}
          />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditingSplitEx(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={savingEdit}>
              {savingEdit ? 'Saving...' : 'Save Exercise'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Exercise to Split Modal */}
      <Modal
        open={addExOpen}
        onClose={() => setAddExOpen(false)}
        title={`Add Exercise to ${addTargetDay}`}
      >
        <form onSubmit={handleAddExerciseToDay} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Select
                label="Exercise"
                value={exIdToAdd}
                onChange={(e) => handleSelectExerciseToAdd(e.target.value)}
                options={exercises.map((e) => ({
                  value: e.id,
                  label: `${e.name} (${e.muscleGroup})`,
                }))}
              />
            </div>
            <Select
              label="Target Day"
              value={addTargetDay}
              onChange={(e) => setAddTargetDay(e.target.value as DayOfWeek)}
              options={DAYS.map((d) => ({ value: d, label: d }))}
            />
          </div>
          {selectedAddEx && (
            <div className="flex items-center gap-3 rounded-[9px] border border-[#202733] bg-[#0D121A] p-2.5">
              <ExerciseMediaThumbnail
                name={selectedAddEx.name}
                muscleGroup={selectedAddEx.muscleGroup}
                imageUrl={selectedAddEx.imageUrl}
                videoUrl={selectedAddEx.videoUrl}
                size="sm"
              />
              <div className="text-xs text-[#929BAA] min-w-0">
                <div className="font-medium text-[#F5F7FA] truncate">{selectedAddEx.name}</div>
                <div className="truncate">
                  {selectedAddEx.videoUrl || selectedAddEx.imageUrl
                    ? 'Demonstration media attached'
                    : 'No media attached yet (editable anytime)'}
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Input
              label="Target Sets"
              type="number"
              min="1"
              value={targetSets}
              onChange={(e) => setTargetSets(e.target.value)}
              required
            />
            <Input
              label="Reps"
              value={targetReps}
              onChange={(e) => setTargetReps(e.target.value)}
              required
            />
            <Input
              label="Rest (sec)"
              type="number"
              min="0"
              value={restSeconds}
              onChange={(e) => setRestSeconds(e.target.value)}
              required
            />
            <Input
              label={`Weight (${weightSuffix})`}
              type="number"
              min="0"
              step="0.5"
              placeholder="Optional"
              value={targetWeightInput}
              onChange={(e) => setTargetWeightInput(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddExOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add to {addTargetDay}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
