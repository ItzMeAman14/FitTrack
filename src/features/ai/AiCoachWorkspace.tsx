import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  Clock,
  Cpu,
  History,
  KeyRound,
  Maximize2,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, streamAiRequest, type AiStageEvent } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { AiAuditLog, AiMessage, AiModelsResponse, AiProposal } from '../../types/fittrack';
import {
  cmToDisplay,
  displayToCm,
  displayToKg,
  kgToDisplay,
  measureUnitSuffix,
  weightUnitSuffix,
} from '../../utils/units';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { AiModelManagerModal } from './AiModelManagerModal';

const SUGGESTED_PROMPTS = [
  'Analyze my current diet plan, workout split, and recent measurements.',
  'Add a high-protein evening snack to my active diet plan to hit my protein goal.',
  'Update Monday workout split to add Incline Dumbbell Press 3x10 with 90s rest.',
  'Create a brand new 4-day Upper/Lower workout plan as a separate saved template.',
];

interface ProposalEditDraft {
  planName: string;
  description: string;
  targets?: {
    dailyCalorieTarget?: string;
    dailyProteinTargetG?: string;
    dailyCarbTargetG?: string;
    dailyFatTargetG?: string;
    targetWeight?: string;
    targetWaist?: string;
    targetBodyFatPct?: string;
  };
  dietOperations?: Array<Record<string, unknown>>;
  workoutOperations?: Array<Record<string, unknown>>;
}

interface AiCoachWorkspaceProps {
  variant?: 'page' | 'drawer';
  onCloseDrawer?: () => void;
}

