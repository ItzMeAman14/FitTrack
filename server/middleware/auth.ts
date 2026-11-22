import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { ensureDatabaseSchemaReady, prisma, toApiProfile, toApiUser } from '../db.js';
import type { FitnessProfile, User } from '../types.js';
import { hashSessionToken } from '../utils/crypto.js';
import { AppError, asyncHandler } from '../utils/error.js';

export const SESSION_COOKIE_NAME = 'fittrack_session';
export const SESSION_TTL_DAYS = 14;

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
  profile: FitnessProfile | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionId?: string;
    }
  }
}

export function isHttpsRequest(req: Request): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  }
  return req.secure || req.protocol === 'https';
}

export function getSessionCookieOptions(req: Request, expiresAt?: Date): CookieOptions {
  const isHttps = isHttpsRequest(req);
  return {
    httpOnly: true,
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    ...(isHttps ? { partitioned: true } : {}),
    ...(expiresAt ? { expires: expiresAt } : {}),
  } as CookieOptions;
}

export function setSessionCookie(req: Request, res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(req, expiresAt));
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));
}

export function extractSessionToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (cookieToken && cookieToken.trim()) {
    return cookieToken.trim();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }

  return undefined;
}

export function sanitizeUser(user: User, profile: FitnessProfile | null): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    profile,
  };
}

export const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const rawToken = extractSessionToken(req);
  if (!rawToken) {
    throw new AppError('Authentication required.', 401);
  }

  await ensureDatabaseSchemaReady();
  const tokenHash = hashSessionToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          profile: true,
        },
      },
    },
  });

  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) {
      await prisma.session.deleteMany({ where: { id: session.id } });
    }
    clearSessionCookie(req, res);
    throw new AppError('Session expired. Please sign in again.', 401);
  }

  if (!session.user) {
    clearSessionCookie(req, res);
    throw new AppError('User account not found.', 401);
  }

  req.user = sanitizeUser(toApiUser(session.user), toApiProfile(session.user.profile));
  req.sessionId = session.id;
  next();
});
