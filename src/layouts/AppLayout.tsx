import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileBottomBar } from './MobileBottomBar';
import { QuickLogModals } from '../components/quicklog/QuickLogModals';
import { AiSlideOverDrawer } from '../components/ai/AiSlideOverDrawer';

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#090B0F] text-[#F5F7FA]">
      <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />

      <div
        className={`flex min-h-screen flex-col transition-all duration-200 ${
          collapsed ? 'lg:pl-[72px]' : 'lg:pl-[232px]'
        }`}
      >
        <TopBar />
        <main className="flex-1 p-4 sm:p-5 pb-20 lg:pb-6 max-w-[1440px] w-full mx-auto">
          <Outlet />
        </main>
      </div>

      <MobileBottomBar />
      <QuickLogModals />
      <AiSlideOverDrawer />
    </div>
  );
}
