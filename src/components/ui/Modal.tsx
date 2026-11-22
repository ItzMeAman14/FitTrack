import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidthClass?: string;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidthClass = 'max-w-lg',
}: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 w-full ${maxWidthClass} rounded-[14px] border border-[#252D38] bg-[#121720] p-6 shadow-2xl max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#202733] pb-4 mb-5">
          <div>
            <h3 className="font-display text-base font-semibold text-[#F5F7FA]">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-[#929BAA]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#626C7B] hover:bg-[#171E29] hover:text-[#F5F7FA] transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
