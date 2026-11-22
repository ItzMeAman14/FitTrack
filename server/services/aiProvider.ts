import { GoogleGenAI, Type } from '@google/genai';
import { AppError } from '../utils/error.js';
import {
  DEFAULT_AI_REQUEST_BUDGET_MS,
  executeWithAiRetry,
  type AiFallbackInfo,
  type AiRetryAttemptInfo,
} from './aiRetry.js';

export type AiProviderName =
  | 'gemini'
  | 'grok'
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'openai_compatible';

export interface AiGenerationInput {
  systemInstruction: string;
  userPrompt: string;
  abortSignal?: AbortSignal;
  onFirstChunk?: () => void;
  onRetry?: (info: AiRetryAttemptInfo) => void;
  onFallbackModel?: (info: AiFallbackInfo) => void;
}

export interface AiGenerationResult {
  rawText: string;
  provider: AiProviderName;
  model: string;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  generateCoachingResponse(input: AiGenerationInput): Promise<AiGenerationResult>;
}

const DEPRECATED_GEMINI_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export function getConfiguredGeminiFallbackModels(primaryModel: string): string[] {
  const raw = [process.env.GEMINI_FALLBACK_MODEL, process.env.GEMINI_FALLBACK_MODELS]
    .filter(Boolean)
    .join(',');
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((m) => m.trim())
        .filter((m) => m && m !== primaryModel && !DEPRECATED_GEMINI_MODELS.has(m.toLowerCase()))
    )
  );
}

function createTimeoutController(
  externalSignal?: AbortSignal,
  timeoutMs = 40_000
): { signal: AbortSignal; timedOut: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let didTimeout = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error('AI_UPSTREAM_TIMEOUT'));
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

class HttpProviderError extends Error {
  status: number;
  headers: Headers;

  constructor(message: string, status: number, headers: Headers) {
    super(message);
    this.name = 'HttpProviderError';
    this.status = status;
    this.headers = headers;
  }
}

