import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Aviso, Avatar, Etiquetas, Pantalla } from '../components/ui'
import { supabase } from '../lib/supabase'
import { avisarReunion } from '../lib/correos'
import { mensajeError, useCatalogos, useFoto } from '../lib/utilidades'

type Tarjeta = {
  id: string; nombre: string; cargo: string | null; ciudad: string | null; bio: string | null; foto_path: string | null
  tipo: 'asistente' | 'expositor'; categoria: string | null; busca: string[]; ofrece: string[]
  empresa: string | null; stand: string | null; score: number; razon: string
}

export default function Descubrir() {
  const navigate = useNavigate()
  const { categorias } = useCatalogos()
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<Tarjeta | null>(null) // última decisión (♥ o ✕), para "Deshacer"
  const [match, setMatch] = useState<{ id: string; nombre: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.rpc('feed', { p_limit: 20 })
    if (error) setError(mensajeError(error)); else setTarjetas(data ?? [])
    setCargando(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const actual = tarjetas[0]

  async function decidir(liked: boolean) {
    if (!actual || ocupado) return
    setOcupado(true); setError(null)
    const { data, error } = await supabase.rpc('swipe', { p_to: actual.id, p_liked: liked })
    setOcupado(false)
    if (error) { setError(mensajeError(error)); return }
    setUltimo(actual)
    const resto = tarjetas.slice(1)
    setTarjetas(resto)
    if (data) setMatch({ id: data, nombre: actual.nombre })
    if (resto.length === 0) cargar()
  }

  // Deshace la última decisión: vuelve a mostrar el perfil y, si hubo match, lo quita
  // (la otra persona conserva su ♥, así que un nuevo ♥ rehace el match).
  async function deshacer() {
    if (!ultimo) return
    const { data, error } = await supabase.rpc('deshacer_ultimo_swipe')
    if (error) { setError(mensajeError(error)); return }
    if (data) avisarReunion(data, 'cancelada')
    setMatch(null)
    setTarjetas((t) => [ultimo, ...t])
    setUltimo(null)
  }

  return (
    <Pantalla nav>
      {error && <div className="mb-4"><Aviso>{error}</Aviso></div>}
      {cargando && !actual ? (
        <p className="py-20 text-center text-tinta-suave" role="status">Buscando perfiles compatibles…</p>
      ) : !actual ? (
        <div className="tarjeta p-8 text-center">
          <h1 className="text-xl font-extrabold">Ya viste todos los perfiles por ahora</h1>
          <p className="mt-2 text-tinta-suave">Cada día se registran más personas. Vuelve más tarde o revisa tu agenda.</p>
          <button className="btn-primario mt-6 w-full" onClick={() => navigate('/agenda')}>Ver mi agenda</button>
          {ultimo && <button className="btn-secundario mt-3 w-full" onClick={deshacer}>Deshacer la última decisión</button>}
        </div>
      ) : (
        <>
          <Deslizable key={actual.id} onDecidir={decidir}>
            <TarjetaPerfil t={actual} categoria={categorias.find((c) => c.slug === actual.categoria)?.nombre} />
          </Deslizable>
          {/* espacio para que los botones fijos no tapen el final de la tarjeta */}
          <div className="h-28" />
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 bg-gradient-to-t from-hueso via-hueso/90 to-transparent pb-3 pt-6">
            <div className="mx-auto flex max-w-md items-center justify-center gap-6">
              <button onClick={deshacer} disabled={!ultimo} aria-label="Deshacer la última decisión"
                className="flex h-12 w-12 items-center justify-center rounded-full border border-linea bg-white text-xl text-azul shadow-suave transition active:scale-95 disabled:invisible">↶</button>
              <button onClick={() => decidir(false)} disabled={ocupado} aria-label={`No me interesa ${actual.nombre}`}
                className="flex h-18 w-18 items-center justify-center rounded-full border border-linea bg-white text-3xl text-tinta-suave shadow-suave transition active:scale-95 disabled:opacity-50">✕</button>
              <button onClick={() => decidir(true)} disabled={ocupado} aria-label={`Me interesa ${actual.nombre}`}
                className="flex h-20 w-20 items-center justify-center rounded-full bg-rosa text-4xl text-white shadow-suave transition active:scale-95 disabled:opacity-50">♥</button>
              <span className="h-12 w-12" aria-hidden="true" />
            </div>
          </div>
        </>
      )}

      {match && (
        <div role="dialog" aria-modal="true" aria-labelledby="titulo-match" className="fixed inset-0 z-30 flex items-end justify-center bg-tinta/60 p-4 sm:items-center">
          <div className="tarjeta w-full max-w-md p-8 text-center">
            <p className="text-5xl text-rosa" aria-hidden="true">♥</p>
            <h2 id="titulo-match" className="mt-2 text-2xl font-extrabold">¡Es un match!</h2>
            <p className="mt-2 text-tinta-suave">A {match.nombre} también le interesa reunirse contigo. Elige un horario para la feria.</p>
            <button className="btn-primario mt-6 w-full" autoFocus onClick={() => navigate(`/match/${match.id}`)}>Elegir horario</button>
            <button className="btn-secundario mt-3 w-full" onClick={() => setMatch(null)}>Seguir descubriendo</button>
            <button className="mt-4 min-h-11 text-sm font-semibold text-tinta-suave" onClick={deshacer}>Fue un error: deshacer el ♥</button>
          </div>
        </div>
      )}
    </Pantalla>
  )
}

function TarjetaPerfil({ t, categoria }: { t: Tarjeta; categoria?: string }) {
  const foto = useFoto(t.foto_path)
  return (
    <article className="tarjeta overflow-hidden">
      <div className="relative aspect-[4/3] bg-azul/8">
        {foto
          ? <img src={foto} alt="" className="h-full w-full object-cover" draggable={false} />
          : <div className="flex h-full items-center justify-center"><Avatar nombre={t.nombre} tam="h-28 w-28 text-4xl" /></div>}
        {t.tipo === 'expositor' && (
          <span className="absolute left-4 top-4 rounded-full bg-naranja px-3 py-1 text-xs font-bold text-tinta">Expositor{t.stand ? ` · Stand ${t.stand}` : ''}</span>
        )}
      </div>
      <div className="p-5">
        <h1 className="text-2xl font-extrabold leading-tight">{t.nombre}</h1>
        <p className="mt-1 text-sm text-tinta-suave">{[t.cargo, t.empresa].filter(Boolean).join(' · ')}</p>
        <p className="mt-1 text-xs font-semibold text-tinta-suave">{[categoria, t.ciudad].filter(Boolean).join(' · ')}</p>
        <p className="mt-3 inline-block rounded-full bg-turquesa/15 px-3 py-1 text-xs font-bold text-[#006B6B]">{t.razon}</p>
        {t.bio && <p className="mt-3 text-sm leading-relaxed">{t.bio}</p>}
        {t.busca.length > 0 && <section className="mt-4"><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#B0103F]">Busca</h2><Etiquetas items={t.busca} color="rosa" /></section>}
        {t.ofrece.length > 0 && <section className="mt-4"><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-azul">Ofrece</h2><Etiquetas items={t.ofrece} color="azul" /></section>}
      </div>
    </article>
  )
}

// Deslizar a la derecha = ♥, a la izquierda = ✕ (los botones siguen siendo la forma principal).
// Solo cuenta si la tarjeta se arrastra más de la mitad de su ancho y en horizontal; mientras
// se arrastra se muestra qué va a pasar, para evitar decisiones por un roce.
function Deslizable({ children, onDecidir }: { children: React.ReactNode; onDecidir: (liked: boolean) => void }) {
  const inicio = useRef<{ x: number; y: number } | null>(null)
  const caja = useRef<HTMLDivElement>(null)
  const [d, setD] = useState({ x: 0, y: 0 })
  const umbral = () => Math.max(160, (caja.current?.offsetWidth ?? 320) * 0.5)
  const abajo = (e: PointerEvent) => { if (e.pointerType !== 'mouse') inicio.current = { x: e.clientX, y: e.clientY } }
  const mover = (e: PointerEvent) => { if (inicio.current) setD({ x: e.clientX - inicio.current.x, y: e.clientY - inicio.current.y }) }
  const soltar = () => {
    if (!inicio.current) return
    inicio.current = null
    if (Math.abs(d.x) > umbral() && Math.abs(d.x) > Math.abs(d.y) * 2) onDecidir(d.x > 0)
    setD({ x: 0, y: 0 })
  }
  const progreso = Math.min(1, Math.abs(d.x) / umbral())
  return (
    <div ref={caja} onPointerDown={abajo} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
      style={{ transform: d.x ? `translateX(${d.x}px) rotate(${d.x / 40}deg)` : undefined, touchAction: 'pan-y' }}
      className={`relative select-none ${d.x ? '' : 'transition-transform'}`}>
      {children}
      {d.x !== 0 && (
        <span aria-hidden="true" style={{ opacity: progreso }}
          className={`pointer-events-none absolute top-6 rounded-full px-4 py-2 text-lg font-extrabold text-white ${d.x > 0 ? 'left-6 bg-rosa' : 'right-6 bg-tinta-suave'}`}>
          {d.x > 0 ? (progreso >= 1 ? 'Suelta para ♥' : '♥') : (progreso >= 1 ? 'Suelta para ✕' : '✕')}
        </span>
      )}
    </div>
  )
}