export function AiCoachWorkspace({ variant = 'page', onCloseDrawer }: AiCoachWorkspaceProps) {
  const { user, refreshAuth } = useAuth();
  const { showToast } = useToast();
  const { bumpDataVersion, dataVersion } = useWorkspace();
  const measureUnit = user?.profile?.preferredMeasureUnit || 'CM';
  const weightUnit = user?.profile?.preferredWeightUnit || 'KG';
  const mSuffix = measureUnitSuffix(measureUnit);
  const wSuffix = weightUnitSuffix(weightUnit);

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<AiStageEvent | null>(null);
  const [stageHistory, setStageHistory] = useState<AiStageEvent[]>([]);
  const [failedRequest, setFailedRequest] = useState<{ prompt: string; message: string } | null>(
    null
  );
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [confirmStage, setConfirmStage] = useState<AiStageEvent | null>(null);

  const sendingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatRetryKeyRef = useRef<{ prompt: string; key: string } | null>(null);
  const confirmKeysRef = useRef<Map<string, string>>(new Map());

  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProposalEditDraft | null>(null);

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AiAuditLog[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [modelsData, setModelsData] = useState<AiModelsResponse | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>('BUILTIN');
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);

  const hasLoadedOnceRef = useRef(false);

  const loadModels = useCallback(async (overrideActiveId?: string) => {
    try {
      const res = await api.get<AiModelsResponse>('/ai/models');
      setModelsData(res.data);
      setSelectedModelId(overrideActiveId || res.data.activeModelId || 'BUILTIN');
    } catch {
      // Non-fatal; default server provider remains selectable
    }
  }, []);

  const loadMessages = useCallback(async () => {
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    try {
      const [msgRes] = await Promise.all([api.get<AiMessage[]>('/ai/messages'), loadModels()]);
      setMessages(msgRes.data);
      hasLoadedOnceRef.current = true;
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load chat history.', 'error');
    } finally {
      setLoading(false);
    }
  }, [loadModels, showToast]);

  useEffect(() => {
    loadMessages();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadMessages, dataVersion]);

  useEffect(() => {
    if (loading) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [loading, messages.length, pendingPrompt, sending, currentStage?.stage, failedRequest]);

  const createIdempotencyKey = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const handleModelChange = async (nextModelId: string) => {
    setSelectedModelId(nextModelId);
    setSwitchingModel(true);
    try {
      await api.post('/ai/models/select', { modelId: nextModelId });
      await loadModels(nextModelId);
      bumpDataVersion('ai');
      showToast('Active AI model updated.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to switch AI model.', 'error');
      await loadModels();
    } finally {
      setSwitchingModel(false);
    }
  };

  const handleModelsUpdated = async (preferredId?: string) => {
    await loadModels(preferredId);
    bumpDataVersion('ai');
  };

  const activeCustomModel =
    modelsData?.customModels.find((m) => m.id === selectedModelId) || null;
  const activeModelDisplayLabel = activeCustomModel
    ? activeCustomModel.modelName
    : modelsData?.builtIn.model || 'FitTrack AI';

  const sendMessage = async (text: string, reuseRetryKey = false) => {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) return;

    const idempotencyKey =
      reuseRetryKey && chatRetryKeyRef.current?.prompt === trimmed
        ? chatRetryKeyRef.current.key
        : createIdempotencyKey();
    chatRetryKeyRef.current = { prompt: trimmed, key: idempotencyKey };

    sendingRef.current = true;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setFailedRequest(null);
    setSending(true);
    setPendingPrompt(trimmed);
    setCurrentStage({ stage: 'calling_model', label: `Contacting ${activeModelDisplayLabel}...` });
    setStageHistory([]);
    setInput('');

    try {
      const data = await streamAiRequest<{ userMessage: AiMessage; assistantMessage: AiMessage }>(
        '/ai/chat/stream',
        { message: trimmed, idempotencyKey, modelId: selectedModelId },
        {
          timeoutMs: 65_000,
          signal: controller.signal,
          onStage: (event) => {
            setCurrentStage(event);
            setStageHistory((prev) => {
              if (prev.some((item) => item.stage === event.stage)) {
                return prev.map((item) => (item.stage === event.stage ? event : item));
              }
              return [...prev, event];
            });
          },
        }
      );
      chatRetryKeyRef.current = null;
      setMessages((prev) => [...prev, data.userMessage, data.assistantMessage]);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to reach FitTrack AI. Please try again.';
      setFailedRequest({ prompt: trimmed, message });
      showToast(message, 'error');
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      sendingRef.current = false;
      setSending(false);
      setPendingPrompt(null);
      setCurrentStage(null);
      setStageHistory([]);
    }
  };

  const handleRetry = () => {
    if (!failedRequest || sendingRef.current) return;
    sendMessage(failedRequest.prompt, true);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const startEditingProposal = (proposal: AiProposal) => {
    confirmKeysRef.current.delete(proposal.id);
    const rawTargets = (proposal.params.targets as Record<string, unknown>) || {};
    const tw =
      typeof rawTargets.targetWeightKg === 'number'
        ? kgToDisplay(rawTargets.targetWeightKg, weightUnit)
        : null;
    const twaist =
      typeof rawTargets.targetWaistCm === 'number'
        ? cmToDisplay(rawTargets.targetWaistCm, measureUnit)
        : null;

    setEditingProposalId(proposal.id);
    setEditDraft({
      planName: proposal.planName,
      description: proposal.newPlanPreview?.description || '',
      targets:
        proposal.type === 'UPDATE_TARGETS'
          ? {
              dailyCalorieTarget:
                rawTargets.dailyCalorieTarget !== undefined
                  ? String(rawTargets.dailyCalorieTarget)
                  : '',
              dailyProteinTargetG:
                rawTargets.dailyProteinTargetG !== undefined
                  ? String(rawTargets.dailyProteinTargetG)
                  : '',
              dailyCarbTargetG:
                rawTargets.dailyCarbTargetG !== undefined
                  ? String(rawTargets.dailyCarbTargetG)
                  : '',
              dailyFatTargetG:
                rawTargets.dailyFatTargetG !== undefined
                  ? String(rawTargets.dailyFatTargetG)
                  : '',
              targetWeight: tw !== null ? String(tw) : '',
              targetWaist: twaist !== null ? String(twaist) : '',
              targetBodyFatPct:
                rawTargets.targetBodyFatPct !== undefined
                  ? String(rawTargets.targetBodyFatPct)
                  : '',
            }
          : undefined,
      dietOperations:
        proposal.type === 'MODIFY_DIET_PLAN'
          ? structuredClone((proposal.params.dietOperations as Array<Record<string, unknown>>) || [])
          : undefined,
      workoutOperations:
        proposal.type === 'MODIFY_WORKOUT_PLAN'
          ? structuredClone(
              (proposal.params.workoutOperations as Array<Record<string, unknown>>) || []
            )
          : undefined,
    });
  };

  const buildEditsPayload = (proposal: AiProposal) => {
    if (editingProposalId !== proposal.id || !editDraft) return undefined;
    const edits: Record<string, unknown> = {
      planName: editDraft.planName.trim() || proposal.planName,
    };
    if (proposal.type === 'CREATE_NEW_PLAN') {
      edits.description = editDraft.description;
    }
    if (proposal.type === 'UPDATE_TARGETS' && editDraft.targets) {
      const t: Record<string, number> = {};
      if (editDraft.targets.dailyCalorieTarget?.trim())
        t.dailyCalorieTarget = Number(editDraft.targets.dailyCalorieTarget);
      if (editDraft.targets.dailyProteinTargetG?.trim())
        t.dailyProteinTargetG = Number(editDraft.targets.dailyProteinTargetG);
      if (editDraft.targets.dailyCarbTargetG?.trim())
        t.dailyCarbTargetG = Number(editDraft.targets.dailyCarbTargetG);
      if (editDraft.targets.dailyFatTargetG?.trim())
        t.dailyFatTargetG = Number(editDraft.targets.dailyFatTargetG);
      if (editDraft.targets.targetWeight?.trim()) {
        const kg = displayToKg(editDraft.targets.targetWeight, weightUnit);
        if (kg !== null) t.targetWeightKg = kg;
      }
      if (editDraft.targets.targetWaist?.trim()) {
        const cm = displayToCm(editDraft.targets.targetWaist, measureUnit);
        if (cm !== null) t.targetWaistCm = cm;
      }
      if (editDraft.targets.targetBodyFatPct?.trim())
        t.targetBodyFatPct = Number(editDraft.targets.targetBodyFatPct);
      edits.targets = t;
    }
    if (proposal.type === 'MODIFY_DIET_PLAN' && editDraft.dietOperations) {
      edits.dietOperations = editDraft.dietOperations;
    }
    if (proposal.type === 'MODIFY_WORKOUT_PLAN' && editDraft.workoutOperations) {
      edits.workoutOperations = editDraft.workoutOperations;
    }
    return edits;
  };

  const handleConfirmProposal = async (messageId: string, proposal: AiProposal) => {
    if (busyProposalId) return;
    setBusyProposalId(proposal.id);
    setConfirmStage({ stage: 'preparing_updates', label: 'Preparing database updates...' });
    try {
      const edits = buildEditsPayload(proposal);
      let confirmKey = confirmKeysRef.current.get(proposal.id);
      if (!confirmKey) {
        confirmKey = createIdempotencyKey();
        confirmKeysRef.current.set(proposal.id, confirmKey);
      }
      const data = await streamAiRequest<{ proposal: AiProposal }>(
        `/ai/proposals/${proposal.id}/confirm/stream`,
        edits ? { edits, idempotencyKey: confirmKey } : { idempotencyKey: confirmKey },
        {
          timeoutMs: 30_000,
          onStage: (event) => setConfirmStage(event),
        }
      );
      confirmKeysRef.current.delete(proposal.id);
      await refreshAuth();
      bumpDataVersion('all');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                proposal: data.proposal || {
                  ...proposal,
                  status: 'APPROVED',
                  applied: true,
                },
              }
            : m
        )
      );
      setEditingProposalId(null);
      setEditDraft(null);
      showToast(
        proposal.type === 'CREATE_NEW_PLAN'
          ? 'New plan saved to templates (active schedule untouched).'
          : 'Proposal confirmed and applied!',
        'success'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to apply proposal.', 'error');
    } finally {
      setBusyProposalId(null);
      setConfirmStage(null);
    }
  };

  const handleCancelProposal = async (messageId: string, proposal: AiProposal) => {
    setBusyProposalId(proposal.id);
    try {
      const res = await api.post<{ proposal: AiProposal }>(`/ai/proposals/${proposal.id}/cancel`);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                proposal: res.data.proposal || {
                  ...proposal,
                  status: 'CANCELLED',
                  applied: false,
                },
              }
            : m
        )
      );
      if (editingProposalId === proposal.id) {
        setEditingProposalId(null);
        setEditDraft(null);
      }
      showToast('Proposal cancelled — no changes were made.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to cancel proposal.', 'error');
    } finally {
      setBusyProposalId(null);
    }
  };

  const openAuditModal = async () => {
    setAuditOpen(true);
    setLoadingAudit(true);
    try {
      const res = await api.get<AiAuditLog[]>('/ai/audit-logs');
      setAuditLogs(res.data);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load audit log.', 'error');
    } finally {
      setLoadingAudit(false);
    }
  };

  const handleClearChat = async () => {
    try {
      await api.delete('/ai/messages');
      setMessages([]);
      showToast('Conversation cleared.', 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to clear chat.', 'error');
    }
  };

  const isDrawer = variant === 'drawer';

  if (loading) {
    return (
      <div className={isDrawer ? 'p-6' : ''}>
        <LoadingSpinner label="Connecting to FitTrack AI..." />
      </div>
    );
  }

  return (
    <div className={isDrawer ? 'flex h-full flex-col' : 'space-y-4 max-w-4xl mx-auto'}>
      {isDrawer ? (
        <div className="flex items-center justify-between gap-2 border-b border-[#202733] px-4 py-3 bg-[#0D1016] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#26351D] text-[#B6F36A]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-sm font-semibold text-[#F5F7FA] truncate">
                FitTrack AI Coach
              </h2>
              <p className="text-[11px] text-[#929BAA] truncate">
                Live plans & measurements ({mSuffix}) · Confirm before saving
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={openAuditModal}
              title="Audit Log"
              aria-label="Open AI Audit Log"
              className="rounded-lg p-2 text-[#929BAA] hover:bg-[#171E29] hover:text-[#F5F7FA] cursor-pointer"
            >
              <History className="h-4 w-4" />
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                disabled={sending}
                onClick={handleClearChat}
                title="Clear Chat"
                aria-label="Clear chat"
                className="rounded-lg p-2 text-[#929BAA] hover:bg-[#171E29] hover:text-[#F16C75] disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <Link
              to="/ai"
              onClick={onCloseDrawer}
              title="Open full workspace"
              aria-label="Expand to full view"
              className="rounded-lg p-2 text-[#929BAA] hover:bg-[#171E29] hover:text-[#B6F36A]"
            >
              <Maximize2 className="h-4 w-4" />
            </Link>
            {onCloseDrawer && (
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Close AI drawer"
                className="rounded-lg p-2 text-[#929BAA] hover:bg-[#171E29] hover:text-[#F5F7FA] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#26351D] text-[#B6F36A]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                FitTrack AI Coach
              </h2>
              <p className="text-xs text-[#929BAA]">
                Reads your live diet plan, workout split, measurements ({mSuffix}), and saved
                templates · Confirmation required for every change
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={openAuditModal}>
              <History className="h-3.5 w-3.5 text-[#B6F36A]" />
              Audit Log
            </Button>
            {messages.length > 0 && (
              <Button size="sm" variant="ghost" disabled={sending} onClick={handleClearChat}>
                <Trash2 className="h-3.5 w-3.5" />
                Clear Chat
              </Button>
            )}
          </div>
        </Card>
      )}

      <div
        className={
          isDrawer
            ? 'flex-1 flex flex-col min-h-0 overflow-hidden bg-[#121720]'
            : 'rounded-[14px] border border-[#252D38] bg-[#121720] flex flex-col min-h-[520px] max-h-[72vh] overflow-hidden'
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#202733] bg-[#0D1016] px-3.5 py-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Cpu className="h-3.5 w-3.5 text-[#B6F36A] shrink-0" />
            <label htmlFor={`ai-model-select-${variant}`} className="sr-only">
              Choose AI Model
            </label>
            <select
              id={`ai-model-select-${variant}`}
              value={selectedModelId}
              disabled={sending || switchingModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="h-8 max-w-full min-w-[170px] flex-1 sm:flex-none rounded-[8px] border border-[#252D38] bg-[#121720] px-2.5 text-xs text-[#F5F7FA] focus:outline-none focus:border-[#B6F36A] disabled:opacity-60 cursor-pointer"
            >
              <option value="BUILTIN">
                Default: {modelsData?.builtIn.model || 'gemini-4-hydrogen'}
                {modelsData && !modelsData.builtIn.configured ? ' (No server key)' : ''}
              </option>
              {(modelsData?.customModels || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.keyPreview})
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={sending}
            onClick={() => setModelModalOpen(true)}
            className="h-8 text-xs px-2.5"
          >
            <KeyRound className="h-3.5 w-3.5 text-[#B6F36A]" />
            {modelsData?.customModels.length ? 'Manage Keys' : 'Add Model / Key'}
          </Button>
        </div>

        <div className={`flex-1 overflow-y-auto space-y-4 ${isDrawer ? 'p-4' : 'p-5'}`}>
          {modelsData && !modelsData.builtIn.configured && selectedModelId === 'BUILTIN' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#F3B84B]/35 bg-[#F3B84B]/10 px-3.5 py-2.5 text-xs text-[#F5F7FA]">
              <span>
                No server API key is active for the default model. Add your own API key & model to
                chat with AI Coach.
              </span>
              <Button size="sm" onClick={() => setModelModalOpen(true)}>
                <KeyRound className="h-3.5 w-3.5" />
                Add API Key
              </Button>
            </div>
          )}

          {messages.length === 0 && !pendingPrompt && !failedRequest ? (
            <div className="py-6 space-y-4">
              <div className="text-center space-y-1">
                <h3 className="font-display text-sm font-semibold text-[#F5F7FA]">
                  Ask anything or request a plan update with preview & approval
                </h3>
                <p className="text-xs text-[#929BAA]">
                  Every diet, workout, target, or template proposal requires your explicit approval
                  before anything changes.
                </p>
              </div>
              <div className={`grid grid-cols-1 ${isDrawer ? '' : 'sm:grid-cols-2 max-w-2xl mx-auto'} gap-2`}>
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending}
                    onClick={() => sendMessage(prompt)}
                    className="text-left rounded-[10px] border border-[#252D38] bg-[#0D121A] p-3 text-xs text-[#F5F7FA] hover:border-[#B6F36A]/50 hover:bg-[#171E29] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const p = msg.proposal;
              const status = p ? p.status || (p.applied ? 'APPROVED' : 'PENDING') : null;
              const isEditingThis = Boolean(p && editingProposalId === p.id && editDraft);

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[90%] rounded-[12px] px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#26351D] text-[#F5F7FA] border border-[#B6F36A]/25'
                        : 'bg-[#171E29] text-[#F5F7FA] border border-[#252D38]'
                    }`}
                  >
                    {msg.content}
                  </div>

                  {p && (
                    <div className="mt-2.5 w-full rounded-[12px] border border-[#B6F36A]/35 bg-[#0D121A] p-3.5 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#202733] pb-2">
                        <div className="space-y-0.5">
                          <div className="text-[11px] font-mono font-semibold text-[#B6F36A]">
                            {p.planType} · {p.type.replace(/_/g, ' ')}
                          </div>
                          <div className="font-display text-sm font-semibold text-[#F5F7FA]">
                            {p.planName}
                          </div>
                          <div className="text-xs text-[#929BAA]">
                            Affected: <span className="text-[#F5F7FA]">{p.affectedTarget}</span>
                          </div>
                        </div>

                        {status === 'APPROVED' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#36C98F]">
                            <Check className="h-3.5 w-3.5" /> Confirmed & Applied
                          </span>
                        )}
                        {status === 'CANCELLED' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#929BAA]">
                            <X className="h-3.5 w-3.5" /> Cancelled
                          </span>
                        )}
                        {status === 'EXPIRED' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#F3B84B]">
                            <Clock className="h-3.5 w-3.5" /> Expired
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[#F5F7FA]">{p.summary}</p>
                      {p.impactSummary && (
                        <div className="text-xs text-[#39C9BA] bg-[#121720] border border-[#202733] rounded-[8px] px-3 py-2">
                          Impact: {p.impactSummary}
                        </div>
                      )}

                      {p.changes && p.changes.length > 0 && (
                        <div className="overflow-x-auto rounded-[9px] border border-[#202733]">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-[#202733] bg-[#121720] text-[#626C7B]">
                                <th className="py-2 px-2.5">Action</th>
                                <th className="py-2 px-2.5">Target / Field</th>
                                <th className="py-2 px-2.5">Existing</th>
                                <th className="py-2 px-2.5">Proposed</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#202733]">
                              {p.changes.map((c, idx) => (
                                <tr key={idx}>
                                  <td
                                    className={`py-2 px-2.5 font-mono font-semibold ${
                                      c.action === 'ADD'
                                        ? 'text-[#36C98F]'
                                        : c.action === 'REMOVE'
                                          ? 'text-[#F16C75]'
                                          : 'text-[#62A8F7]'
                                    }`}
                                  >
                                    {c.action}
                                  </td>
                                  <td className="py-2 px-2.5 text-[#F5F7FA]">
                                    {c.target} · <span className="text-[#929BAA]">{c.field}</span>
                                  </td>
                                  <td className="py-2 px-2.5 font-mono text-[#626C7B]">
                                    {c.existingValue}
                                  </td>
                                  <td className="py-2 px-2.5 font-mono text-[#B6F36A]">
                                    {c.proposedValue}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {p.type === 'CREATE_NEW_PLAN' && p.newPlanPreview && (
                        <div className="space-y-2 rounded-[10px] border border-[#202733] bg-[#121720] p-3">
                          <div className="text-xs font-medium text-[#929BAA]">
                            {p.newPlanPreview.description}
                          </div>
                          {p.newPlanPreview.meals && (
                            <div className="space-y-2">
                              {p.newPlanPreview.meals.map((meal, mIdx) => (
                                <div
                                  key={mIdx}
                                  className="rounded-[8px] border border-[#202733] bg-[#0D121A] p-2.5 text-xs"
                                >
                                  <div className="font-semibold text-[#F5F7FA]">
                                    <span className="font-mono text-[#B6F36A] mr-2">
                                      {meal.time}
                                    </span>
                                    {meal.name}
                                  </div>
                                  <ul className="mt-1 space-y-0.5 text-[#929BAA]">
                                    {meal.items.map((it, iIdx) => (
                                      <li key={iIdx} className="font-mono text-[11px]">
                                        • {it.foodName} ({it.servings}x)
                                        {it.calories ? ` · ${it.calories} kcal` : ''}
                                        {it.proteinG ? ` · ${it.proteinG}g P` : ''}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          )}
                          {p.newPlanPreview.split && (
                            <div className={`grid grid-cols-1 ${isDrawer ? '' : 'sm:grid-cols-2'} gap-2`}>
                              {p.newPlanPreview.split.map((d, dIdx) => (
                                <div
                                  key={dIdx}
                                  className="rounded-[8px] border border-[#202733] bg-[#0D121A] p-2.5 text-xs"
                                >
                                  <div className="font-semibold text-[#F5F7FA]">
                                    <span className="font-mono text-[#62A8F7] mr-1.5">{d.day}</span>
                                    {d.focus}
                                  </div>
                                  {d.isRestDay ? (
                                    <div className="text-[11px] text-[#626C7B] mt-1">Rest Day</div>
                                  ) : (
                                    <ul className="mt-1 space-y-0.5 text-[#929BAA]">
                                      {d.exercises.map((ex, eIdx) => (
                                        <li key={eIdx} className="font-mono text-[11px]">
                                          • {ex.exerciseName}: {ex.targetSets}×{ex.targetReps} (
                                          {ex.restSeconds}s)
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {isEditingThis && editDraft && (
                        <div className="space-y-3 rounded-[10px] border border-[#62A8F7]/40 bg-[#121720] p-3">
                          <div className="text-xs font-semibold text-[#62A8F7]">
                            Edit Proposal Parameters Before Applying
                          </div>
                          <div className={`grid grid-cols-1 ${isDrawer ? '' : 'sm:grid-cols-2'} gap-3`}>
                            <Input
                              label="Plan / Action Name"
                              value={editDraft.planName}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, planName: e.target.value })
                              }
                            />
                            {p.type === 'CREATE_NEW_PLAN' && (
                              <Input
                                label="Plan Description"
                                value={editDraft.description}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, description: e.target.value })
                                }
                              />
                            )}
                          </div>

                          {p.type === 'UPDATE_TARGETS' && editDraft.targets && (
                            <div className="grid grid-cols-2 gap-2.5">
                              <Input
                                label="Calories (kcal)"
                                type="number"
                                value={editDraft.targets.dailyCalorieTarget || ''}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    targets: {
                                      ...editDraft.targets,
                                      dailyCalorieTarget: e.target.value,
                                    },
                                  })
                                }
                              />
                              <Input
                                label="Protein (g)"
                                type="number"
                                value={editDraft.targets.dailyProteinTargetG || ''}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    targets: {
                                      ...editDraft.targets,
                                      dailyProteinTargetG: e.target.value,
                                    },
                                  })
                                }
                              />
                              <Input
                                label={`Target Weight (${wSuffix})`}
                                type="number"
                                step="0.1"
                                value={editDraft.targets.targetWeight || ''}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    targets: { ...editDraft.targets, targetWeight: e.target.value },
                                  })
                                }
                              />
                              <Input
                                label={`Target Waist (${mSuffix})`}
                                type="number"
                                step="0.1"
                                value={editDraft.targets.targetWaist || ''}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    targets: { ...editDraft.targets, targetWaist: e.target.value },
                                  })
                                }
                              />
                            </div>
                          )}

                          {p.type === 'MODIFY_DIET_PLAN' && editDraft.dietOperations && (
                            <div className="space-y-2">
                              {editDraft.dietOperations.map((op, opIdx) => (
                                <div
                                  key={opIdx}
                                  className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs border border-[#202733] rounded-[8px] p-2 bg-[#0D121A]"
                                >
                                  <Input
                                    label="Meal Name"
                                    value={String(op.mealName || '')}
                                    onChange={(e) =>
                                      setEditDraft((prev) =>
                                        prev?.dietOperations
                                          ? {
                                              ...prev,
                                              dietOperations: prev.dietOperations.map((item, i) =>
                                                i === opIdx
                                                  ? { ...item, mealName: e.target.value }
                                                  : item
                                              ),
                                            }
                                          : prev
                                      )
                                    }
                                  />
                                  <Input
                                    label="Time (HH:MM)"
                                    value={String(op.time || '')}
                                    onChange={(e) =>
                                      setEditDraft((prev) =>
                                        prev?.dietOperations
                                          ? {
                                              ...prev,
                                              dietOperations: prev.dietOperations.map((item, i) =>
                                                i === opIdx ? { ...item, time: e.target.value } : item
                                              ),
                                            }
                                          : prev
                                      )
                                    }
                                  />
                                  {op.servings !== undefined && (
                                    <Input
                                      label="Servings"
                                      type="number"
                                      step="0.25"
                                      value={String(op.servings)}
                                      onChange={(e) =>
                                        setEditDraft((prev) =>
                                          prev?.dietOperations
                                            ? {
                                                ...prev,
                                                dietOperations: prev.dietOperations.map((item, i) =>
                                                  i === opIdx
                                                    ? { ...item, servings: Number(e.target.value) }
                                                    : item
                                                ),
                                              }
                                            : prev
                                        )
                                      }
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {p.type === 'MODIFY_WORKOUT_PLAN' && editDraft.workoutOperations && (
                            <div className="space-y-2">
                              {editDraft.workoutOperations.map((op, opIdx) => (
                                <div
                                  key={opIdx}
                                  className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs border border-[#202733] rounded-[8px] p-2 bg-[#0D121A]"
                                >
                                  <Input
                                    label="Day"
                                    value={String(op.day || '')}
                                    onChange={(e) =>
                                      setEditDraft((prev) =>
                                        prev?.workoutOperations
                                          ? {
                                              ...prev,
                                              workoutOperations: prev.workoutOperations.map(
                                                (item, i) =>
                                                  i === opIdx
                                                    ? { ...item, day: e.target.value.toUpperCase() }
                                                    : item
                                              ),
                                            }
                                          : prev
                                      )
                                    }
                                  />
                                  {op.targetSets !== undefined && (
                                    <Input
                                      label="Sets"
                                      type="number"
                                      value={String(op.targetSets)}
                                      onChange={(e) =>
                                        setEditDraft((prev) =>
                                          prev?.workoutOperations
                                            ? {
                                                ...prev,
                                                workoutOperations: prev.workoutOperations.map(
                                                  (item, i) =>
                                                    i === opIdx
                                                      ? {
                                                          ...item,
                                                          targetSets: Number(e.target.value),
                                                        }
                                                      : item
                                                ),
                                              }
                                            : prev
                                        )
                                      }
                                    />
                                  )}
                                  {op.targetReps !== undefined && (
                                    <Input
                                      label="Reps"
                                      value={String(op.targetReps)}
                                      onChange={(e) =>
                                        setEditDraft((prev) =>
                                          prev?.workoutOperations
                                            ? {
                                                ...prev,
                                                workoutOperations: prev.workoutOperations.map(
                                                  (item, i) =>
                                                    i === opIdx
                                                      ? { ...item, targetReps: e.target.value }
                                                      : item
                                                ),
                                              }
                                            : prev
                                        )
                                      }
                                    />
                                  )}
                                  {op.restSeconds !== undefined && (
                                    <Input
                                      label="Rest (sec)"
                                      type="number"
                                      value={String(op.restSeconds)}
                                      onChange={(e) =>
                                        setEditDraft((prev) =>
                                          prev?.workoutOperations
                                            ? {
                                                ...prev,
                                                workoutOperations: prev.workoutOperations.map(
                                                  (item, i) =>
                                                    i === opIdx
                                                      ? {
                                                          ...item,
                                                          restSeconds: Number(e.target.value),
                                                        }
                                                      : item
                                                ),
                                              }
                                            : prev
                                        )
                                      }
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {busyProposalId === p.id && confirmStage && (
                        <div className="rounded-[9px] border border-[#B6F36A]/30 bg-[#121720] px-3 py-2.5 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-[#F5F7FA]">
                            <span className="flex items-center gap-2 font-medium">
                              <Sparkles className="h-3.5 w-3.5 text-[#B6F36A] animate-pulse" />
                              {confirmStage.label}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#B6F36A] ai-typing-dot-1" />
                              <span className="h-1.5 w-1.5 rounded-full bg-[#B6F36A] ai-typing-dot-2" />
                              <span className="h-1.5 w-1.5 rounded-full bg-[#B6F36A] ai-typing-dot-3" />
                            </span>
                          </div>
                          <div className="h-1 w-full overflow-hidden rounded-full bg-[#202733]">
                            <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-[#B6F36A]/40 via-[#B6F36A] to-[#B6F36A]/40 ai-loading-bar" />
                          </div>
                        </div>
                      )}

                      {status === 'PENDING' && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            disabled={busyProposalId === p.id}
                            onClick={() => handleConfirmProposal(msg.id, p)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            {busyProposalId === p.id
                              ? 'Applying...'
                              : p.type === 'CREATE_NEW_PLAN'
                                ? 'Save Template'
                                : 'Confirm & Apply'}
                          </Button>

                          {!isEditingThis ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyProposalId === p.id}
                              onClick={() => startEditingProposal(p)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setEditingProposalId(null);
                                setEditDraft(null);
                              }}
                            >
                              Done Editing
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyProposalId === p.id}
                            onClick={() => handleCancelProposal(msg.id, p)}
                          >
                            <X className="h-3.5 w-3.5" />
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {pendingPrompt && (
            <div className="flex flex-col items-end">
              <div className="max-w-[90%] rounded-[12px] px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed bg-[#26351D] text-[#F5F7FA] border border-[#B6F36A]/25">
                {pendingPrompt}
              </div>
            </div>
          )}

          {sending && (
            <div className="flex items-start" aria-live="polite" role="status">
              <div className="w-full max-w-[90%] rounded-[12px] border border-[#B6F36A]/30 bg-[#121720] px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#26351D] text-[#B6F36A]">
                      <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                    </div>
                    <span className="text-xs font-medium text-[#F5F7FA]">
                      {currentStage?.label || 'Gemini is thinking...'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 pr-0.5" aria-hidden="true">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#B6F36A] ai-typing-dot-1" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#B6F36A] ai-typing-dot-2" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#B6F36A] ai-typing-dot-3" />
                  </div>
                </div>

                <div className="h-1 w-full overflow-hidden rounded-full bg-[#202733]">
                  <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-[#B6F36A]/35 via-[#B6F36A] to-[#B6F36A]/35 ai-loading-bar" />
                </div>

                {stageHistory.length > 0 && (
                  <div className="space-y-1 pt-0.5">
                    {stageHistory.map((item) => {
                      const isActive = currentStage?.stage === item.stage;
                      return (
                        <div
                          key={item.stage}
                          className={`flex items-center gap-2 text-[11px] ${
                            isActive ? 'text-[#B6F36A] font-medium' : 'text-[#626C7B]'
                          }`}
                        >
                          {isActive ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-[#B6F36A] animate-pulse shrink-0 ml-1 mr-0.5" />
                          ) : (
                            <Check className="h-3 w-3 text-[#36C98F] shrink-0" />
                          )}
                          <span>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {failedRequest && !sending && (
            <div className="flex flex-col items-end space-y-2">
              <div className="max-w-[90%] rounded-[12px] px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed bg-[#26351D]/60 text-[#929BAA] border border-[#F16C75]/30">
                {failedRequest.prompt}
              </div>
              <div className="w-full self-start rounded-[12px] border border-[#F16C75]/40 bg-[#F16C75]/10 px-4 py-3 space-y-2.5">
                <div className="flex items-start gap-2.5 text-xs text-[#F5F7FA]">
                  <AlertCircle className="h-4 w-4 text-[#F16C75] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-semibold text-[#F16C75]">Unable to complete request</div>
                    <div className="text-[#F5F7FA]/90">{failedRequest.message}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <Button size="sm" onClick={handleRetry}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      chatRetryKeyRef.current = null;
                      setInput(failedRequest.prompt);
                      setFailedRequest(null);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Prompt
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      chatRetryKeyRef.current = null;
                      setFailedRequest(null);
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-t border-[#202733] bg-[#0D1016] p-3 shrink-0"
        >
          <input
            type="text"
            value={input}
            disabled={sending}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              sending
                ? 'FitTrack AI is processing...'
                : 'Ask FitTrack AI or request a plan update...'
            }
            className="flex-1 h-10 rounded-[9px] bg-[#0D121A] border border-[#252D38] px-3.5 text-sm text-[#F5F7FA] placeholder-[#626C7B] focus:outline-none focus:border-[#B6F36A] disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <Button type="submit" disabled={sending || !input.trim()} size="sm" className="h-10">
            <Send className="h-4 w-4" />
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </form>
      </div>

      <AiModelManagerModal
        open={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        modelsData={modelsData}
        onUpdated={handleModelsUpdated}
      />

      <Modal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="FitTrack AI Action Audit Log"
        subtitle="Record of every AI proposal, approval, edit, and cancellation."
        maxWidthClass="max-w-2xl"
      >
        {loadingAudit ? (
          <LoadingSpinner label="Loading audit history..." />
        ) : auditLogs.length === 0 ? (
          <p className="text-xs text-[#929BAA] py-4">No AI proposals recorded yet.</p>
        ) : (
          <div className="divide-y divide-[#202733] max-h-[55vh] overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="py-3 first:pt-0 space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span
                    className={`font-mono font-semibold ${
                      log.action === 'APPROVED'
                        ? 'text-[#36C98F]'
                        : log.action === 'CANCELLED'
                          ? 'text-[#F16C75]'
                          : log.action === 'EXPIRED'
                            ? 'text-[#F3B84B]'
                            : 'text-[#62A8F7]'
                    }`}
                  >
                    {log.action} · {log.type.replace(/_/g, ' ')}
                    {log.editedByUser ? ' (Edited)' : ''}
                  </span>
                  <span className="font-mono text-[#626C7B] tabular-nums">
                    {log.createdAt.slice(0, 19).replace('T', ' ')}
                  </span>
                </div>
                <p className="text-xs text-[#F5F7FA]">{log.summary}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
