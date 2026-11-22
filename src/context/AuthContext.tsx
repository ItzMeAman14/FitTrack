import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { api, ApiError, setSessionToken, subscribeUnauthorized } from '../services/api';
import type { AuthUser } from '../types/fittrack';

interface AuthContextValue {
  user: AuthUser | null;
  setUser: Dispatch<SetStateAction<AuthUser | null>>;
  isInitialized: boolean;
  canRegisterOrActivate: boolean;
  hasInvitedAccounts: boolean;
  allowPublicSignup: boolean;
  databaseConfigured: boolean;
  setupHint: string | null;
  loading: boolean;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  register: (payload: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitialized, setIsInitialized] = useState(true);
  const [canRegisterOrActivate, setCanRegisterOrActivate] = useState(true);
  const [hasInvitedAccounts, setHasInvitedAccounts] = useState(false);
  const [allowPublicSignup, setAllowPublicSignup] = useState(false);
  const [databaseConfigured, setDatabaseConfigured] = useState(true);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const refreshAuth = useCallback(() => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const promise = (async () => {
      setLoading(true);
      try {
        const statusRes = await api.get<{
          isInitialized: boolean;
          canRegisterOrActivate?: boolean;
          hasInvitedAccounts?: boolean;
          allowPublicSignup?: boolean;
          databaseConfigured?: boolean;
          setupHint?: string | null;
        }>('/auth/setup-status');
        const dbConfigured = statusRes.data.databaseConfigured !== false;
        setDatabaseConfigured(dbConfigured);
        setSetupHint(statusRes.data.setupHint ?? null);
        setIsInitialized(statusRes.data.isInitialized);
        setCanRegisterOrActivate(
          statusRes.data.canRegisterOrActivate ?? !statusRes.data.isInitialized
        );
        setHasInvitedAccounts(Boolean(statusRes.data.hasInvitedAccounts));
        setAllowPublicSignup(Boolean(statusRes.data.allowPublicSignup));

        if (!dbConfigured || !statusRes.data.isInitialized) {
          setSessionToken(null);
          setUser(null);
          return;
        }

        try {
          const meRes = await api.get<{ user: AuthUser }>('/auth/me');
          setUser(meRes.data.user);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            setSessionToken(null);
            setUser(null);
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 503) {
          setDatabaseConfigured(false);
          setSetupHint(err.message);
          setIsInitialized(false);
          setCanRegisterOrActivate(true);
        }
      } finally {
        setLoading(false);
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    return subscribeUnauthorized(() => {
      setSessionToken(null);
      setUser(null);
    });
  }, []);

  const login = async (credentials: { email: string; password: string }) => {
    const res = await api.post<{ user: AuthUser; sessionToken?: string }>(
      '/auth/login',
      credentials
    );
    if (res.data.sessionToken) {
      setSessionToken(res.data.sessionToken);
    }
    setUser(res.data.user);
    setDatabaseConfigured(true);
    setSetupHint(null);
    setIsInitialized(true);
  };

  const register = async (payload: { name: string; email: string; password: string }) => {
    const res = await api.post<{ user: AuthUser; sessionToken?: string }>(
      '/auth/register',
      payload
    );
    if (res.data.sessionToken) {
      setSessionToken(res.data.sessionToken);
    }
    setUser(res.data.user);
    setDatabaseConfigured(true);
    setSetupHint(null);
    setIsInitialized(true);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSessionToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        isInitialized,
        canRegisterOrActivate,
        hasInvitedAccounts,
        allowPublicSignup,
        databaseConfigured,
        setupHint,
        loading,
        login,
        register,
        logout,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