const GEMINI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    hasProposal: { type: Type.BOOLEAN },
    proposalType: {
      type: Type.STRING,
      description:
        'MODIFY_DIET_PLAN | MODIFY_WORKOUT_PLAN | CREATE_NEW_PLAN | ACTIVATE_SAVED_PLAN | UPDATE_TARGETS | LOG_FOOD | LOG_MEASUREMENT',
    },
    planName: { type: Type.STRING },
    planType: {
      type: Type.STRING,
      description: 'DIET | WORKOUT | TARGETS | MEASUREMENT | LOG',
    },
    affectedTarget: {
      type: Type.STRING,
      description: 'Affected meal name, workout day, or target category',
    },
    proposalSummary: { type: Type.STRING },
    impactSummary: { type: Type.STRING },
    changes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, description: 'ADD | UPDATE | REMOVE' },
          target: { type: Type.STRING },
          field: { type: Type.STRING },
          existingValue: { type: Type.STRING },
          proposedValue: { type: Type.STRING },
        },
        required: ['action', 'target', 'field', 'existingValue', 'proposedValue'],
      },
    },
    dietOperations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          op: {
            type: Type.STRING,
            description:
              'ADD_MEAL | UPDATE_MEAL | REMOVE_MEAL | ADD_FOOD_ITEM | UPDATE_FOOD_ITEM | REMOVE_FOOD_ITEM',
          },
          mealId: { type: Type.STRING },
          mealName: { type: Type.STRING },
          time: { type: Type.STRING, description: 'HH:MM 24h format' },
          itemId: { type: Type.STRING },
          foodId: { type: Type.STRING },
          servings: { type: Type.NUMBER },
          newFood: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              category: { type: Type.STRING },
              servingLabel: { type: Type.STRING },
              servingGrams: { type: Type.NUMBER },
              calories: { type: Type.NUMBER },
              proteinG: { type: Type.NUMBER },
              carbsG: { type: Type.NUMBER },
              fatG: { type: Type.NUMBER },
              priceInr: { type: Type.NUMBER },
            },
          },
        },
        required: ['op'],
      },
    },
    workoutOperations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          op: {
            type: Type.STRING,
            description:
              'UPDATE_DAY | ADD_EXERCISE | UPDATE_EXERCISE | REMOVE_EXERCISE | REORDER_EXERCISES | UPDATE_EXERCISE_LIBRARY',
          },
          day: { type: Type.STRING, description: 'MON|TUE|WED|THU|FRI|SAT|SUN' },
          focus: { type: Type.STRING },
          isRestDay: { type: Type.BOOLEAN },
          splitExerciseId: { type: Type.STRING },
          exerciseId: { type: Type.STRING },
          targetSets: { type: Type.INTEGER },
          targetReps: { type: Type.STRING },
          restSeconds: { type: Type.INTEGER },
          targetWeightKg: { type: Type.NUMBER },
          instructions: { type: Type.STRING },
          orderedSplitExerciseIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          newExercise: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              muscleGroup: { type: Type.STRING },
              equipment: { type: Type.STRING },
              defaultSets: { type: Type.INTEGER },
              defaultReps: { type: Type.STRING },
              defaultRestSeconds: { type: Type.INTEGER },
              defaultWeightKg: { type: Type.NUMBER },
              instructions: { type: Type.STRING },
            },
          },
        },
        required: ['op'],
      },
    },
    newPlan: {
      type: Type.OBJECT,
      properties: {
        planType: { type: Type.STRING, description: 'DIET | WORKOUT' },
        name: { type: Type.STRING },
        description: { type: Type.STRING },
        meals: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              time: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    foodId: { type: Type.STRING },
                    foodName: { type: Type.STRING },
                    servings: { type: Type.NUMBER },
                    servingLabel: { type: Type.STRING },
                    calories: { type: Type.NUMBER },
                    proteinG: { type: Type.NUMBER },
                    carbsG: { type: Type.NUMBER },
                    fatG: { type: Type.NUMBER },
                    priceInr: { type: Type.NUMBER },
                    category: { type: Type.STRING },
                  },
                  required: ['foodName', 'servings'],
                },
              },
            },
            required: ['name', 'time', 'items'],
          },
        },
        split: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              day: { type: Type.STRING },
              focus: { type: Type.STRING },
              isRestDay: { type: Type.BOOLEAN },
              exercises: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    exerciseId: { type: Type.STRING },
                    exerciseName: { type: Type.STRING },
                    muscleGroup: { type: Type.STRING },
                    equipment: { type: Type.STRING },
                    targetSets: { type: Type.INTEGER },
                    targetReps: { type: Type.STRING },
                    restSeconds: { type: Type.INTEGER },
                    targetWeightKg: { type: Type.NUMBER },
                    instructions: { type: Type.STRING },
                  },
                  required: ['exerciseName', 'muscleGroup', 'targetSets', 'targetReps'],
                },
              },
            },
            required: ['day', 'focus', 'isRestDay', 'exercises'],
          },
        },
      },
      required: ['planType', 'name', 'description'],
    },
    activatePlanId: { type: Type.STRING },
    targets: {
      type: Type.OBJECT,
      properties: {
        fitnessGoal: { type: Type.STRING },
        activityLevel: { type: Type.STRING },
        dailyCalorieTarget: { type: Type.INTEGER },
        dailyProteinTargetG: { type: Type.INTEGER },
        dailyCarbTargetG: { type: Type.INTEGER },
        dailyFatTargetG: { type: Type.INTEGER },
        targetWeightKg: { type: Type.NUMBER },
        targetWaistCm: { type: Type.NUMBER },
        targetBodyFatPct: { type: Type.NUMBER },
      },
    },
    logFood: {
      type: Type.OBJECT,
      properties: {
        foodId: { type: Type.STRING },
        foodName: { type: Type.STRING },
        servings: { type: Type.NUMBER },
        mealName: { type: Type.STRING },
      },
    },
    logMeasurement: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING },
        weightKg: { type: Type.NUMBER },
        bodyFatPct: { type: Type.NUMBER },
        waistCm: { type: Type.NUMBER },
        chestCm: { type: Type.NUMBER },
        hipsCm: { type: Type.NUMBER },
        armsCm: { type: Type.NUMBER },
        thighsCm: { type: Type.NUMBER },
        neckCm: { type: Type.NUMBER },
        calvesCm: { type: Type.NUMBER },
        notes: { type: Type.STRING },
      },
    },
  },
  required: ['reply', 'hasProposal'],
};

