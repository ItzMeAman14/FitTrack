import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Dumbbell, Plus, Ruler, Sparkles, Utensils } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { Button } from '../components/ui/Button';

const HUB_TITLES: Record<string, string> = {
  '/': 'Today',
  '/nutrition': 'Nutrition',
  '/training': 'Training',
  '/progress': 'Progress',
  '/account': 'Account',
  '/ai': 'FitTrack AI Coach',
};

export function TopBar() {
  const { user } = useAuth();
  const { openQuickLog, openAiDrawer } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const hubTitle = HUB_TITLES[location.pathname] || 'FitTrack';

  const timezone = user?.profile?.timezone || 'Asia/Kolkata';
  let todayLabel = '';
  try {
    todayLabel = new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date());
  } catch {
    todayLabel = new Date().toDateString();
  }

  return (
    <header className="sticky top-0 z-20 flex h-12 lg:h-14 items-center justify-between gap-4 border-b border-[#202733] bg-[#090B0F]/95 backdrop-blur px-4 sm:px-6">
      <div className="flex items-center gap-2.5 min-w-0">
        <Link
          to="/"
          className="lg:hidden flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[#26351D] text-[#B6F36A]"
          aria-label="FitTrack Today"
        >
          <Activity className="h-4 w-4" />
        </Link>
        <h1 className="truncate font-display text-sm sm:text-base font-semibold text-[#F5F7FA]">
          {hubTitle}
        </h1>
        <span className="hidden md:inline text-xs text-[#626C7B]" aria-hidden="true">
          ·
        </span>
        <span className="hidden md:inline font-mono text-xs text-[#929BAA] tabular-nums whitespace-nowrap">
          {todayLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative">
          <Button
            size="sm"
            onClick={() => setQuickAddOpen((v) => !v)}
            className="h-8 sm:h-9 px-3"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Quick Log</span>
          </Button>

          {quickAddOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setQuickAddOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 mt-2 w-56 z-20 rounded-[12px] border border-[#252D38] bg-[#121720] p-1.5 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setQuickAddOpen(false);
                    openQuickLog('meal');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-xs text-[#F5F7FA] hover:bg-[#171E29] transition-colors cursor-pointer"
                >
                  <Utensils className="h-3.5 w-3.5 text-[#F3B84B]" />
                  <span>Quick Log Meal</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuickAddOpen(false);
                    openQuickLog('measurement');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-xs text-[#F5F7FA] hover:bg-[#171E29] transition-colors cursor-pointer"
                >
                  <Ruler className="h-3.5 w-3.5 text-[#39C9BA]" />
                  <span>Log Body Check-In</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuickAddOpen(false);
                    navigate('/training?tab=split&autostart=1');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-xs text-[#F5F7FA] hover:bg-[#171E29] transition-colors cursor-pointer"
                >
                  <Dumbbell className="h-3.5 w-3.5 text-[#62A8F7]" />
                  <span>Start Today&apos;s Workout</span>
                </button>
                <div className="my-1 border-t border-[#202733]" />
                <button
                  type="button"
                  onClick={() => {
                    setQuickAddOpen(false);
                    openAiDrawer();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-xs text-[#B6F36A] hover:bg-[#171E29] transition-colors cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Ask FitTrack AI Coach</span>
                </button>
              </div>
            </>
          )}
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={openAiDrawer}
          className="h-8 sm:h-9 px-2.5 sm:px-3"
          aria-label="Open FitTrack AI Coach"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#B6F36A]" />
          <span className="hidden sm:inline">AI Coach</span>
        </Button>
      </div>
    </header>
  );
}
