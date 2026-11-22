export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status = 500, details: unknown = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const SESSION_TOKEN_KEY = 'fittrack_session_token';

let inMemorySessionToken: string | null = null;
let unauthorizedNotified = false;
const unauthorizedListeners = new Set<() => void>();

export function getSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  try {
    const stored = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (stored) {
      inMemorySessionToken = stored;
      return stored;
    }
  } catch {
    // Ignore storage access errors in restricted frames
  }
  return null;
}

export function setSessionToken(token: string | null) {
  inMemorySessionToken = token;
  if (token) {
    unauthorizedNotified = false;
  }
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore storage access errors in restricted frames
  }
}

export function subscribeUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorizedOnce() {
  if (unauthorizedNotified) return;
  unauthorizedNotified = true;
  for (const listener of unauthorizedListeners) {
    listener();
  }
}

const AUTH_EXEMPT_401_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/setup-status',
  '/auth/me',
  '/auth/logout',
]);

const API_BASE_ORIGIN = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_ORIGIN}/api${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  let json: { success?: boolean; message?: string; details?: unknown; data?: T } = {};
  try {
    json = await res.json();
  } catch {
    // non-JSON fallback
  }

  if (!res.ok) {
    const cleanPath = path.split('?')[0];
    if (res.status === 401 && !AUTH_EXEMPT_401_PATHS.has(cleanPath)) {
      setSessionToken(null);
      notifyUnauthorizedOnce();
    }

    const fallbackMsg =
      res.status === 403
        ? 'Access denied. You do not have permission for this action.'
        : `Request failed (${res.status})`;

    throw new ApiError(json.message || fallbackMsg, res.status, json.details);
  }

  return json as ApiResponse<T>;
}

export type AiProcessingStage =
  | 'analyzing_plans'
  | 'calling_model'
  | 'retrying'
  | 'fallback_model'
  | 'tool_calling'
  | 'generating'
  | 'preparing_updates'
  | 'saving';

export interface AiStageEvent {
  stage: AiProcessingStage;
  label: string;
}

export async function streamAiRequest<T>(
  path: string,
  body: unknown,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onStage?: (event: AiStageEvent) => void;
  } = {}
): Promise<T> {
  const { timeoutMs = 65_000, signal: externalSignal, onStage } = options;
  const controller = new AbortController();
  let timedOut = false;

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const token = getSessionToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE_ORIGIN}/api${path}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    if (!res.ok) {
      let json: { message?: string; details?: unknown } = {};
      try {
        json = await res.json();
      } catch {
        // ignore non-JSON
      }
      const cleanPath = path.split('?')[0];
      if (res.status === 401 && !AUTH_EXEMPT_401_PATHS.has(cleanPath)) {
        setSessionToken(null);
        notifyUnauthorizedOnce();
      }
      throw new ApiError(json.message || `Request failed (${res.status})`, res.status, json.details);
    }

    if (!res.body) {
      throw new ApiError('Streaming response is not supported by this browser.', 500);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completedData: T | undefined;
    let hasCompleted = false;

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: {
        type?: string;
        stage?: AiProcessingStage;
        label?: string;
        data?: T;
        message?: string;
        statusCode?: number;
      };
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (event.type === 'stage' && event.stage && event.label) {
        onStage?.({ stage: event.stage, label: event.label });
      } else if (event.type === 'error') {
        throw new ApiError(event.message || 'AI request failed.', event.statusCode || 500);
      } else if (event.type === 'complete') {
        completedData = event.data as T;
        hasCompleted = true;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    }

    if (buffer.trim()) {
      processLine(buffer);
    }

    if (!hasCompleted) {
      throw new ApiError(
        'The connection closed before FitTrack AI finished saving the response. Please retry.',
        502
      );
    }

    return completedData as T;
  } catch (err: unknown) {
    if (timedOut) {
      throw new ApiError(
        'Request timed out while waiting for Gemini. Please retry or try a shorter prompt.',
        504
      );
    }
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('Request was cancelled.', 499);
    }
    throw new ApiError(
      err instanceof Error
        ? `Network error while contacting FitTrack AI: ${err.message}`
        : 'Network error while contacting FitTrack AI.',
      0
    );
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
