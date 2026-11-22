import { forwardRef, type SelectHTMLAttributes } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, options, className = '', id, ...props },
  ref
) {
  const selectId = id || props.name;
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label htmlFor={selectId} className="block text-xs font-medium text-[#929BAA]">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className={`w-full h-[42px] rounded-[9px] bg-[#0D121A] border px-3 text-sm text-[#F5F7FA] transition-colors focus:outline-none ${
          error
            ? 'border-[#F16C75] focus:border-[#F16C75]'
            : 'border-[#252D38] focus:border-[#B6F36A]'
        } ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#121720] text-[#F5F7FA]">
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[#F16C75]">{error}</p>}
    </div>
  );
});
