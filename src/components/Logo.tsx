export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="Expohost Match">
      <svg viewBox="0 0 88 52" fill="none" className="h-7 w-auto" aria-hidden="true">
        <path d="M4 50 C4 22, 24 10, 26 34 L26 50" stroke="#0049FE" strokeWidth="9" strokeLinecap="round" />
        <path d="M30 50 C30 20, 50 8, 52 32 L52 50" stroke="#00D1D1" strokeWidth="9" strokeLinecap="round" />
        <path d="M56 50 C56 18, 74 6, 84 14" stroke="#FF3772" strokeWidth="9" strokeLinecap="round" />
      </svg>
      <span className="text-sm font-extrabold tracking-wide text-tinta">
        EXPOHOST <span className="text-azul">MATCH</span>
      </span>
    </span>
  )
}