const STRUCTURED_JSON_CONTRACT_PROMPT = `
OUTPUT FORMAT (STRICT JSON ONLY):
Return a single valid JSON object (no markdown fences, no commentary outside JSON) matching this schema:
{
  "reply": string (required - your coaching answer),
  "hasProposal": boolean (required - true ONLY when proposing an actionable change or new plan),
  "proposalType": "MODIFY_DIET_PLAN" | "MODIFY_WORKOUT_PLAN" | "CREATE_NEW_PLAN" | "ACTIVATE_SAVED_PLAN" | "UPDATE_TARGETS" | "LOG_FOOD" | "LOG_MEASUREMENT",
  "planName": string,
  "planType": "DIET" | "WORKOUT" | "TARGETS" | "MEASUREMENT" | "LOG",
  "affectedTarget": string,
  "proposalSummary": string,
  "impactSummary": string,
  "changes": [{ "action": "ADD"|"UPDATE"|"REMOVE", "target": string, "field": string, "existingValue": string, "proposedValue": string }],
  "dietOperations": [{ "op": "ADD_MEAL"|"UPDATE_MEAL"|"REMOVE_MEAL"|"ADD_FOOD_ITEM"|"UPDATE_FOOD_ITEM"|"REMOVE_FOOD_ITEM", "mealId"?: string, "mealName"?: string, "time"?: "HH:MM", "itemId"?: string, "foodId"?: string, "servings"?: number, "newFood"?: { "name": string, "category"?: string, "servingLabel"?: string, "servingGrams"?: number, "calories"?: number, "proteinG"?: number, "carbsG"?: number, "fatG"?: number, "priceInr"?: number } }],
  "workoutOperations": [{ "op": "UPDATE_DAY"|"ADD_EXERCISE"|"UPDATE_EXERCISE"|"REMOVE_EXERCISE"|"REORDER_EXERCISES"|"UPDATE_EXERCISE_LIBRARY", "day"?: "MON"|"TUE"|"WED"|"THU"|"FRI"|"SAT"|"SUN", "focus"?: string, "isRestDay"?: boolean, "splitExerciseId"?: string, "exerciseId"?: string, "targetSets"?: number, "targetReps"?: string, "restSeconds"?: number, "targetWeightKg"?: number, "instructions"?: string, "orderedSplitExerciseIds"?: string[], "newExercise"?: { "name": string, "muscleGroup"?: string, "equipment"?: string, "defaultSets"?: number, "defaultReps"?: string, "defaultRestSeconds"?: number, "defaultWeightKg"?: number, "instructions"?: string } }],
  "newPlan": { "planType": "DIET"|"WORKOUT", "name": string, "description": string, "meals"?: [...], "split"?: [...] },
  "activatePlanId": string,
  "targets": { "fitnessGoal"?: string, "activityLevel"?: string, "dailyCalorieTarget"?: number, "dailyProteinTargetG"?: number, "dailyCarbTargetG"?: number, "dailyFatTargetG"?: number, "targetWeightKg"?: number, "targetWaistCm"?: number, "targetBodyFatPct"?: number },
  "logFood": { "foodId"?: string, "foodName"?: string, "servings"?: number, "mealName"?: string },
  "logMeasurement": { "date"?: "YYYY-MM-DD", "weightKg"?: number, "bodyFatPct"?: number, "waistCm"?: number, "chestCm"?: number, "hipsCm"?: number, "armsCm"?: number, "thighsCm"?: number, "neckCm"?: number, "calvesCm"?: number, "notes"?: string }
}`.trim();

export function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export type GeminiStreamRunner = (params: {
  model: string;
  contents: string;
  systemInstruction: string;
  abortSignal: AbortSignal;
}) => Promise<AsyncIterable<{ text?: string }>>;

