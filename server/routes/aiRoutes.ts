import { Prisma } from '@prisma/client';
import { Router, type Response } from 'express';
import { z, ZodError } from 'zod';
import {
  assertDatabaseConfigured,
  prisma,
  toApiAiAuditLog,
  toApiAiMessage,
  withTransaction,
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getActiveAiProviderMetadata,
  validateCustomBaseUrl,
  type AiProviderName,
} from '../services/aiProvider.js';
import { sanitizeTextForLog } from '../services/aiRetry.js';
import {
  cancelAiProposal,
  chatWithFitTrackAi,
  confirmAiProposal,
} from '../services/aiService.js';
import { encryptSecret, generateId, maskApiKey } from '../utils/crypto.js';
import { AppError, asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_PROVIDERS = ['gemini', 'grok', 'openrouter', 'openai_compatible'] as const;

const createModelSchema = z.object({
  provider: z.enum(ALLOWED_PROVIDERS),
  modelName: z.string().trim().min(1, 'Model ID is required').max(120),
  apiKey: z.string().trim().min(8, 'API key appears too short').max(512),
  label: z.string().trim().max(80).optional(),
  baseUrl: z.string().trim().max(300).optional().nullable(),
  setAsActive: z.boolean().optional().default(true),
});

const selectModelSchema = z.object({
  modelId: z.string().trim().min(1, 'Model selection is required').max(128),
});

const chatSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(2000),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  modelId: z.string().trim().min(1).max(128).optional(),
});

function formatProviderName(provider: string): string {
  switch (provider) {
    case 'gemini':
      return 'Gemini';
    case 'grok':
      return 'Grok';
    case 'openrouter':
      return 'OpenRouter';
    case 'openai_compatible':
      return 'Custom';
    default:
      return 'AI';
  }
}

function toSafeUserAiModel(row: {
  id: string;
  label: string;
  provider: string;
  modelName: string;
  baseUrl: string | null;
  keyPreview: string;
  isDefault: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider as AiProviderName,
    modelName: row.modelName,
    baseUrl: row.baseUrl,
    keyPreview: row.keyPreview,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

function extractIdempotencyKey(req: { body?: unknown; get: (name: string) => string | undefined }): string | undefined {
  const bodyKey =
    req.body && typeof req.body === 'object'
      ? (req.body as Record<string, unknown>).idempotencyKey
      : undefined;
  const headerKey = req.get('idempotency-key');
  const candidate = typeof bodyKey === 'string' ? bodyKey : headerKey;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed && trimmed.length <= 128 ? trimmed : undefined;
}

function initNdjsonStream(res: Response) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function writeNdjsonEvent(res: Response, payload: Record<string, unknown>) {
  if (res.writableEnded) return;
  res.write(`${JSON.stringify(payload)}\n`);
}

function formatStreamError(err: unknown): { message: string; statusCode: number } {
  if (err instanceof AppError) {
    return { message: err.message, statusCode: err.statusCode };
  }
  if (err instanceof ZodError) {
    return {
      message: err.issues.map((i) => i.message).join(', ') || 'Validation failed.',
      statusCode: 400,
    };
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      message: 'Database service is unavailable. Verify DATABASE_URL and connectivity.',
      statusCode: 503,
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      message: 'Database operation failed while saving AI changes.',
      statusCode: 500,
    };
  }
  if (err instanceof Error) {
    return { message: err.message || 'AI request failed.', statusCode: 500 };
  }
  return { message: 'AI request failed.', statusCode: 500 };
}

router.get(
  '/provider',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: getActiveAiProviderMetadata() });
  })
);

router.get(
  '/models',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const builtIn = getActiveAiProviderMetadata();
    const rows = await prisma.userAiModel.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'asc' },
    });
    const customModels = rows.map(toSafeUserAiModel);
    const activeCustom = customModels.find((m) => m.isDefault);
    res.json({
      success: true,
      data: {
        builtIn,
        activeModelId: activeCustom ? activeCustom.id : 'BUILTIN',
        customModels,
      },
    });
  })
);

router.post(
  '/models',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const parsed = createModelSchema.parse(req.body);
    const userId = req.user!.id;

    let cleanBaseUrl: string | null = null;
    if (parsed.provider === 'openai_compatible') {
      if (!parsed.baseUrl?.trim()) {
        throw new AppError('Base URL is required for OpenAI-compatible endpoints.', 400);
      }
      cleanBaseUrl = validateCustomBaseUrl(parsed.baseUrl);
    } else if (parsed.baseUrl?.trim()) {
      cleanBaseUrl = validateCustomBaseUrl(parsed.baseUrl);
    }

    const encryptedApiKey = encryptSecret(parsed.apiKey);
    const keyPreview = maskApiKey(parsed.apiKey);
    const label =
      parsed.label?.trim() || `${formatProviderName(parsed.provider)} · ${parsed.modelName}`;

    const created = await withTransaction(async (tx) => {
      if (parsed.setAsActive) {
        await tx.userAiModel.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }
      return tx.userAiModel.create({
        data: {
          id: generateId('aimod'),
          userId,
          label,
          provider: parsed.provider,
          modelName: parsed.modelName,
          baseUrl: cleanBaseUrl,
          encryptedApiKey,
          keyPreview,
          isDefault: parsed.setAsActive,
        },
      });
    });

    res.status(201).json({
      success: true,
      message: 'Custom AI model saved and encrypted.',
      data: toSafeUserAiModel(created),
    });
  })
);

