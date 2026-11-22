import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`rounded-[14px] border border-[#252D38] bg-[#121720] p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}