export class GeminiAiProvider implements AiProvider {
  readonly name: AiProviderName = 'gemini';
  readonly model: string;
  private readonly apiKey: string;
  private readonly fallbackModels: string[];
  private readonly streamRunner?: GeminiStreamRunner;
  private readonly retryConfig?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    totalBudgetMs?: number;
    random?: () => number;
    logError?: (payload: Record<string, unknown>) => void;
  };

  constructor(options?: {
    apiKey?: string;
    model?: string;
    fallbackModels?: string[];
    streamRunner?: GeminiStreamRunner;
    retryConfig?: {
      maxRetries?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
      totalBudgetMs?: number;
      random?: () => number;
      logError?: (payload: Record<string, unknown>) => void;
    };
  }) {
    const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new AppError(
        'GEMINI_API_KEY is not configured. Add it in your environment or Settings > Secrets panel to enable FitTrack AI.',
        503
      );
    }
    this.apiKey = apiKey;
    this.model = options?.model?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';
    this.fallbackModels =
      options?.fallbackModels ?? getConfiguredGeminiFallbackModels(this.model);
    this.streamRunner = options?.streamRunner;
    this.retryConfig = options?.retryConfig;
  }

  private async runSingleStreamAttempt(
    model: string,
    input: AiGenerationInput,
    perAttemptTimeoutMs: number
  ): Promise<string> {
    const timeout = createTimeoutController(input.abortSignal, perAttemptTimeoutMs);
    try {
      let stream: AsyncIterable<{ text?: string }>;
      if (this.streamRunner) {
        stream = await this.streamRunner({
          model,
          contents: input.userPrompt,
          systemInstruction: input.systemInstruction,
          abortSignal: timeout.signal,
        });
      } else {
        const ai = new GoogleGenAI({
          apiKey: this.apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
        stream = await ai.models.generateContentStream({
          model,
          contents: input.userPrompt,
          config: {
            systemInstruction: input.systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
            abortSignal: timeout.signal,
          },
        });
      }

      let fullText = '';
      let notified = false;
      for await (const chunk of stream) {
        if (timeout.signal.aborted) {
          throw new Error(timeout.timedOut() ? 'AI_UPSTREAM_TIMEOUT' : 'AbortError');
        }
        const piece = chunk.text ?? '';
        if (piece) {
          if (!notified) {
            notified = true;
            input.onFirstChunk?.();
          }
          fullText += piece;
        }
      }

      return fullText.trim();
    } catch (err: unknown) {
      if (timeout.timedOut()) {
        throw new Error('AI_UPSTREAM_TIMEOUT');
      }
      throw err;
    } finally {
      timeout.cleanup();
    }
  }

  async generateCoachingResponse(input: AiGenerationInput): Promise<AiGenerationResult> {
    const modelsToTry = [this.model, ...this.fallbackModels];
    const { result: rawText, modelUsed } = await executeWithAiRetry({
      providerLabel: 'Gemini',
      models: modelsToTry,
      maxRetries: this.retryConfig?.maxRetries,
      baseDelayMs: this.retryConfig?.baseDelayMs,
      maxDelayMs: this.retryConfig?.maxDelayMs,
      totalBudgetMs: this.retryConfig?.totalBudgetMs ?? DEFAULT_AI_REQUEST_BUDGET_MS,
      random: this.retryConfig?.random,
      abortSignal: input.abortSignal,
      onRetry: input.onRetry,
      onFallbackModel: input.onFallbackModel,
      logError: this.retryConfig?.logError,
      runAttempt: (model, remainingBudgetMs) =>
        this.runSingleStreamAttempt(
          model,
          input,
          Math.min(40_000, Math.max(10_000, remainingBudgetMs))
        ),
    });

    return {
      rawText,
      provider: this.name,
      model: modelUsed,
    };
  }
}

function isDisallowedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 private / loopback / link-local ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  // IPv6 unique local / link-local
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }

  return false;
}

