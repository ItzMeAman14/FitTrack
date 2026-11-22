import type { ElementType, ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 px-4 rounded-[10px] border border-dashed border-[#252D38] bg-[#0D121A]/60">
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#171E29] text-[#929BAA]">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h4 className="text-sm font-semibold text-[#F5F7FA]">{title}</h4>
      {description && <p className="mt-1 max-w-md text-xs leading-relaxed text-[#929BAA]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
