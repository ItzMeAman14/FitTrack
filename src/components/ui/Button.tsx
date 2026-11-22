import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  type = 'button',
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      'bg-[#B6F36A] text-[#090B0F] hover:bg-[#A3E45A] font-semibold border border-transparent',
    secondary:
      'bg-[#171E29] text-[#F5F7FA] hover:bg-[#1F2735] border border-[#252D38] font-medium',
    danger:
      'bg-[#F16C75]/15 text-[#F16C75] hover:bg-[#F16C75]/25 border border-[#F16C75]/30 font-medium',
    ghost:
      'bg-transparent text-[#929BAA] hover:text-[#F5F7FA] hover:bg-[#171E29] border border-transparent font-medium',
  };

  const sizes = {
    sm: 'h-9 px-3.5 text-xs rounded-[8px]',
    md: 'h-[42px] px-4 text-sm rounded-[9px]',
    lg: 'h-[46px] px-5 text-sm rounded-[9px]',
  };

  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B6F36A]/60 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