export function validateCustomBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError('Custom API base URL must be a valid URL.', 400);
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError('Custom API base URL must start with https://.', 400);
  }
  if (parsed.username || parsed.password) {
    throw new AppError('Custom API base URL must not include embedded credentials.', 400);
  }
  if (isDisallowedHostname(parsed.hostname)) {
    throw new AppError('Custom API base URL cannot target private or local network addresses.', 400);
  }
  return parsed.toString().replace(/\/+$/, '');
}

class OpenAICompatibleAiProvider implements AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly useJsonResponseFormat: boolean;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: {
    name: 'grok' | 'openrouter' | 'openai' | 'deepseek' | 'openai_compatible';
    apiKey: string | undefined;
    model: string;
    baseUrl: string;
    missingKeyMessage: string;
    useJsonResponseFormat?: boolean;
    extraHeaders?: Record<string, string>;
  }) {
    if (!options.apiKey || options.apiKey.startsWith('MY_')) {
      throw new AppError(options.missingKeyMessage, 503);
    }
    this.name = options.name;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.useJsonResponseFormat =
      options.useJsonResponseFormat ?? (options.name === 'openai' || options.name === 'deepseek');
    this.extraHeaders = options.extraHeaders ?? {};
  }

  async generateCoachingResponse(input: AiGenerationInput): Promise<AiGenerationResult> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const systemPrompt = `${input.systemInstruction}\n\n${STRUCTURED_JSON_CONTRACT_PROMPT}`;
    const providerLabel =
      this.name === 'grok'
        ? 'Grok'
        : this.name === 'openrouter'
          ? 'OpenRouter'
          : this.name === 'openai'
            ? 'OpenAI'
            : this.name === 'deepseek'
              ? 'DeepSeek'
              : 'Custom AI';

    const { result: rawText } = await executeWithAiRetry({
      providerLabel,
      models: [this.model],
      totalBudgetMs: DEFAULT_AI_REQUEST_BUDGET_MS,
      abortSignal: input.abortSignal,
      onRetry: input.onRetry,
      onFallbackModel: input.onFallbackModel,
      runAttempt: async (model, remainingBudgetMs) => {
        const timeout = createTimeoutController(
          input.abortSignal,
          Math.min(40_000, Math.max(10_000, remainingBudgetMs))
        );
        try {
          const requestBody: Record<string, unknown> = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: input.userPrompt },
            ],
          };
          if (this.useJsonResponseFormat) {
            requestBody.response_format = { type: 'json_object' };
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            signal: timeout.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
              ...this.extraHeaders,
            },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new HttpProviderError(
              `AI provider (${this.name}) returned HTTP ${res.status}: ${errText.slice(0, 200) || res.statusText}`,
              res.status,
              res.headers
            );
          }

          input.onFirstChunk?.();
          const payload = (await res.json()) as {
            choices?: Array<{ message?: { content?: string | null } }>;
          };
          const content = payload.choices?.[0]?.message?.content ?? '';
          return stripJsonCodeFences(content);
        } catch (err: unknown) {
          if (timeout.timedOut()) {
            throw new Error('AI_UPSTREAM_TIMEOUT');
          }
          throw err;
        } finally {
          timeout.cleanup();
        }
      },
    });

    return {
      rawText,
      provider: this.name,
      model: this.model,
    };
  }
}

