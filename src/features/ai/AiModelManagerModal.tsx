import { useEffect, useState, type FormEvent } from 'react';
import { Check, Cpu, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import type {
  AiModelsResponse,
  AiProviderName,
  UserAiModelSummary,
} from '../../types/fittrack';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';

const PROVIDER_OPTIONS: Array<{ value: AiProviderName; label: string }> = [
  { value: 'gemini', label: 'Google Gemini (Free Tier)' },
  { value: 'grok', label: 'Grok (xAI)' },
  { value: 'openrouter', label: 'OpenRouter (Free Models)' },
  { value: 'openai_compatible', label: 'OpenAI-Compatible (Custom URL)' },
];

const MODEL_PRESETS: Record<string, string[]> = {
  gemini: ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  grok: ['grok-3-mini', 'grok-3-mini-fast', 'grok-2-1212'],
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'qwen/qwen3-235b-a22b:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
  ],
  openai_compatible: ['llama-3.3-70b-versatile', 'qwen-2.5-72b-instruct'],
};

const PROVIDER_LABELS: Record<AiProviderName, string> = {
  gemini: 'Gemini',
  grok: 'Grok',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
  openai_compatible: 'Custom',
};

interface AiModelManagerModalProps {
  open: boolean;
  onClose: () => void;
  modelsData: AiModelsResponse | null;
  onUpdated: (preferredActiveModelId?: string) => Promise<void> | void;
}

