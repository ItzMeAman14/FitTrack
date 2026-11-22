import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  commitUserImport,
  exportUserData,
  getDocumentedJsonSchema,
  previewUserImport,
} from '../services/dataPortabilityService.js';
import { asyncHandler } from '../utils/error.js';

const router = Router();
router.use(requireAuth);

const scopeEnum = z.enum(['DIET', 'WORKOUT', 'MEASUREMENTS', 'FULL_BACKUP']);
const modeEnum = z.enum(['MERGE', 'REPLACE']).default('MERGE');

const importRequestSchema = z.object({
  importType: scopeEnum,
  mode: modeEnum,
  payload: z.unknown(),
});

router.get(
  '/schema',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: getDocumentedJsonSchema() });
  })
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const scope = scopeEnum.parse(
      typeof req.query.scope === 'string' ? req.query.scope.toUpperCase() : 'FULL_BACKUP'
    );
    const data = await exportUserData(
      req.user!.id,
      { id: req.user!.id, name: req.user!.name, email: req.user!.email },
      scope
    );
    res.json({ success: true, data });
  })
);

router.post(
  '/import/preview',
  asyncHandler(async (req, res) => {
    const parsed = importRequestSchema.parse(req.body);
    const preview = await previewUserImport(req.user!.id, {
      importType: parsed.importType,
      mode: parsed.mode,
      payload: parsed.payload,
    });
    res.json({ success: true, data: preview });
  })
);

router.post(
  '/import/commit',
  asyncHandler(async (req, res) => {
    const parsed = importRequestSchema.parse(req.body);
    const summary = await commitUserImport(req.user!.id, {
      importType: parsed.importType,
      mode: parsed.mode,
      payload: parsed.payload,
    });
    res.status(201).json({
      success: true,
      message: 'Data imported successfully.',
      data: summary,
    });
  })
);

export default router;
