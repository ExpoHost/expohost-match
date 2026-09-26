// Arcos del logo oficial de ExpoHost: cuatro tramos sólidos (azul, turquesa, rosa, naranja),
// cada uno montado sobre el anterior. El azul nace cortado en la base.
export const ARCOS_PATHS = [
  { d: 'M4.8 38 C10 18, 18 5.6, 26 5.6 C34 5.6, 35 18, 32 31.5', color: '#0049FE' },
  { d: 'M32 31.8 C37 16, 43 5.4, 51.3 5.4 C59 5.4, 60 18, 57 31.5', color: '#00D1D1' },
  { d: 'M57 31.8 C62 16, 68 5.4, 76.3 5.4 C84 5.4, 85 18, 82 31.5', color: '#FF3772' },
  { d: 'M82 31.8 C87 16.5, 95 8, 107 7.2', color: '#FF8000', cap: 'butt' },
]

export function Arcos({ className = 'h-7 w-auto' }: { className?: string }) {
  return (
    <svg viewBox="0 0 111 36" fill="none" className={className} aria-hidden="true">
      {ARCOS_PATHS.map((p) => (
        <path key={p.color} d={p.d} stroke={p.color} strokeWidth="8" strokeLinecap={p.cap === 'butt' ? 'butt' : 'round'} />
      ))}
      {/* inicio redondeado del tramo naranja (su final es corte recto) */}
      <circle cx="82" cy="31.8" r="4" fill="#FF8000" />
    </svg>
  )
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="Expohost Match">
      <Arcos />
      <span className="text-sm font-extrabold tracking-wide text-tinta">
        EXPOHOST <span className="text-azul">MATCH</span>
      </span>
    </span>
  )
}
