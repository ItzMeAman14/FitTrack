import { AppError } from '../utils/error.js';

export const MAX_AI_RETRY_ATTEMPTS = 3;
export const DEFAULT_AI_BASE_DELAY_MS = 1000;
export const DEFAULT_AI_MAX_DELAY_MS = 10_000;
export const DEFAULT_AI_REQUEST_BUDGET_MS = 52_000;

export type AiErrorCategory =
  | 'MISSING_API_KEY'
  | 'AUTH_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMIT'
  | 'SERVICE_UNAVAILABLE'
  | 'TRANSIENT_SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'BAD_REQUEST'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface ClassifiedAiError {
  category: AiErrorCategory;
  httpStatus: number;
  retryable: boolean;
  retryAfterMs: number | null;
  userMessage: string;
  rawCode?: string;
}

export interface AiRetryAttemptInfo {
  attempt: number;
  maxRetries: number;
  model: string;
  category: AiErrorCategory;
  statusCode: number;
  delayMs: number;
  retryAfterMs: number | null;
  friendlyMessage: string;
}

export interface AiFallbackInfo {
  fromModel: string;
  toModel: string;
  reasonCategory: AiErrorCategory;
}

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /sk-(?:ant-|proj-|svcacct-)?[0-9A-Za-z\-_]{16,}/g,
  /(?:gsk_|xai-)[0-9A-Za-z\-_]{16,}/g,
  /Bearer\s+[0-9A-Za-z\-_.=:+/]{10,}/gi,
  /(api[_-]?key|x-api-key|token|password|secret)\s*[:=]\s*["']?[^\s"'&,}]{6,}/gi,
  /postgres(?:ql)?:\/\/[^\s"'`]+/gi,
];

export function sanitizeTextForLog(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const eqIdx = match.search(/[:=]/);
      if (eqIdx > -1 && !match.startsWith('postgres')) {
        return `${match.slice(0, eqIdx + 1)}[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }
  return out;
}

function getHeaderValue(headers: unknown, headerName: string): string | null {
  if (!headers) return null;
  const target = headerName.toLowerCase();

  if (typeof (headers as { get?: unknown }).get === 'function') {
    const val = (headers as { get: (name: string) => string | null }).get(headerName);
    return val ? String(val).trim() : null;
  }

  if (typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (k.toLowerCase() === target && v !== undefined && v !== null) {
        return Array.isArray(v) ? String(v[0] ?? '').trim() : String(v).trim();
      }
    }
  }

  return null;
}

export function parseRetryAfterMs(
  errOrHeaders: unknown,
  nowMs: number = Date.now()
): number | null {
  let rawValue: string | null = null;

  if (typeof errOrHeaders === 'string' || typeof errOrHeaders === 'number') {
    rawValue = String(errOrHeaders).trim();
  } else if (errOrHeaders && typeof errOrHeaders === 'object') {
    const obj = errOrHeaders as Record<string, unknown>;
    rawValue =
      getHeaderValue(obj, 'retry-after') ||
      getHeaderValue(obj.headers, 'retry-after') ||
      getHeaderValue((obj.response as Record<string, unknown> | undefined)?.headers, 'retry-after');

    if (!rawValue && obj.retryAfter !== undefined && obj.retryAfter !== null) {
      rawValue = String(obj.retryAfter).trim();
    }

    // Check Google JSON error payload hints like "Please retry in 3.5s" or "retryDelay":"4s"
    if (!rawValue && typeof obj.message === 'string') {
      const jsonDelay = obj.message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
      if (jsonDelay) {
        rawValue = jsonDelay[1];
      } else {
        const textDelay = obj.message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
        if (textDelay) {
          rawValue = textDelay[1];
        }
      }
    }
  }

  if (!rawValue) return null;

  const numericSeconds = Number(rawValue);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.round(numericSeconds * 1000);
  }

  const parsedDate = Date.parse(rawValue);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - nowMs);
  }

  return null;
}

function extractStatusAndDetails(err: unknown): {
  status: number | null;
  message: string;
  code: string | null;
} {
  if (err instanceof AppError) {
    return { status: err.statusCode, message: err.message, code: null };
  }
  if (!err || typeof err !== 'object') {
    return { status: null, message: String(err || ''), code: null };
  }
  const rec = err as Record<string, unknown>;
  const cause = (rec.cause && typeof rec.cause === 'object' ? rec.cause : null) as Record<
    string,
    unknown
  > | null;

  let status: number | null = null;
  if (typeof rec.status === 'number') status = rec.status;
  else if (typeof rec.statusCode === 'number') status = rec.statusCode;
  else if (typeof (rec.response as Record<string, unknown> | undefined)?.status === 'number') {
    status = (rec.response as Record<string, unknown>).status as number;
  }

  const codeRaw = rec.code ?? cause?.code;
  const code = typeof codeRaw === 'string' ? codeRaw : null;
  const message = typeof rec.message === 'string' ? rec.message : String(err);

  if (status === null && message) {
    const codeMatch = message.match(/"code"\s*:\s*(\d{3})/);
    if (codeMatch) {
      status = Number(codeMatch[1]);
    }
  }

  return { status, message, code };
}

export function classifyAiError(
  err: unknown,
  options?: {
    providerLabel?: string;
    didTimeout?: boolean;
    externalAborted?: boolean;
  }
): ClassifiedAiError {
  const provider = options?.providerLabel || 'Gemini';
  const { status, message, code } = extractStatusAndDetails(err);
  const lower = message.toLowerCase();
  const retryAfterMs = parseRetryAfterMs(err);

  if (options?.externalAborted) {
    return {
      category: 'CANCELLED',
      httpStatus: 499,
      retryable: false,
      retryAfterMs: null,
      userMessage: `Request was cancelled before ${provider} finished responding.`,
    };
  }

  if (options?.didTimeout || message === 'AI_UPSTREAM_TIMEOUT' || status === 504) {
    return {
      category: 'TIMEOUT',
      httpStatus: 504,
      retryable: true,
      retryAfterMs,
      userMessage: `${provider} timed out while generating a response. Please retry.`,
    };
  }

  if (err instanceof AppError && status === 503 && lower.includes('api_key')) {
    return {
      category: 'MISSING_API_KEY',
      httpStatus: 503,
      retryable: false,
      retryAfterMs: null,
      userMessage: err.message,
    };
  }

  // Permanent authentication / key errors
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthorized')
  ) {
    return {
      category: 'AUTH_ERROR',
      httpStatus: 503,
      retryable: false,
      retryAfterMs: null,
      rawCode: code || undefined,
      userMessage: `${provider} API authentication failed. Please check that your API key is valid and active.`,
    };
  }

  // Permanent model-not-found errors
  if (status === 404 || lower.includes('not_found') || lower.includes('is not found for api version')) {
    return {
      category: 'MODEL_NOT_FOUND',
      httpStatus: 502,
      retryable: false,
      retryAfterMs: null,
      rawCode: code || undefined,
      userMessage: `The configured ${provider} model is unavailable or unsupported.`,
    };
  }

  // Distinguish permanent billing/daily quota exhaustion from transient rate limits
  if (
    status === 402 ||
    lower.includes('billing') ||
    lower.includes('insufficient_quota') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('free_tier_requests, limit: 0') ||
    lower.includes('limit: 0')
  ) {
    return {
      category: 'QUOTA_EXCEEDED',
      httpStatus: 429,
      retryable: false,
      retryAfterMs,
      rawCode: code || undefined,
      userMessage: `${provider} quota or billing limit has been reached. Check your API billing/quota settings.`,
    };
  }

  // Transient rate limits
  if (
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return {
      category: 'RATE_LIMIT',
      httpStatus: 429,
      retryable: true,
      retryAfterMs,
      rawCode: code || undefined,
      userMessage: `${provider} is temporarily rate-limited. Please wait a moment and try again.`,
    };
  }

  // High demand / 503 service unavailable
  if (
    status === 503 ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('temporarily unavailable')
  ) {
    return {
      category: 'SERVICE_UNAVAILABLE',
      httpStatus: 503,
      retryable: true,
      retryAfterMs,
      rawCode: code || undefined,
      userMessage: `${provider} is currently experiencing high demand (HTTP 503). Your message is preserved—please try again shortly.`,
    };
  }

  // Transient 5xx errors
  if (
    status === 500 ||
    status === 502 ||
    lower.includes('internal error') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('bad gateway')
  ) {
    return {
      category: 'TRANSIENT_SERVER_ERROR',
      httpStatus: 502,
      retryable: true,
      retryAfterMs,
      rawCode: code || undefined,
      userMessage: `${provider} returned a temporary server error. Please try again.`,
    };
  }

  // Network connectivity failures
  const networkCodes = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
  ]);
  if (
    (code && networkCodes.has(code)) ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('socket hang up') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  ) {
    return {
      category: 'NETWORK_ERROR',
      httpStatus: 503,
      retryable: true,
      retryAfterMs: null,
      rawCode: code || undefined,
      userMessage: `Network connection to ${provider} was interrupted. Please check connectivity and retry.`,
    };
  }

  if (status === 400) {
    return {
      category: 'BAD_REQUEST',
      httpStatus: 400,
      retryable: false,
      retryAfterMs: null,
      rawCode: code || undefined,
      userMessage: `${provider} could not process this request (${sanitizeTextForLog(message).slice(0, 180)}).`,
    };
  }

  return {
    category: 'UNKNOWN',
    httpStatus: status && status >= 400 && status < 600 ? status : 502,
    retryable: false,
    retryAfterMs: null,
    rawCode: code || undefined,
    userMessage: `${provider} request failed: ${sanitizeTextForLog(message).slice(0, 200)}`,
  };
}

export function computeBackoffDelayMs(params: {
  attempt: number; // 1-based retry attempt (1, 2, 3)
  retryAfterMs?: number | null;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}): number {
  const {
    attempt,
    retryAfterMs = null,
    baseDelayMs = DEFAULT_AI_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_AI_MAX_DELAY_MS,
    random = Math.random,
  } = params;

  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)));
  // Full/bounded jitter around exponential delay (0.75x - 1.25x)
  const jitterFactor = 0.75 + random() * 0.5;
  const jittered = Math.min(maxDelayMs, Math.max(Math.round(baseDelayMs * 0.5), Math.round(exponential * jitterFactor)));

  if (retryAfterMs !== null && retryAfterMs > 0) {
    const smallJitter = Math.round(random() * Math.min(250, Math.round(baseDelayMs * 0.25)));
    return Math.max(retryAfterMs + smallJitter, jittered);
  }

  return jittered;
}

export function sanitizeAiErrorForLog(
  err: unknown,
  meta: {
    provider: string;
    model: string;
    attempt: number;
    maxRetries: number;
    category: AiErrorCategory;
    statusCode: number;
    retryable: boolean;
    delayMs?: number;
    retryAfterMs?: number | null;
  }
): Record<string, unknown> {
  const { message, code } = extractStatusAndDetails(err);
  return {
    provider: meta.provider,
    model: meta.model,
    attempt: meta.attempt,
    maxRetries: meta.maxRetries,
    category: meta.category,
    statusCode: meta.statusCode,
    retryable: meta.retryable,
    ...(meta.retryAfterMs !== undefined && meta.retryAfterMs !== null
      ? { retryAfterMs: meta.retryAfterMs }
      : {}),
    ...(meta.delayMs !== undefined ? { delayMs: meta.delayMs } : {}),
    ...(code ? { code } : {}),
    message: sanitizeTextForLog(message).slice(0, 300),
  };
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError('Request cancelled.', 499));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new AppError('Request cancelled.', 499));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function buildFriendlyRetryMessage(
  providerLabel: string,
  category: AiErrorCategory,
  nextAttempt: number,
  maxRetries: number
): string {
  if (category === 'RATE_LIMIT') {
    return `${providerLabel} rate limit reached. Retrying (${nextAttempt}/${maxRetries})...`;
  }
  if (category === 'NETWORK_ERROR') {
    return `Connection to ${providerLabel} interrupted. Retrying (${nextAttempt}/${maxRetries})...`;
  }
  return `${providerLabel} is temporarily busy. Retrying (${nextAttempt}/${maxRetries})...`;
}

export async function executeWithAiRetry<T>(params: {
  providerLabel: string;
  models: string[];
  maxRetries?: number;
  totalBudgetMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  abortSignal?: AbortSignal;
  onRetry?: (info: AiRetryAttemptInfo) => void;
  onFallbackModel?: (info: AiFallbackInfo) => void;
  logError?: (payload: Record<string, unknown>) => void;
  runAttempt: (model: string, remainingBudgetMs: number) => Promise<T>;
}): Promise<{ result: T; modelUsed: string; attemptsTotal: number }> {
  const {
    providerLabel,
    models,
    maxRetries = MAX_AI_RETRY_ATTEMPTS,
    totalBudgetMs = DEFAULT_AI_REQUEST_BUDGET_MS,
    baseDelayMs = DEFAULT_AI_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_AI_MAX_DELAY_MS,
    random = Math.random,
    abortSignal,
    onRetry,
    onFallbackModel,
    logError = (payload) => console.warn('[AI Provider Retry]', JSON.stringify(payload)),
    runAttempt,
  } = params;

  const uniqueModels = Array.from(new Set(models.filter(Boolean)));
  const startedAt = Date.now();
  let attemptsTotal = 0;
  let lastClassified: ClassifiedAiError | null = null;

  for (let modelIdx = 0; modelIdx < uniqueModels.length; modelIdx++) {
    const model = uniqueModels[modelIdx];
    const hasNextModel = modelIdx < uniqueModels.length - 1;

    for (let retryIdx = 0; retryIdx <= maxRetries; retryIdx++) {
      if (abortSignal?.aborted) {
        throw new AppError(`Request was cancelled before ${providerLabel} responded.`, 499);
      }

      const elapsed = Date.now() - startedAt;
      const remainingBudgetMs = totalBudgetMs - elapsed;
      if (remainingBudgetMs <= 500) {
        throw new AppError(
          lastClassified?.userMessage ||
            `${providerLabel} timed out across retry attempts. Please try again.`,
          lastClassified?.httpStatus || 504
        );
      }

      attemptsTotal += 1;
      try {
        const result = await runAttempt(model, remainingBudgetMs);
        return { result, modelUsed: model, attemptsTotal };
      } catch (err: unknown) {
        const externalAborted = Boolean(abortSignal?.aborted);
        const didTimeout =
          !externalAborted &&
          err instanceof Error &&
          err.message === 'AI_UPSTREAM_TIMEOUT';

        const classified = classifyAiError(err, {
          providerLabel,
          didTimeout,
          externalAborted,
        });
        lastClassified = classified;

        const canRetrySameModel = classified.retryable && retryIdx < maxRetries;
        const remainingAfterAttempt = totalBudgetMs - (Date.now() - startedAt);
        const computedDelayMs = canRetrySameModel
          ? computeBackoffDelayMs({
              attempt: retryIdx + 1,
              retryAfterMs: classified.retryAfterMs,
              baseDelayMs,
              maxDelayMs,
              random,
            })
          : 0;

        logError(
          sanitizeAiErrorForLog(err, {
            provider: providerLabel.toLowerCase(),
            model,
            attempt: retryIdx + 1,
            maxRetries: maxRetries + 1,
            category: classified.category,
            statusCode: classified.httpStatus,
            retryable: classified.retryable,
            retryAfterMs: classified.retryAfterMs,
            ...(canRetrySameModel ? { delayMs: computedDelayMs } : {}),
          })
        );

        // Permanent errors must fail immediately without retrying or falling back
        if (!classified.retryable) {
          throw new AppError(classified.userMessage, classified.httpStatus);
        }

        if (canRetrySameModel) {
          // If Retry-After exceeds our remaining budget, fail cleanly (or try fallback if configured)
          if (
            classified.retryAfterMs !== null &&
            classified.retryAfterMs >= remainingAfterAttempt - 500
          ) {
            if (hasNextModel && remainingAfterAttempt > 1500) {
              break;
            }
            const waitSecs = Math.ceil(classified.retryAfterMs / 1000);
            throw new AppError(
              `${providerLabel} asked to wait ${waitSecs}s before retrying. Please try again in a moment.`,
              classified.httpStatus
            );
          }

          const cappedDelayMs = Math.min(computedDelayMs, Math.max(0, remainingAfterAttempt - 1000));
          if (cappedDelayMs <= 0) {
            break;
          }

          onRetry?.({
            attempt: retryIdx + 1,
            maxRetries,
            model,
            category: classified.category,
            statusCode: classified.httpStatus,
            delayMs: cappedDelayMs,
            retryAfterMs: classified.retryAfterMs,
            friendlyMessage: buildFriendlyRetryMessage(
              providerLabel,
              classified.category,
              retryIdx + 1,
              maxRetries
            ),
          });

          await sleepWithAbort(cappedDelayMs, abortSignal);
          continue;
        }

        // Retries exhausted on this model
        break;
      }
    }

    if (hasNextModel) {
      const remaining = totalBudgetMs - (Date.now() - startedAt);
      if (remaining > 1500) {
        onFallbackModel?.({
          fromModel: model,
          toModel: uniqueModels[modelIdx + 1],
          reasonCategory: lastClassified?.category || 'SERVICE_UNAVAILABLE',
        });
        continue;
      }
    }
  }

  throw new AppError(
    lastClassified?.userMessage ||
      `${providerLabel} is temporarily unavailable after ${maxRetries} retry attempts. Please try again.`,
    lastClassified?.httpStatus || 503
  );
}
