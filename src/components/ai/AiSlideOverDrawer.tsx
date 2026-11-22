import { useEffect } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { AiCoachWorkspace } from '../../features/ai/AiCoachWorkspace';

export function AiSlideOverDrawer() {
  const { aiDrawerOpen, closeAiDrawer } = useWorkspace();

  useEffect(() => {
    if (!aiDrawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAiDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aiDrawerOpen, closeAiDrawer]);

  if (!aiDrawerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs"
        onClick={closeAiDrawer}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="FitTrack AI Coach"
        className="relative z-10 flex h-full w-full sm:w-[460px] md:w-[520px] flex-col border-l border-[#252D38] bg-[#121720] shadow-2xl"
      >
        <AiCoachWorkspace variant="drawer" onCloseDrawer={closeAiDrawer} />
      </aside>
    </div>
  );
}
