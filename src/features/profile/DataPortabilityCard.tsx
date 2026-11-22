import { useRef, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Dumbbell,
  Eye,
  FileJson,
  Ruler,
  ShieldCheck,
  Trash2,
  Upload,
  Utensils,
} from 'lucide-react';
import { ApiError, api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type {
  DocumentedJsonSchema,
  ImportCategorySummary,
  ImportCommitResult,
  ImportExportScope,
  ImportMode,
  ImportPreviewResult,
  ImportValidationIssue,
  PreviewRecordEntry,
} from '../../types/fittrack';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';

interface DataPortabilityCardProps {
  onOpenClearLogs: () => void;
}

const SCOPE_OPTIONS: Array<{
  scope: ImportExportScope;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Utensils;
}> = [
  {
    scope: 'DIET',
    label: 'Diet Plan & Foods',
    shortLabel: 'Diet',
    description: 'Foods library, planned meals, meal logs, and diet templates',
    icon: Utensils,
  },
  {
    scope: 'WORKOUT',
    label: 'Workout Split & Exercises',
    shortLabel: 'Workout',
    description: 'Exercises, weekly split, workout sessions, and workout templates',
    icon: Dumbbell,
  },
  {
    scope: 'MEASUREMENTS',
    label: 'Body Measurements',
    shortLabel: 'Measurements',
    description: 'Weight, body fat, tape circumferences, and custom metrics',
    icon: Ruler,
  },
  {
    scope: 'FULL_BACKUP',
    label: 'Complete Backup',
    shortLabel: 'Complete Backup',
    description: 'All profile targets, diet, workout, measurements, and saved plans',
    icon: FileJson,
  },
];

const RECORD_SECTIONS: Array<{
  key: keyof ImportPreviewResult['records'];
  label: string;
}> = [
  { key: 'profile', label: 'Fitness Profile & Targets' },
  { key: 'foods', label: 'Foods Library' },
  { key: 'plannedMeals', label: 'Planned Meals' },
  { key: 'mealLogs', label: 'Meal Logs' },
  { key: 'exercises', label: 'Exercise Library' },
  { key: 'workoutSplit', label: 'Weekly Workout Split' },
  { key: 'workoutSessions', label: 'Workout Sessions' },
  { key: 'measurements', label: 'Body Measurements' },
  { key: 'savedPlans', label: 'Saved Plan Templates' },
];

function mapMuscleGroupAlias(val: unknown): { value: unknown; changed: boolean } {
  if (typeof val !== 'string') return { value: val, changed: false };
  const upper = val.trim().toUpperCase();
  if (upper === 'TRICEPS' || upper === 'BICEPS') {
    return { value: 'ARMS', changed: val !== 'ARMS' };
  }
  if (upper === 'ABS') {
    return { value: 'CORE', changed: val !== 'CORE' };
  }
  return { value: val, changed: false };
}

function normalizeWorkoutJsonMuscleGroups(payload: unknown): {
  normalized: unknown;
  replacements: number;
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { normalized: payload, replacements: 0 };
  }

  let replacements = 0;
  const clone = structuredClone(payload) as Record<string, unknown>;

  const fixExerciseArray = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (item && typeof item === 'object' && 'muscleGroup' in item) {
        const record = item as Record<string, unknown>;
        const mapped = mapMuscleGroupAlias(record.muscleGroup);
        if (mapped.changed) {
          record.muscleGroup = mapped.value;
          replacements += 1;
        }
      }
    }
  };

  fixExerciseArray(clone.exercises);

  if (Array.isArray(clone.workoutSplit)) {
    for (const day of clone.workoutSplit) {
      if (day && typeof day === 'object') {
        fixExerciseArray((day as Record<string, unknown>).exercises);
      }
    }
  }

  if (Array.isArray(clone.workoutSessions)) {
    for (const sess of clone.workoutSessions) {
      if (sess && typeof sess === 'object') {
        fixExerciseArray((sess as Record<string, unknown>).exercises);
      }
    }
  }

  if (Array.isArray(clone.savedPlans)) {
    for (const plan of clone.savedPlans) {
      if (
        plan &&
        typeof plan === 'object' &&
        (plan as Record<string, unknown>).type === 'WORKOUT' &&
        Array.isArray((plan as Record<string, unknown>).payload)
      ) {
        for (const day of (plan as Record<string, unknown>).payload as unknown[]) {
          if (day && typeof day === 'object') {
            fixExerciseArray((day as Record<string, unknown>).exercises);
          }
        }
      }
    }
  }

  return { normalized: clone, replacements };
}

