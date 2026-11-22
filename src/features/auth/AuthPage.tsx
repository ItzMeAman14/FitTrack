import { useEffect, useState, type FormEvent } from 'react';
import { Activity, ShieldCheck } from 'lucide-react';
import { ApiError } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

export function AuthPage() {
  const {
    isInitialized,
    canRegisterOrActivate,
    allowPublicSignup,
    databaseConfigured,
    setupHint,
    login,
    register,
  } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<'login' | 'register'>(() =>
    isInitialized ? 'login' : 'register'
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [infoNotice, setInfoNotice] = useState('');

  useEffect(() => {
    if (!isInitialized) {
      setMode('register');
    } else if (!canRegisterOrActivate) {
      setMode('login');
    }
  }, [isInitialized, canRegisterOrActivate]);

  const isRegisterMode = mode === 'register' && canRegisterOrActivate;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    setInfoNotice('');

    if (!databaseConfigured) {
      setServerError(
        setupHint ||
          'DATABASE_URL is not configured. Set your Neon PostgreSQL connection string in environment variables and run `npx prisma migrate deploy`.'
      );
      return;
    }

    if (isRegisterMode && name.trim().length < 2) {
      setServerError('Name must be at least 2 characters.');
      return;
    }
    if (!email.includes('@')) {
      setServerError('Enter a valid email address.');
      return;
    }
    if (isRegisterMode && password.length < 8) {
      setServerError('Password must be at least 8 characters.');
      return;
    }
    if (!password) {
      setServerError('Password is required.');
      return;
    }

    setSubmitting(true);
    try {
      if (!isRegisterMode) {
        await login({ email: email.trim(), password });
        showToast('Welcome back to FitTrack.', 'success');
      } else {
        await register({ name: name.trim(), email: email.trim(), password });
        showToast(
          isInitialized
            ? 'FitTrack account activated and ready!'
            : 'Personal FitTrack account initialized.',
          'success'
        );
      }
    } catch (err: unknown) {
      if (
        err instanceof ApiError &&
        err.details &&
        typeof err.details === 'object' &&
        (err.details as { code?: string }).code === 'ACCOUNT_UNCLAIMED'
      ) {
        setMode('register');
        setPassword('');
        setInfoNotice(
          'Your seeded email is ready to activate. Enter your name and choose a password (8+ characters).'
        );
        return;
      }
      const message = err instanceof Error ? err.message : 'Authentication failed.';
      setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = serverError || (!databaseConfigured ? setupHint : '');

  const activateTabLabel = !isInitialized
    ? 'Initialize Account'
    : allowPublicSignup
      ? 'Create Account'
      : 'Activate Invited Email';

  return (
    <div className="min-h-screen bg-[#090B0F] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[12px] bg-[#26351D] border border-[#B6F36A]/30 text-[#B6F36A]">
            <Activity className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-bold text-[#F5F7FA]">FitTrack</h1>
          <p className="mt-1 text-xs text-[#626C7B]">Personal Fitness Operating System</p>
        </div>

        <Card>
          {canRegisterOrActivate && (
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-[10px] border border-[#252D38] bg-[#0D121A] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setServerError('');
                  setInfoNotice('');
                }}
                className={`rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  !isRegisterMode
                    ? 'bg-[#26351D] text-[#B6F36A]'
                    : 'text-[#929BAA] hover:text-[#F5F7FA]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setServerError('');
                  setInfoNotice('');
                }}
                className={`rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  isRegisterMode
                    ? 'bg-[#26351D] text-[#B6F36A]'
                    : 'text-[#929BAA] hover:text-[#F5F7FA]'
                }`}
              >
                {activateTabLabel}
              </button>
            </div>
          )}

          <div className="mb-5">
            <h2 className="font-display text-lg font-semibold text-[#F5F7FA]">
              {!isRegisterMode
                ? 'Sign in to your account'
                : isInitialized
                  ? allowPublicSignup
                    ? 'Create your FitTrack account'
                    : 'Activate your seeded account'
                  : 'Initialize Personal Account'}
            </h2>
            <p className="mt-1 text-xs text-[#929BAA]">
              {!isRegisterMode
                ? 'Access your private diet plan, workout split, measurements, and FitTrack AI.'
                : isInitialized
                  ? allowPublicSignup
                    ? 'Set up your isolated fitness workspace with starter foods and exercises.'
                    : 'Enter your invited email address and choose your own private password.'
                  : 'Set up your primary account (or activate a seeded email) to begin.'}
            </p>
          </div>

          {infoNotice && (
            <div className="mb-4 rounded-[9px] border border-[#B6F36A]/35 bg-[#26351D]/50 px-3.5 py-2.5 text-xs text-[#F5F7FA]">
              {infoNotice}
            </div>
          )}

          {displayError && (
            <div className="mb-4 rounded-[9px] border border-[#F16C75]/40 bg-[#F16C75]/10 px-3.5 py-2.5 text-xs text-[#F16C75]">
              {displayError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegisterMode && (
              <Input
                label="Full Name"
                placeholder="e.g. Aarav Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            )}

            <Input
              label="Email Address"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Input
              label="Password"
              type="password"
              placeholder={isRegisterMode ? 'Choose a password (min 8 characters)' : 'Your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting
                ? 'Please wait...'
                : !isRegisterMode
                  ? 'Sign In'
                  : isInitialized
                    ? allowPublicSignup
                      ? 'Create Account'
                      : 'Activate Account'
                    : 'Create Personal Account'}
            </Button>
          </form>

          <div className="mt-5 flex items-center gap-2 border-t border-[#202733] pt-4 text-[11px] text-[#626C7B]">
            <ShieldCheck className="h-4 w-4 text-[#36C98F] shrink-0" />
            <span>
              Each account keeps its own isolated data, protected with scrypt hashing and HTTP-only
              sessions.
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
