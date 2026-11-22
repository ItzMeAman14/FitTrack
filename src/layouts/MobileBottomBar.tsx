import { NavLink } from 'react-router-dom';
import { BarChart3, Dumbbell, LayoutDashboard, User, Utensils } from 'lucide-react';

const MOBILE_HUBS = [
  { to: '/', label: 'Today', icon: LayoutDashboard, end: true },
  { to: '/nutrition', label: 'Nutrition', icon: Utensils, end: false },
  { to: '/training', label: 'Training', icon: Dumbbell, end: false },
  { to: '/progress', label: 'Progress', icon: BarChart3, end: false },
  { to: '/account', label: 'Account', icon: User, end: false },
];

export function MobileBottomBar() {
  return (
    <nav
      aria-label="Primary mobile navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-[#202733] bg-[#0D1016]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 items-center h-14 px-1">
        {MOBILE_HUBS.map((hub) => {
          const Icon = hub.icon;
          return (
            <NavLink
              key={hub.to}
              to={hub.to}
              end={hub.end}
              className={({ isActive }) =>
                `flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-[8px] px-1 text-[10px] font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'text-[#B6F36A]'
                    : 'text-[#929BAA] hover:text-[#F5F7FA]'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{hub.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