class AnthropicAiProvider implements AiProvider {
  readonly name: AiProviderName = 'anthropic';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options?: { apiKey?: string; model?: string; baseUrl?: string }) {
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.startsWith('MY_')) {
      throw new AppError(
        'ANTHROPIC_API_KEY is not configured in server environment variables.',
        503
      );
    }
    this.apiKey = apiKey;
    this.model =
      options?.model?.trim() || process.env.ANTHROPIC_MODEL?.trim() || 'claude-3-5-sonnet-latest';
    this.baseUrl = (
      options?.baseUrl?.trim() ||
      process.env.ANTHROPIC_BASE_URL?.trim() ||
      'https://api.anthropic.com/v1'
    ).replace(/\/+$/, '');
  }

  async generateCoachingResponse(input: AiGenerationInput): Promise<AiGenerationResult> {
    const { result: rawText } = await executeWithAiRetry({
      providerLabel: 'Claude',
      models: [this.model],
      totalBudgetMs: DEFAULT_AI_REQUEST_BUDGET_MS,
      abortSignal: input.abortSignal,
      onRetry: input.onRetry,
      onFallbackModel: input.onFallbackModel,
      runAttempt: async (model, remainingBudgetMs) => {
        const timeout = createTimeoutController(
          input.abortSignal,
          Math.min(40_000, Math.max(10_000, remainingBudgetMs))
        );
        try {
          const res = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            signal: timeout.signal,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: 4096,
              system: `${input.systemInstruction}\n\n${STRUCTURED_JSON_CONTRACT_PROMPT}`,
              messages: [{ role: 'user', content: input.userPrompt }],
            }),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new HttpProviderError(
              `Anthropic API returned HTTP ${res.status}: ${errText.slice(0, 200) || res.statusText}`,
              res.status,
              res.headers
            );
          }

          input.onFirstChunk?.();
          const payload = (await res.json()) as {
            content?: Array<{ type?: string; text?: string }>;
          };
          const text = (payload.content || [])
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('\n');

          return stripJsonCodeFences(text);
        } catch (err: unknown) {
          if (timeout.timedOut()) {
            throw new Error('AI_UPSTREAM_TIMEOUT');
          }
          throw err;
        } finally {
          timeout.cleanup();
        }
      },
    });

    return {
      rawText,
      provider: this.name,
      model: this.model,
    };
  }
}

export function createAiProviderFromConfig(config: {
  provider: AiProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
}): AiProvider {
  const cleanModel = config.model.trim();
  const cleanKey = config.apiKey.trim();
  if (!cleanModel) {
    throw new AppError('Model name is required.', 400);
  }
  if (!cleanKey) {
    throw new AppError('API key is required.', 400);
  }

  switch (config.provider) {
    case 'gemini':
      return new GeminiAiProvider({
        apiKey: cleanKey,
        model: cleanModel,
        fallbackModels: [],
      });

    case 'grok':
      return new OpenAICompatibleAiProvider({
        name: 'grok',
        apiKey: cleanKey,
        model: cleanModel,
        baseUrl: config.baseUrl?.trim() ? validateCustomBaseUrl(config.baseUrl) : 'https://api.x.ai/v1',
        missingKeyMessage: 'Grok (xAI) API key is required.',
        useJsonResponseFormat: false,
      });

    case 'openrouter':
      return new OpenAICompatibleAiProvider({
        name: 'openrouter',
        apiKey: cleanKey,
        model: cleanModel,
        baseUrl: config.baseUrl?.trim()
          ? validateCustomBaseUrl(config.baseUrl)
          : 'https://openrouter.ai/api/v1',
        missingKeyMessage: 'OpenRouter API key is required.',
        useJsonResponseFormat: false,
        extraHeaders: {
          'X-Title': 'FitTrack',
        },
      });

    case 'openai':
      return new OpenAICompatibleAiProvider({
        name: 'openai',
        apiKey: cleanKey,
        model: cleanModel,
        baseUrl: config.baseUrl?.trim() ? validateCustomBaseUrl(config.baseUrl) : 'https://api.openai.com/v1',
        missingKeyMessage: 'OpenAI API key is required.',
      });

    case 'deepseek':
      return new OpenAICompatibleAiProvider({
        name: 'deepseek',
        apiKey: cleanKey,
        model: cleanModel,
        baseUrl: config.baseUrl?.trim() ? validateCustomBaseUrl(config.baseUrl) : 'https://api.deepseek.com/v1',
        missingKeyMessage: 'DeepSeek API key is required.',
      });

    case 'anthropic':
      return new AnthropicAiProvider({
        apiKey: cleanKey,
        model: cleanModel,
        baseUrl: config.baseUrl?.trim() ? validateCustomBaseUrl(config.baseUrl) : 'https://api.anthropic.com/v1',
      });

    case 'openai_compatible': {
      if (!config.baseUrl?.trim()) {
        throw new AppError('Base URL is required for OpenAI-compatible endpoints.', 400);
      }
      return new OpenAICompatibleAiProvider({
        name: 'openai_compatible',
        apiKey: cleanKey,
        model: cleanModel,
        baseUrl: validateCustomBaseUrl(config.baseUrl),
        missingKeyMessage: 'API key is required for this custom model.',
        useJsonResponseFormat: false,
      });
    }
  }
}