export function AiModelManagerModal({
  open,
  onClose,
  modelsData,
  onUpdated,
}: AiModelManagerModalProps) {
  const { showToast } = useToast();

  const [provider, setProvider] = useState<AiProviderName>('gemini');
  const [modelName, setModelName] = useState('gemini-4-hydrogen');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [setAsActive, setSetAsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setApiKey('');
    }
  }, [open]);

  const handleProviderChange = (next: AiProviderName) => {
    setProvider(next);
    const defaultPreset = MODEL_PRESETS[next]?.[0] || '';
    setModelName(defaultPreset);
    if (next !== 'openai_compatible') {
      setBaseUrl('');
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!modelName.trim() || !apiKey.trim()) {
      showToast('Please enter both a Model ID and API key.', 'error');
      return;
    }
    if (provider === 'openai_compatible' && !baseUrl.trim()) {
      showToast('Please enter an HTTPS Base URL for your custom endpoint.', 'error');
      return;
    }

    setSaving(true);
    try {
      const res = await api.post<UserAiModelSummary>('/ai/models', {
        provider,
        modelName: modelName.trim(),
        apiKey: apiKey.trim(),
        label: label.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        setAsActive,
      });
      setApiKey('');
      setLabel('');
      setBaseUrl('');
      await onUpdated(setAsActive ? res.data.id : undefined);
      showToast(`Added ${res.data.label} cleanly.`, 'success');
      if (setAsActive) {
        onClose();
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save custom AI model.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    setBusyId(modelId);
    try {
      await api.post('/ai/models/select', { modelId });
      await onUpdated(modelId);
      showToast('Active AI model updated.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to switch model.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteModel = async (model: UserAiModelSummary) => {
    setBusyId(model.id);
    try {
      await api.delete(`/ai/models/${model.id}`);
      await onUpdated(modelsData?.activeModelId === model.id ? 'BUILTIN' : undefined);
      showToast(`Removed ${model.label}.`, 'info');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to remove model.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const customModels = modelsData?.customModels || [];
  const activeModelId = modelsData?.activeModelId || 'BUILTIN';
  const activePresets = MODEL_PRESETS[provider] || [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI Models & Custom API Keys"
      subtitle="Add your own provider key to use your preferred model in AI Coach. Keys are encrypted on the server."
      maxWidthClass="max-w-xl"
    >
      <div className="space-y-5">
        <form onSubmit={handleCreate} className="space-y-3.5 rounded-[12px] border border-[#252D38] bg-[#0D121A] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F5F7FA]">
              <Plus className="h-3.5 w-3.5 text-[#B6F36A]" />
              Add Custom Model
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#39C9BA]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Server-side only
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Provider"
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as AiProviderName)}
              options={PROVIDER_OPTIONS}
            />
            <Input
              label="Model ID"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={activePresets[0] || 'Enter model ID...'}
              required
            />
          </div>

          {activePresets.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[#626C7B] mr-1">Presets:</span>
              {activePresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setModelName(preset)}
                  className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors cursor-pointer ${
                    modelName === preset
                      ? 'border-[#B6F36A]/50 bg-[#26351D] text-[#B6F36A]'
                      : 'border-[#252D38] bg-[#121720] text-[#929BAA] hover:text-[#F5F7FA]'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="API Key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key..."
              required
            />
            <Input
              label="Label (Optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`My ${PROVIDER_LABELS[provider]} Key`}
            />
          </div>

          {provider === 'openai_compatible' && (
            <Input
              label="Base URL (HTTPS)"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.groq.com/openai/v1"
              required
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-[#F5F7FA] cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[#252D38] bg-[#121720] accent-[#B6F36A]"
                checked={setAsActive}
                onChange={(e) => setSetAsActive(e.target.checked)}
              />
              Use immediately in AI Coach
            </label>

            <Button type="submit" size="sm" disabled={saving}>
              <KeyRound className="h-3.5 w-3.5" />
              {saving ? 'Encrypting & Saving...' : 'Save Model'}
            </Button>
          </div>
        </form>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#929BAA]">
              Available Models ({customModels.length + 1})
            </h3>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
            <div
              className={`flex items-center justify-between gap-3 rounded-[10px] border p-3 ${
                activeModelId === 'BUILTIN'
                  ? 'border-[#B6F36A]/45 bg-[#26351D]/35'
                  : 'border-[#252D38] bg-[#121720]'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Cpu className="h-3.5 w-3.5 text-[#B6F36A] shrink-0" />
                  <span className="text-xs font-semibold text-[#F5F7FA] truncate">
                    FitTrack Default ({modelsData?.builtIn.model || 'gemini-4-hydrogen'})
                  </span>
                </div>
                <p className="text-[11px] text-[#929BAA] mt-0.5">
                  {modelsData?.builtIn.configured
                    ? `Server-configured ${PROVIDER_LABELS[modelsData.builtIn.provider]}`
                    : 'Server API key not configured — add your own key above'}
                </p>
              </div>
              {activeModelId === 'BUILTIN' ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] shrink-0">
                  <Check className="h-3.5 w-3.5" /> Active
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busyId === 'BUILTIN'}
                  onClick={() => handleSelectModel('BUILTIN')}
                >
                  Use
                </Button>
              )}
            </div>

            {customModels.map((model) => {
              const isActive = activeModelId === model.id;
              return (
                <div
                  key={model.id}
                  className={`flex items-center justify-between gap-3 rounded-[10px] border p-3 ${
                    isActive
                      ? 'border-[#B6F36A]/45 bg-[#26351D]/35'
                      : 'border-[#252D38] bg-[#121720]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-[#62A8F7] shrink-0" />
                      <span className="text-xs font-semibold text-[#F5F7FA] truncate">
                        {model.label}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-[#929BAA] mt-0.5 truncate">
                      {PROVIDER_LABELS[model.provider]} · {model.modelName} · Key {model.keyPreview}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#B6F36A] px-1.5">
                        <Check className="h-3.5 w-3.5" /> Active
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busyId === model.id}
                        onClick={() => handleSelectModel(model.id)}
                      >
                        Use
                      </Button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === model.id}
                      onClick={() => handleDeleteModel(model)}
                      title="Delete saved model"
                      aria-label={`Delete ${model.label}`}
                      className="rounded-lg p-1.5 text-[#929BAA] hover:bg-[#171E29] hover:text-[#F16C75] disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
