import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, className = '', id, ...props },
  ref
) {
  const inputId = id || props.name;
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium text-[#929BAA]">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`w-full h-[42px] rounded-[9px] bg-[#0D121A] border px-3.5 text-sm text-[#F5F7FA] placeholder-[#626C7B] transition-colors focus:outline-none ${
          error
            ? 'border-[#F16C75] focus:border-[#F16C75]'
            : 'border-[#252D38] focus:border-[#B6F36A]'
        } ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-[#F16C75]">{error}</p>}
      {!error && helperText && <p className="text-xs text-[#626C7B]">{helperText}</p>}
    </div>
  );
});
