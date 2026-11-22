import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type QuickLogKind = 'meal' | 'measurement' | null;
export type WorkspaceDomain = 'diet' | 'workout' | 'measurements' | 'profile' | 'ai' | 'all';

interface WorkspaceContextValue {
  dataVersion: number;
  lastUpdatedDomain: WorkspaceDomain;
  bumpDataVersion: (domain?: WorkspaceDomain) => void;
  quickLogModal: QuickLogKind;
  openQuickLog: (kind: Exclude<QuickLogKind, null>) => void;
  closeQuickLog: () => void;
  aiDrawerOpen: boolean;
  openAiDrawer: () => void;
  closeAiDrawer: () => void;
  toggleAiDrawer: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [dataVersion, setDataVersion] = useState(0);
  const [lastUpdatedDomain, setLastUpdatedDomain] = useState<WorkspaceDomain>('all');
  const [quickLogModal, setQuickLogModal] = useState<QuickLogKind>(null);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);

  const bumpDataVersion = useCallback((domain: WorkspaceDomain = 'all') => {
    setLastUpdatedDomain(domain);
    setDataVersion((v) => v + 1);
  }, []);

  const openQuickLog = useCallback((kind: Exclude<QuickLogKind, null>) => {
    setQuickLogModal(kind);
  }, []);

  const closeQuickLog = useCallback(() => {
    setQuickLogModal(null);
  }, []);

  const openAiDrawer = useCallback(() => setAiDrawerOpen(true), []);
  const closeAiDrawer = useCallback(() => setAiDrawerOpen(false), []);
  const toggleAiDrawer = useCallback(() => setAiDrawerOpen((v) => !v), []);

  return (
    <WorkspaceContext.Provider
      value={{
        dataVersion,
        lastUpdatedDomain,
        bumpDataVersion,
        quickLogModal,
        openQuickLog,
        closeQuickLog,
        aiDrawerOpen,
        openAiDrawer,
        closeAiDrawer,
        toggleAiDrawer,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider');
  }
  return ctx;
}
