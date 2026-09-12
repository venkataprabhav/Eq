export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="var(--surface-2)" />
      <rect x="6" y="14" width="3.5" height="12" rx="1.75" fill="var(--accent)" />
      <rect x="11.5" y="8" width="3.5" height="18" rx="1.75" fill="var(--accent)" />
      <rect x="17" y="11" width="3.5" height="15" rx="1.75" fill="var(--accent)" />
      <rect x="22.5" y="16" width="3.5" height="10" rx="1.75" fill="var(--accent)" />
    </svg>
  );
}
