import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Sparkles,
  User,
  Utensils,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useWorkspace } from '../context/WorkspaceContext';

const PRIMARY_HUBS = [
  { to: '/', label: 'Today', icon: LayoutDashboard, end: true },
  { to: '/nutrition', label: 'Nutrition', icon: Utensils, end: false },
  { to: '/training', label: 'Training', icon: Dumbbell, end: false },
  { to: '/progress', label: 'Progress', icon: BarChart3, end: false },
  { to: '/account', label: 'Account', icon: User, end: false },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const { openAiDrawer } = useWorkspace();

  const handleLogout = async () => {
    try {
      await logout();
      showToast('Signed out of FitTrack.', 'info');
    } catch {
      showToast('Failed to log out.', 'error');
    }
  };

  const initials = (user?.name || 'FT')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside
      className={`hidden lg:flex fixed inset-y-0 left-0 z-30 flex-col bg-[#0D1016] border-r border-[#252D38] transition-all duration-200 ${
        collapsed ? 'w-[72px]' : 'w-[232px]'
      }`}
    >
      <div className="flex h-14 items-center justify-between px-4 border-b border-[#202733]">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#26351D] border border-[#B6F36A]/30 text-[#B6F36A]">
            <Activity className="h-4 w-4" />
          </div>
          {!collapsed && (
            <span className="font-display text-base font-bold tracking-tight text-[#F5F7FA] whitespace-nowrap">
              FitTrack
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-lg p-1.5 text-[#626C7B] hover:bg-[#171E29] hover:text-[#F5F7FA] transition-colors cursor-pointer"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1">
        {PRIMARY_HUBS.map((hub) => {
          const Icon = hub.icon;
          return (
            <NavLink
              key={hub.to}
              to={hub.to}
              end={hub.end}
              title={collapsed ? hub.label : undefined}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#26351D] text-[#B6F36A] border border-[#B6F36A]/25'
                    : 'text-[#929BAA] hover:bg-[#171E29] hover:text-[#F5F7FA] border border-transparent'
                } ${collapsed ? 'justify-center px-2' : ''}`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{hub.label}</span>}
            </NavLink>
          );
        })}

        <div className="pt-3 mt-3 border-t border-[#202733]">
          <button
            type="button"
            onClick={openAiDrawer}
            title={collapsed ? 'Open AI Coach Drawer' : undefined}
            className={`flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm font-medium text-[#929BAA] hover:bg-[#171E29] hover:text-[#B6F36A] transition-colors whitespace-nowrap cursor-pointer ${
              collapsed ? 'justify-center px-2' : ''
            }`}
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#B6F36A]" />
            {!collapsed && <span className="truncate">AI Coach</span>}
          </button>
        </div>
      </nav>

      <div className="border-t border-[#202733] p-2.5">
        <div
          className={`flex items-center gap-2.5 rounded-[10px] bg-[#121720] border border-[#252D38] p-2 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#26351D] text-xs font-semibold text-[#B6F36A]">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[#F5F7FA]">{user?.name}</p>
              <p className="truncate text-[11px] text-[#626C7B]">{user?.email}</p>
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={handleLogout}
              title="Log out"
              className="rounded-md p-1.5 text-[#626C7B] hover:bg-[#171E29] hover:text-[#F16C75] transition-colors cursor-pointer"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            type="button"
            onClick={handleLogout}
            title="Log out"
            className="mt-2 flex w-full items-center justify-center rounded-[9px] p-2 text-[#626C7B] hover:bg-[#171E29] hover:text-[#F16C75] transition-colors cursor-pointer"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
