import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from './Logo'
import { Navegacion } from './Navegacion'
import { iniciales, useFoto } from '../lib/utilidades'

export function Pantalla({ children, volver, nav = false, ancho = 'max-w-md' }: { children: ReactNode; volver?: string; nav?: boolean; ancho?: string }) {
  return (
    <>
      <main className={`mx-auto min-h-dvh ${ancho} px-5 pb-28 pt-5`}>
        <header className="mb-6 flex min-h-11 items-center justify-between">
          <Link to="/" aria-label="Inicio"><Logo /></Link>
          {volver && <Link to={volver} className="flex min-h-11 items-center text-sm font-semibold text-azul">Volver</Link>}
        </header>
        {children}
      </main>
      {nav && <Navegacion />}
    </>
  )
}

export function Aviso({ children, tipo = 'error' }: { children: ReactNode; tipo?: 'error' | 'ok' | 'info' }) {
  const color = tipo === 'error' ? 'bg-rosa/10 text-[#B0103F]' : tipo === 'ok' ? 'bg-turquesa/15 text-[#006B6B]' : 'bg-azul/8 text-azul'
  return <p role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-2xl px-4 py-3 text-sm font-medium ${color}`}>{children}</p>
}

export function Chip({ activo, onClick, children, color = 'azul' }: { activo: boolean; onClick: () => void; children: ReactNode; color?: 'azul' | 'rosa' }) {
  // rosa con texto blanco no alcanza contraste AA: seleccionado = fondo rosa claro y texto rosa oscuro
  const on = color === 'rosa' ? 'border-rosa bg-rosa/15 text-[#B0103F] font-semibold' : 'border-azul bg-azul text-white'
  return (
    <button type="button" aria-pressed={activo} onClick={onClick}
      className={`min-h-11 rounded-full border px-4 py-2 text-left text-sm font-medium transition ${activo ? on : 'border-linea bg-white text-tinta hover:border-tinta-suave'}`}>
      {children}
    </button>
  )
}

export function Etiquetas({ items, color }: { items: string[]; color: 'rosa' | 'azul' }) {
  const c = color === 'rosa' ? 'bg-rosa/10 text-[#B0103F]' : 'bg-azul/8 text-azul'
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((t) => <li key={t} className={`rounded-full px-3 py-1 text-xs font-semibold ${c}`}>{t}</li>)}
    </ul>
  )
}

export function Avatar({ path, nombre, tam = 'h-16 w-16 text-xl', src }: { path?: string | null; nombre: string; tam?: string; src?: string | null }) {
  const firmada = useFoto(src ? null : path)
  const url = src ?? firmada
  return url
    ? <img src={url} alt="" className={`${tam} shrink-0 rounded-full object-cover`} />
    : <span aria-hidden="true" className={`${tam} flex shrink-0 items-center justify-center rounded-full bg-azul/10 font-bold text-azul`}>{iniciales(nombre)}</span>
}

export function Cargando() {
  return <div className="flex min-h-dvh items-center justify-center text-tinta-suave" role="status">Cargando…</div>
}
