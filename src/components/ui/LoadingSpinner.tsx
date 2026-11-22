export function LoadingSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#252D38] border-t-[#B6F36A]" />
      <p className="text-xs text-[#929BAA]">{label}</p>
    </div>
  );
}
