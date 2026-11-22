import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { AuthPage } from './features/auth/AuthPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { NutritionHubPage } from './features/diet/NutritionHubPage';
import { TrainingHubPage } from './features/workouts/TrainingHubPage';
import { ProgressHubPage } from './features/progress/ProgressHubPage';
import { AccountHubPage } from './features/profile/AccountHubPage';
import { AiAssistantPage } from './features/ai/AiAssistantPage';
import { LoadingSpinner } from './components/ui/LoadingSpinner';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090B0F] flex items-center justify-center">
        <LoadingSpinner label="Authenticating FitTrack..." />
      </div>
    );
  }

  return user ? (
    <>{children}</>
  ) : (
    <Navigate to="/auth" state={{ from: location.pathname + location.search }} replace />
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090B0F] flex items-center justify-center">
        <LoadingSpinner label="Checking FitTrack session..." />
      </div>
    );
  }

  return user ? <Navigate to={from} replace /> : <AuthPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthRoute />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        {/* 5 Consolidated Core Hubs + Full AI Coach View */}
        <Route path="/" element={<DashboardPage />} />
        <Route path="/nutrition" element={<NutritionHubPage />} />
        <Route path="/training" element={<TrainingHubPage />} />
        <Route path="/progress" element={<ProgressHubPage />} />
        <Route path="/account" element={<AccountHubPage />} />
        <Route path="/ai" element={<AiAssistantPage />} />

        {/* Backward-compatible redirects for bookmarks & legacy routes */}
        <Route path="/diet" element={<Navigate to="/nutrition?tab=daily" replace />} />
        <Route path="/foods" element={<Navigate to="/nutrition?tab=foods" replace />} />
        <Route path="/workouts" element={<Navigate to="/training?tab=split" replace />} />
        <Route path="/exercises" element={<Navigate to="/training?tab=exercises" replace />} />
        <Route path="/saved-plans" element={<Navigate to="/nutrition?tab=templates" replace />} />
        <Route path="/measurements" element={<Navigate to="/progress" replace />} />
        <Route path="/analytics" element={<Navigate to="/progress" replace />} />
        <Route path="/profile" element={<Navigate to="/account" replace />} />
        <Route path="/settings" element={<Navigate to="/account" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
