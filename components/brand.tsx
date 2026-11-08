export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M9 21.5a7.5 7.5 0 1 1 14 0" fill="none" stroke="var(--lime)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="21.5" r="2.6" fill="#fff" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-tight">
        <div className="text-[14px] font-semibold tracking-tight">180DC Hub</div>
        <div className="text-[11px] text-ink-3">Barcelona</div>
      </div>
    </div>
  );
}