export function DataPortabilityCard({ onOpenClearLogs }: DataPortabilityCardProps) {
  const { refreshAuth } = useAuth();
  const { showToast } = useToast();
  const { bumpDataVersion } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [exportingScope, setExportingScope] = useState<ImportExportScope | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [schemaDoc, setSchemaDoc] = useState<DocumentedJsonSchema | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);

  const [importScope, setImportScope] = useState<ImportExportScope>('DIET');
  const [importMode, setImportMode] = useState<ImportMode>('MERGE');
  const [rawJson, setRawJson] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);

  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ImportValidationIssue[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);

  const handleExport = async (scope: ImportExportScope) => {
    setExportingScope(scope);
    try {
      const res = await api.get<unknown>(`/data/export?scope=${scope}`);
      const slug =
        scope === 'FULL_BACKUP' ? 'full-backup' : scope.toLowerCase();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fittrack-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${slug.replace('-', ' ')} as JSON.`, 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Export failed.', 'error');
    } finally {
      setExportingScope(null);
    }
  };

  const loadSchemaDoc = async () => {
    setSchemaModalOpen(true);
    if (schemaDoc) return;
    setLoadingSchema(true);
    try {
      const res = await api.get<DocumentedJsonSchema>('/data/schema');
      setSchemaDoc(res.data);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load JSON schema.', 'error');
    } finally {
      setLoadingSchema(false);
    }
  };

  const resetImportWorkspace = () => {
    setValidationErrors([]);
    setPreview(null);
    setCommitResult(null);
  };

  const openImportModal = (initialScope: ImportExportScope = 'DIET') => {
    setImportScope(initialScope);
    setImportMode('MERGE');
    setRawJson('');
    setFileName(null);
    resetImportWorkspace();
    setImportModalOpen(true);
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setValidationErrors([
        { field: 'file', message: 'JSON file exceeds 15 MB size limit.' },
      ]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setRawJson(text);
      setFileName(file.name);
      resetImportWorkspace();
    };
    reader.onerror = () => {
      setValidationErrors([{ field: 'file', message: 'Unable to read the selected file.' }]);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleLoadSample = async () => {
    try {
      let doc = schemaDoc;
      if (!doc) {
        const res = await api.get<DocumentedJsonSchema>('/data/schema');
        doc = res.data;
        setSchemaDoc(doc);
      }
      const sampleObj =
        importScope === 'FULL_BACKUP'
          ? {
              schemaVersion: doc.schemaVersion,
              exportType: 'FULL_BACKUP',
              ...doc.examples.DIET,
              ...doc.examples.WORKOUT,
              ...doc.examples.MEASUREMENTS,
            }
          : doc.examples[importScope];
      setRawJson(JSON.stringify(sampleObj, null, 2));
      setFileName(null);
      resetImportWorkspace();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load sample JSON.', 'error');
    }
  };

  const parseRawJsonPayload = (): unknown | null => {
    if (!rawJson.trim()) {
      setValidationErrors([
        { field: 'json', message: 'Upload a JSON file or paste JSON content first.' },
      ]);
      return null;
    }
    try {
      return JSON.parse(rawJson);
    } catch (err: unknown) {
      setValidationErrors([
        {
          field: 'json',
          message: `Invalid JSON syntax: ${err instanceof Error ? err.message : 'Unable to parse JSON.'}`,
        },
      ]);
      return null;
    }
  };

  const handleValidateAndPreview = async () => {
    resetImportWorkspace();
    const parsedPayload = parseRawJsonPayload();
    if (!parsedPayload) return;

    const { normalized, replacements } = normalizeWorkoutJsonMuscleGroups(parsedPayload);
    if (replacements > 0) {
      setRawJson(JSON.stringify(normalized, null, 2));
      showToast(
        `Replaced ${replacements} TRICEPS/BICEPS/ABS muscleGroup value(s) with ARMS/CORE.`,
        'info'
      );
    }

    setValidating(true);
    try {
      const res = await api.post<ImportPreviewResult>('/data/import/preview', {
        importType: importScope,
        mode: importMode,
        payload: normalized,
      });
      setPreview(res.data);
      if (!res.data.valid && res.data.errors.length > 0) {
        setValidationErrors(res.data.errors);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setValidationErrors(err.details as ImportValidationIssue[]);
      } else {
        setValidationErrors([
          {
            field: 'import',
            message: err instanceof Error ? err.message : 'Validation failed.',
          },
        ]);
      }
    } finally {
      setValidating(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!preview?.valid) return;
    const parsedPayload = parseRawJsonPayload();
    if (!parsedPayload) return;

    setCommitting(true);
    setValidationErrors([]);
    try {
      const res = await api.post<ImportCommitResult>('/data/import/commit', {
        importType: importScope,
        mode: importMode,
        payload: parsedPayload,
      });
      setCommitResult(res.data);
      setPreview(null);
      await refreshAuth();
      bumpDataVersion('all');
      showToast('Data imported and committed to FitTrack.', 'success');
    } catch (err: unknown) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setValidationErrors(err.details as ImportValidationIssue[]);
      } else {
        setValidationErrors([
          {
            field: 'commit',
            message:
              err instanceof Error
                ? err.message
                : 'Import failed and all database changes were rolled back.',
          },
        ]);
      }
      showToast(err instanceof Error ? err.message : 'Import failed.', 'error');
    } finally {
      setCommitting(false);
    }
  };

  const hasActionableChanges = Boolean(
    preview?.valid &&
      (preview.totals.created > 0 ||
        preview.totals.updated > 0 ||
        preview.totals.replaced > 0)
  );

  return (
    <>
      <Card className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              JSON Import & Export
            </h2>
            <p className="text-xs text-[#929BAA]">
              Export your diet plans, workout splits, measurements, or a complete backup as portable
              JSON, or import records with schema validation and duplicate protection.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={loadSchemaDoc}>
              <Code2 className="h-4 w-4 text-[#62A8F7]" />
              JSON Schema
            </Button>
            <Button size="sm" onClick={() => openImportModal('DIET')}>
              <Upload className="h-4 w-4" />
              Import Data
            </Button>
          </div>
        </div>

        {/* Dedicated Import Type Quick Launchers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SCOPE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <div
                key={opt.scope}
                className="flex flex-col justify-between gap-3 rounded-[10px] border border-[#202733] bg-[#0D121A] p-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#171E29] text-[#B6F36A]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-[#F5F7FA]">{opt.label}</div>
                    <div className="text-[11px] text-[#929BAA] leading-snug">
                      {opt.description}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    disabled={exportingScope === opt.scope}
                    onClick={() => handleExport(opt.scope)}
                  >
                    <Download className="h-3.5 w-3.5 text-[#B6F36A]" />
                    {exportingScope === opt.scope ? 'Exporting...' : `Export ${opt.shortLabel}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openImportModal(opt.scope)}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#202733]">
          <span className="text-[11px] text-[#626C7B]">
            All imports run inside atomic PostgreSQL transactions — partial imports are rolled back.
          </span>
          <Button variant="danger" size="sm" onClick={onOpenClearLogs}>
            <Trash2 className="h-4 w-4" />
            Clear Activity Logs
          </Button>
        </div>
      </Card>

      {/* Import Data Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => {
          if (!committing) setImportModalOpen(false);
        }}
        title="Import FitTrack Data (JSON)"
        subtitle="Validate against the FitTrack schema, preview all records, and confirm before saving."
        maxWidthClass="max-w-3xl"
      >
        <div className="space-y-4">
          {/* Import Scope Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#929BAA]">
              1. Select Import Category
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SCOPE_OPTIONS.map((opt) => {
                const active = importScope === opt.scope;
                return (
                  <button
                    key={opt.scope}
                    type="button"
                    disabled={validating || committing}
                    onClick={() => {
                      setImportScope(opt.scope);
                      resetImportWorkspace();
                    }}
                    className={`rounded-[9px] border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                      active
                        ? 'border-[#B6F36A] bg-[#26351D]/60 text-[#F5F7FA] font-semibold'
                        : 'border-[#252D38] bg-[#0D121A] text-[#929BAA] hover:text-[#F5F7FA]'
                    }`}
                  >
                    {opt.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conflict / Replacement Mode */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#929BAA]">
              2. Duplicate & Existing Data Handling
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={validating || committing}
                onClick={() => {
                  setImportMode('MERGE');
                  resetImportWorkspace();
                }}
                className={`rounded-[9px] border p-3 text-left transition-colors cursor-pointer ${
                  importMode === 'MERGE'
                    ? 'border-[#B6F36A] bg-[#26351D]/45'
                    : 'border-[#252D38] bg-[#0D121A]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F5F7FA]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#B6F36A]" />
                  Merge & Skip Duplicates (Recommended)
                </div>
                <p className="mt-1 text-[11px] text-[#929BAA]">
                  Keeps all existing data intact and automatically skips matching duplicate records.
                </p>
              </button>

              <button
                type="button"
                disabled={validating || committing}
                onClick={() => {
                  setImportMode('REPLACE');
                  resetImportWorkspace();
                }}
                className={`rounded-[9px] border p-3 text-left transition-colors cursor-pointer ${
                  importMode === 'REPLACE'
                    ? 'border-[#F3B84B] bg-[#F3B84B]/10'
                    : 'border-[#252D38] bg-[#0D121A]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F5F7FA]">
                  <AlertTriangle className="h-3.5 w-3.5 text-[#F3B84B]" />
                  Replace Existing {SCOPE_OPTIONS.find((s) => s.scope === importScope)?.shortLabel} Data
                </div>
                <p className="mt-1 text-[11px] text-[#929BAA]">
                  Explicitly replaces existing records in the imported sections with your JSON file.
                </p>
              </button>
            </div>
          </div>

          {importMode === 'REPLACE' && (
            <div className="flex items-start gap-2.5 rounded-[9px] border border-[#F3B84B]/40 bg-[#F3B84B]/10 p-3 text-xs text-[#F5F7FA]">
              <AlertTriangle className="h-4 w-4 text-[#F3B84B] shrink-0 mt-0.5" />
              <span>
                Replacement mode selected: confirming this import will replace existing{' '}
                <strong>{importScope.toLowerCase().replace('_', ' ')}</strong> records covered by
                your JSON file. Your login account and unrelated categories will not be deleted.
              </span>
            </div>
          )}

          {/* File Upload + Paste JSON */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-[#929BAA]">
                3. Upload JSON File or Paste JSON
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={validating || committing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5 text-[#B6F36A]" />
                  Choose .json File
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={validating || committing}
                  onClick={handleLoadSample}
                >
                  Load Sample JSON
                </Button>
                {rawJson.trim().length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={validating || committing}
                    onClick={() => {
                      navigator.clipboard?.writeText(rawJson);
                      showToast('JSON copied to clipboard.', 'info');
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy JSON
                  </Button>
                )}
              </div>
            </div>

            {fileName && (
              <div className="text-[11px] font-mono text-[#B6F36A]">
                Loaded file: {fileName}
              </div>
            )}

            <textarea
              rows={8}
              value={rawJson}
              disabled={validating || committing}
              onChange={(e) => {
                setRawJson(e.target.value);
                setFileName(null);
                if (preview || validationErrors.length > 0 || commitResult) {
                  resetImportWorkspace();
                }
              }}
              placeholder='Paste FitTrack JSON here (e.g. { "schemaVersion": "1.0", "foods": [...], "plannedMeals": [...] })'
              className="w-full rounded-[9px] border border-[#252D38] bg-[#0D121A] p-3 font-mono text-xs text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A]"
            />
          </div>

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="rounded-[10px] border border-[#F16C75]/45 bg-[#F16C75]/10 p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F16C75]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Validation Failed ({validationErrors.length}{' '}
                {validationErrors.length === 1 ? 'issue' : 'issues'}) — No changes were saved
              </div>
              <ul className="space-y-1 max-h-40 overflow-y-auto text-xs">
                {validationErrors.map((err, idx) => (
                  <li key={idx} className="font-mono text-[11px] text-[#F5F7FA]/90">
                    <span className="text-[#F16C75]">{err.field}:</span> {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {preview?.warnings && preview.warnings.length > 0 && (
            <div className="rounded-[9px] border border-[#F3B84B]/40 bg-[#F3B84B]/10 p-3 space-y-1 text-xs text-[#F5F7FA]">
              {preview.warnings.map((w, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-[#F3B84B] shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Preview Breakdown */}
          {preview?.valid && (
            <div className="rounded-[10px] border border-[#B6F36A]/35 bg-[#0D121A] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#B6F36A]">
                  <Eye className="h-4 w-4" />
                  Import Preview Ready
                </div>
                <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                  <span className="text-[#36C98F]">Create: {preview.totals.created}</span>
                  <span className="text-[#62A8F7]">Update: {preview.totals.updated}</span>
                  <span className="text-[#929BAA]">
                    Duplicates Skipped: {preview.totals.duplicatesSkipped}
                  </span>
                  {preview.totals.replaced > 0 && (
                    <span className="text-[#F3B84B]">Replace: {preview.totals.replaced}</span>
                  )}
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
                {RECORD_SECTIONS.map(({ key, label }) => {
                  const list: PreviewRecordEntry[] = preview.records[key];
                  if (!list || list.length === 0) return null;
                  return (
                    <div
                      key={key}
                      className="rounded-[8px] border border-[#202733] bg-[#121720] p-2.5 space-y-1.5"
                    >
                      <div className="text-[11px] font-semibold text-[#F5F7FA]">
                        {label} ({list.length})
                      </div>
                      <ul className="space-y-1">
                        {list.map((entry, idx) => (
                          <li
                            key={idx}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] border-t border-[#202733]/60 pt-1 first:border-t-0 first:pt-0"
                          >
                            <div>
                              <span className="font-medium text-[#F5F7FA]">{entry.title}</span>
                              <span className="text-[#929BAA] ml-2">{entry.subtitle}</span>
                            </div>
                            <span
                              className={`font-mono text-[10px] font-semibold shrink-0 ${
                                entry.status === 'CREATE'
                                  ? 'text-[#36C98F]'
                                  : entry.status === 'UPDATE'
                                    ? 'text-[#62A8F7]'
                                    : entry.status === 'REPLACE'
                                      ? 'text-[#F3B84B]'
                                      : 'text-[#626C7B]'
                              }`}
                            >
                              {entry.status === 'DUPLICATE_SKIP' ? 'SKIP DUPLICATE' : entry.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              {!hasActionableChanges && (
                <div className="text-xs text-[#929BAA]">
                  Every record in this JSON matches an existing record in your account. Nothing new
                  would be imported.
                </div>
              )}
            </div>
          )}

          {/* Commit Success Summary */}
          {commitResult && (
            <div className="rounded-[10px] border border-[#36C98F]/45 bg-[#36C98F]/10 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#36C98F]">
                <CheckCircle2 className="h-4 w-4" />
                Import Completed Successfully
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="rounded-[8px] bg-[#0D121A] border border-[#202733] p-2">
                  <div className="text-[10px] text-[#626C7B]">Created</div>
                  <div className="text-[#36C98F] font-semibold">{commitResult.totals.created}</div>
                </div>
                <div className="rounded-[8px] bg-[#0D121A] border border-[#202733] p-2">
                  <div className="text-[10px] text-[#626C7B]">Updated</div>
                  <div className="text-[#62A8F7] font-semibold">{commitResult.totals.updated}</div>
                </div>
                <div className="rounded-[8px] bg-[#0D121A] border border-[#202733] p-2">
                  <div className="text-[10px] text-[#626C7B]">Skipped Duplicates</div>
                  <div className="text-[#929BAA] font-semibold">
                    {commitResult.totals.duplicatesSkipped}
                  </div>
                </div>
                <div className="rounded-[8px] bg-[#0D121A] border border-[#202733] p-2">
                  <div className="text-[10px] text-[#626C7B]">Replaced</div>
                  <div className="text-[#F3B84B] font-semibold">{commitResult.totals.replaced}</div>
                </div>
              </div>
              <div className="space-y-1 text-[11px] text-[#929BAA]">
                {(
                  Object.entries(commitResult.categories) as Array<
                    [string, ImportCategorySummary | undefined]
                  >
                ).map(([catKey, cat]) => {
                  if (
                    !cat ||
                    (cat.created === 0 &&
                      cat.updated === 0 &&
                      cat.duplicatesSkipped === 0 &&
                      cat.replaced === 0)
                  ) {
                    return null;
                  }
                  return (
                    <div key={catKey} className="font-mono">
                      • {catKey}: +{cat.created} created
                      {cat.updated > 0 ? `, ${cat.updated} updated` : ''}
                      {cat.duplicatesSkipped > 0
                        ? `, ${cat.duplicatesSkipped} duplicate(s) skipped`
                        : ''}
                      {cat.replaced > 0 ? `, ${cat.replaced} replaced` : ''}
                    </div>
                  );
                })}
              </div>
              {commitResult.warnings && commitResult.warnings.length > 0 && (
                <div className="space-y-1 border-t border-[#36C98F]/25 pt-2 text-[11px] text-[#F3B84B]">
                  {commitResult.warnings.map((w, idx) => (
                    <div key={idx}>Note: {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#202733]">
            <Button
              variant="secondary"
              disabled={committing}
              onClick={() => setImportModalOpen(false)}
            >
              {commitResult ? 'Close' : 'Cancel'}
            </Button>

            {!commitResult && (
              <Button
                variant="secondary"
                disabled={validating || committing || !rawJson.trim()}
                onClick={handleValidateAndPreview}
              >
                <Eye className="h-4 w-4 text-[#B6F36A]" />
                {validating ? 'Validating...' : 'Validate & Preview'}
              </Button>
            )}

            {preview?.valid && !commitResult && (
              <Button
                disabled={committing || !hasActionableChanges}
                onClick={handleConfirmImport}
              >
                <Check className="h-4 w-4" />
                {committing ? 'Importing...' : 'Confirm Import'}
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* Documented Schema Reference Modal */}
      <Modal
        open={schemaModalOpen}
        onClose={() => setSchemaModalOpen(false)}
        title="FitTrack JSON Schema (v1.0)"
        subtitle="Exact portable JSON schema matching FitTrack's PostgreSQL models."
        maxWidthClass="max-w-3xl"
      >
        {loadingSchema || !schemaDoc ? (
          <div className="py-6 text-center text-xs text-[#929BAA]">Loading schema...</div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-[#929BAA]">{schemaDoc.description}</p>
            <div className="rounded-[9px] border border-[#202733] bg-[#0D121A] p-3 space-y-2">
              <div className="text-xs font-semibold text-[#F5F7FA]">Supported Enum Values</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] font-mono">
                {Object.entries(schemaDoc.enums).map(([enumName, values]) => (
                  <div key={enumName} className="text-[#929BAA]">
                    <span className="text-[#B6F36A]">{enumName}:</span> {values.join(', ')}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F5F7FA]">
                  Example Schema Payloads (Diet, Workout, Measurements)
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard?.writeText(JSON.stringify(schemaDoc.examples, null, 2));
                    showToast('Schema examples copied to clipboard.', 'info');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Examples
                </Button>
              </div>
              <pre className="max-h-72 overflow-y-auto rounded-[9px] border border-[#202733] bg-[#0D121A] p-3 font-mono text-[11px] text-[#F5F7FA]">
                {JSON.stringify(schemaDoc.examples, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setSchemaModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