router.post(
  '/models/select',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const { modelId } = selectModelSchema.parse(req.body);
    const userId = req.user!.id;

    await withTransaction(async (tx) => {
      if (modelId === 'BUILTIN') {
        await tx.userAiModel.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
        return;
      }

      const target = await tx.userAiModel.findFirst({
        where: { id: modelId, userId },
      });
      if (!target) {
        throw new AppError('Custom AI model not found.', 404);
      }

      await tx.userAiModel.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
      await tx.userAiModel.update({
        where: { id: modelId },
        data: { isDefault: true },
      });
    });

    res.json({
      success: true,
      message: 'Active AI model updated.',
      data: { activeModelId: modelId },
    });
  })
);

router.delete(
  '/models/:id',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const userId = req.user!.id;
    const id = String(req.params.id);

    const existing = await prisma.userAiModel.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new AppError('Custom AI model not found.', 404);
    }

    await prisma.userAiModel.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Custom AI model removed.',
    });
  })
);

router.get(
  '/messages',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const messages = await prisma.aiMessage.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: messages.map(toApiAiMessage) });
  })
);

router.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const parsed = chatSchema.parse(req.body);
    const idempotencyKey = parsed.idempotencyKey || extractIdempotencyKey(req);
    const result = await chatWithFitTrackAi(req.user!.id, parsed.message, {
      idempotencyKey,
      modelId: parsed.modelId,
    });
    res.json({ success: true, data: result });
  })
);

router.post('/chat/stream', async (req, res) => {
  const parsedResult = chatSchema.safeParse(req.body);
  if (!parsedResult.success) {
    res.status(400).json({
      success: false,
      message: parsedResult.error.issues.map((i) => i.message).join(', ') || 'Invalid message.',
    });
    return;
  }

  const idempotencyKey = parsedResult.data.idempotencyKey || extractIdempotencyKey(req);
  initNdjsonStream(res);

  const abortController = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  res.on('close', onClose);

  try {
    const result = await chatWithFitTrackAi(req.user!.id, parsedResult.data.message, {
      abortSignal: abortController.signal,
      idempotencyKey,
      modelId: parsedResult.data.modelId,
      onStage: (event) => {
        writeNdjsonEvent(res, {
          type: 'stage',
          stage: event.stage,
          label: event.label,
        });
      },
    });

    if (!abortController.signal.aborted) {
      writeNdjsonEvent(res, {
        type: 'complete',
        data: result,
      });
    }
  } catch (err: unknown) {
    const { message, statusCode } = formatStreamError(err);
    const safeMessage = sanitizeTextForLog(message);
    if (statusCode >= 500 && !(err instanceof AppError && err.statusCode === 503)) {
      console.error(
        '[AI Stream Error]',
        JSON.stringify({ statusCode, message: safeMessage })
      );
    }
    if (!res.writableEnded) {
      writeNdjsonEvent(res, {
        type: 'error',
        statusCode,
        message: safeMessage,
      });
    }
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) {
      res.end();
    }
  }
});

router.post(
  '/proposals/:proposalId/confirm',
  asyncHandler(async (req, res) => {
    const result = await confirmAiProposal(
      req.user!.id,
      String(req.params.proposalId),
      req.body?.edits,
      { idempotencyKey: extractIdempotencyKey(req) }
    );
    res.json({ success: true, message: 'Confirmed and applied to FitTrack.', data: result });
  })
);

router.post('/proposals/:proposalId/confirm/stream', async (req, res) => {
  initNdjsonStream(res);

  try {
    const result = await confirmAiProposal(
      req.user!.id,
      String(req.params.proposalId),
      req.body?.edits,
      {
        idempotencyKey: extractIdempotencyKey(req),
        onStage: (event) => {
          writeNdjsonEvent(res, {
            type: 'stage',
            stage: event.stage,
            label: event.label,
          });
        },
      }
    );
    writeNdjsonEvent(res, {
      type: 'complete',
      message: 'Confirmed and applied to FitTrack.',
      data: result,
    });
  } catch (err: unknown) {
    const { message, statusCode } = formatStreamError(err);
    const safeMessage = sanitizeTextForLog(message);
    if (statusCode >= 500) {
      console.error(
        '[AI Confirm Stream Error]',
        JSON.stringify({ statusCode, message: safeMessage })
      );
    }
    if (!res.writableEnded) {
      writeNdjsonEvent(res, {
        type: 'error',
        statusCode,
        message: safeMessage,
      });
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

router.post(
  '/proposals/:proposalId/cancel',
  asyncHandler(async (req, res) => {
    const result = await cancelAiProposal(req.user!.id, String(req.params.proposalId));
    res.json({ success: true, message: 'Proposal cancelled without changes.', data: result });
  })
);

// Backward-compatible confirm route by messageId
router.post(
  '/confirm/:messageId',
  asyncHandler(async (req, res) => {
    const result = await confirmAiProposal(
      req.user!.id,
      String(req.params.messageId),
      req.body?.edits,
      { idempotencyKey: extractIdempotencyKey(req) }
    );
    res.json({ success: true, message: 'Action applied to FitTrack.', data: result });
  })
);

router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    assertDatabaseConfigured();
    const logs = await prisma.aiAuditLog.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: logs.map(toApiAiAuditLog) });
  })
);

router.delete(
  '/messages',
  asyncHandler(async (req, res) => {
    await withTransaction(async (tx) => {
      await tx.aiMessage.deleteMany({ where: { userId: req.user!.id } });
    });
    res.json({ success: true, message: 'Conversation cleared.' });
  })
);

export default router;
