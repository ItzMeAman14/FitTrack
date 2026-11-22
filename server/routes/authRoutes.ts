import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import {
  ensureDatabaseSchemaReady,
  isDatabaseConfigured,
  prisma,
  toApiProfile,
  toApiUser,
  withTransaction,
} from '../db.js';
import {
  clearSessionCookie,
  extractSessionToken,
  requireAuth,
  sanitizeUser,
  SESSION_TTL_DAYS,
  setSessionCookie,
} from '../middleware/auth.js';
import {
  ensureSeededAccounts,
  isEmailSeeded,
  isUnclaimedPasswordHash,
  seedStarterWorkspaceForUser,
  UNCLAIMED_PASSWORD_SENTINEL,
} from '../seed.js';
import {
  generateId,
  generateToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from '../utils/crypto.js';
import { AppError, asyncHandler } from '../utils/error.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Please enter a valid email address').toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be under 128 characters'),
});

const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

router.get(
  '/setup-status',
  asyncHandler(async (_req, res) => {
    if (!isDatabaseConfigured()) {
      res.json({
        success: true,
        data: {
          isInitialized: false,
          databaseConfigured: false,
          canRegisterOrActivate: true,
          hasInvitedAccounts: false,
          allowPublicSignup: false,
          setupHint:
            'Neon PostgreSQL is not configured yet. Set DATABASE_URL in AI Studio Secrets, .env, or Vercel Environment Variables.',
        },
      });
      return;
    }

    try {
      await ensureDatabaseSchemaReady();
      await ensureSeededAccounts();

      const [claimedCount, unclaimedCount] = await Promise.all([
        prisma.user.count({
          where: { passwordHash: { notIn: [UNCLAIMED_PASSWORD_SENTINEL, ''] } },
        }),
        prisma.user.count({
          where: { passwordHash: { in: [UNCLAIMED_PASSWORD_SENTINEL, ''] } },
        }),
      ]);

      const isInitialized = claimedCount > 0;
      const allowPublicSignup = process.env.ALLOW_PUBLIC_SIGNUP === 'true';
      const hasInvitedAccounts = unclaimedCount > 0;
      const canRegisterOrActivate = !isInitialized || hasInvitedAccounts || allowPublicSignup;

      res.json({
        success: true,
        data: {
          isInitialized,
          databaseConfigured: true,
          canRegisterOrActivate,
          hasInvitedAccounts,
          allowPublicSignup,
          setupHint: null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2021'
      ) {
        res.json({
          success: true,
          data: {
            isInitialized: false,
            databaseConfigured: false,
            canRegisterOrActivate: true,
            hasInvitedAccounts: false,
            allowPublicSignup: false,
            setupHint:
              'Database schema is not initialized yet. Run `npx prisma migrate deploy` against your Neon PostgreSQL database.',
          },
        });
        return;
      }
      if (err instanceof Prisma.PrismaClientInitializationError) {
        res.json({
          success: true,
          data: {
            isInitialized: false,
            databaseConfigured: false,
            canRegisterOrActivate: true,
            hasInvitedAccounts: false,
            allowPublicSignup: false,
            setupHint:
              'Unable to reach PostgreSQL database. Verify DATABASE_URL and Neon database availability.',
          },
        });
        return;
      }
      throw err;
    }
  })
);

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.parse(req.body);
    await ensureDatabaseSchemaReady();
    await ensureSeededAccounts();

    const now = new Date();
    const passwordHash = hashPassword(parsed.password);
    const rawToken = generateToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const allowPublicSignup = process.env.ALLOW_PUBLIC_SIGNUP === 'true';

    const { sanitized, wasClaimed } = await withTransaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: parsed.email, mode: 'insensitive' } },
        include: { profile: true },
      });

      // Case 1 & 2: Email already exists (either claimed or pre-seeded / Neon-inserted unclaimed)
      if (existingUser) {
        if (!isUnclaimedPasswordHash(existingUser.passwordHash)) {
          throw new AppError(
            'This email is already active. Please sign in with your password.',
            409
          );
        }

        const updated = await tx.user.updateMany({
          where: {
            id: existingUser.id,
            passwordHash: { in: [UNCLAIMED_PASSWORD_SENTINEL, ''] },
          },
          data: {
            name: parsed.name,
            email: parsed.email,
            passwordHash,
            updatedAt: now,
          },
        });
        if (updated.count === 0) {
          throw new AppError(
            'This account has already been activated. Please sign in with your password.',
            409
          );
        }

        const profileRow = await seedStarterWorkspaceForUser(tx, existingUser.id, now);

        await tx.session.create({
          data: {
            id: generateId('ses'),
            userId: existingUser.id,
            tokenHash,
            userAgent: req.get('user-agent') || null,
            ipAddress: req.ip || null,
            expiresAt,
            createdAt: now,
          },
        });

        const freshUser = await tx.user.findUniqueOrThrow({
          where: { id: existingUser.id },
        });

        return {
          wasClaimed: true,
          sanitized: sanitizeUser(toApiUser(freshUser), toApiProfile(profileRow)),
        };
      }

      // Case 3: New email not yet in `users`
      const claimedCount = await tx.user.count({
        where: { passwordHash: { notIn: [UNCLAIMED_PASSWORD_SENTINEL, ''] } },
      });
      const invited = isEmailSeeded(parsed.email) || allowPublicSignup;

      if (claimedCount > 0 && !invited) {
        throw new AppError(
          'This email is not on the seeded friends & family list. Add it to SEEDED_ACCOUNTS in server/seed.ts or SEEDED_EMAILS.',
          403
        );
      }

      const userId = generateId('usr');
      const createdUser = await tx.user.create({
        data: {
          id: userId,
          name: parsed.name,
          email: parsed.email,
          passwordHash,
          avatarUrl: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const createdProfile = await seedStarterWorkspaceForUser(tx, userId, now);

      await tx.session.create({
        data: {
          id: generateId('ses'),
          userId,
          tokenHash,
          userAgent: req.get('user-agent') || null,
          ipAddress: req.ip || null,
          expiresAt,
          createdAt: now,
        },
      });

      return {
        wasClaimed: false,
        sanitized: sanitizeUser(toApiUser(createdUser), toApiProfile(createdProfile)),
      };
    });

    setSessionCookie(req, res, rawToken, expiresAt);
    res.status(wasClaimed ? 200 : 201).json({
      success: true,
      message: wasClaimed
        ? 'Invited FitTrack account activated.'
        : 'Personal FitTrack account initialized.',
      data: { user: sanitized, sessionToken: rawToken },
    });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.parse(req.body);
    await ensureDatabaseSchemaReady();
    await ensureSeededAccounts();

    const userRecord = await prisma.user.findFirst({
      where: { email: { equals: parsed.email, mode: 'insensitive' } },
      include: { profile: true },
    });

    if (userRecord && isUnclaimedPasswordHash(userRecord.passwordHash)) {
      throw new AppError(
        'This seeded email has not been activated yet. Choose your name and password below to activate it.',
        403,
        { code: 'ACCOUNT_UNCLAIMED' }
      );
    }

    if (!userRecord || !verifyPassword(parsed.password, userRecord.passwordHash)) {
      throw new AppError('Invalid email or password.', 401);
    }

    const rawToken = generateToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();

    await withTransaction(async (tx) => {
      await tx.session.deleteMany({
        where: { expiresAt: { lt: now } },
      });
      await tx.session.create({
        data: {
          id: generateId('ses'),
          userId: userRecord.id,
          tokenHash,
          userAgent: req.get('user-agent') || null,
          ipAddress: req.ip || null,
          expiresAt,
          createdAt: now,
        },
      });
    });

    setSessionCookie(req, res, rawToken, expiresAt);

    res.json({
      success: true,
      message: 'Signed in successfully.',
      data: {
        user: sanitizeUser(toApiUser(userRecord), toApiProfile(userRecord.profile)),
        sessionToken: rawToken,
      },
    });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const rawToken = extractSessionToken(req);
    if (rawToken && isDatabaseConfigured()) {
      const tokenHash = hashSessionToken(rawToken);
      await prisma.session.deleteMany({ where: { tokenHash } });
    }
    clearSessionCookie(req, res);
    res.json({ success: true, message: 'Logged out successfully.' });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: { user: req.user },
    });
  })
);

export default router;