export function resolveConfiguredProviderName(): AiProviderName {
  const raw = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
  if (raw === 'grok' || raw === 'xai') return 'grok';
  if (raw === 'openrouter') return 'openrouter';
  if (raw === 'openai') return 'openai';
  if (raw === 'anthropic' || raw === 'claude') return 'anthropic';
  if (raw === 'deepseek') return 'deepseek';
  if (raw === 'openai_compatible' || raw === 'openai-compatible' || raw === 'custom') {
    return 'openai_compatible';
  }
  return 'gemini';
}

export function getAiProvider(): AiProvider {
  const selected = resolveConfiguredProviderName();

  switch (selected) {
    case 'grok':
      return new OpenAICompatibleAiProvider({
        name: 'grok',
        apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY,
        model: process.env.GROK_MODEL?.trim() || 'grok-3-mini',
        baseUrl: process.env.GROK_BASE_URL?.trim() || 'https://api.x.ai/v1',
        missingKeyMessage: 'GROK_API_KEY is not configured in server environment variables.',
        useJsonResponseFormat: false,
      });

    case 'openrouter':
      return new OpenAICompatibleAiProvider({
        name: 'openrouter',
        apiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL?.trim() || 'meta-llama/llama-3.3-70b-instruct:free',
        baseUrl: process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1',
        missingKeyMessage: 'OPENROUTER_API_KEY is not configured in server environment variables.',
        useJsonResponseFormat: false,
        extraHeaders: { 'X-Title': 'FitTrack' },
      });

    case 'openai':
      return new OpenAICompatibleAiProvider({
        name: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
        baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
        missingKeyMessage: 'OPENAI_API_KEY is not configured in server environment variables.',
      });

    case 'deepseek':
      return new OpenAICompatibleAiProvider({
        name: 'deepseek',
        apiKey: process.env.DEEPSEEK_API_KEY,
        model: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
        baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1',
        missingKeyMessage: 'DEEPSEEK_API_KEY is not configured in server environment variables.',
      });

    case 'openai_compatible': {
      const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
      const model = process.env.OPENAI_COMPATIBLE_MODEL?.trim();
      if (!baseUrl || !model) {
        throw new AppError(
          'OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL must be configured when AI_PROVIDER=openai_compatible.',
          503
        );
      }
      return new OpenAICompatibleAiProvider({
        name: 'openai_compatible',
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
        model,
        baseUrl,
        missingKeyMessage:
          'OPENAI_COMPATIBLE_API_KEY is not configured in server environment variables.',
      });
    }

    case 'anthropic':
      return new AnthropicAiProvider();

    case 'gemini':
    default:
      return new GeminiAiProvider();
  }
}

export function getActiveAiProviderMetadata(): {
  provider: AiProviderName;
  model: string;
  configured: boolean;
} {
  const provider = resolveConfiguredProviderName();
  try {
    const instance = getAiProvider();
    return { provider: instance.name, model: instance.model, configured: true };
  } catch {
    const fallbackModel =
      provider === 'grok'
        ? process.env.GROK_MODEL?.trim() || 'grok-3-mini'
        : provider === 'openrouter'
          ? process.env.OPENROUTER_MODEL?.trim() || 'meta-llama/llama-3.3-70b-instruct:free'
          : provider === 'openai'
            ? process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
            : provider === 'anthropic'
              ? process.env.ANTHROPIC_MODEL?.trim() || 'claude-3-5-sonnet-latest'
              : provider === 'deepseek'
                ? process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat'
                : provider === 'openai_compatible'
                  ? process.env.OPENAI_COMPATIBLE_MODEL?.trim() || 'custom'
                  : process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';
    return { provider, model: fallbackModel, configured: false };
  }
}

