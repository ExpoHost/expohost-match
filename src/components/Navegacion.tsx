import { NavLink } from 'react-router-dom'

const ITEMS = [
  { to: '/descubrir', texto: 'Descubrir', icono: 'M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6C19 16.5 12 21 12 21z' },
  { to: '/agenda', texto: 'Mi agenda', icono: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
  { to: '/perfil', texto: 'Perfil', icono: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
]

export function Navegacion() {
  return (
    <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-20 border-t border-linea bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-md">
        {ITEMS.map((i) => (
          <li key={i.to} className="flex-1">
            <NavLink to={i.to} className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${isActive ? 'text-azul' : 'text-tinta-suave'}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={i.icono} /></svg>
              {i.texto}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
