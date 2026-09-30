import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/utilidades'
import { Aviso, Avatar, Etiquetas } from './ui'

type Interesado = {
  id: string; nombre: string; cargo: string | null; ciudad: string | null; bio: string | null; foto_path: string | null
  tipo: 'asistente' | 'expositor'; categoria: string | null; busca: string[]; ofrece: string[]
  empresa: string | null; stand: string | null; proveedor: boolean; yo_dije_no: boolean; cuando: string
}

// Personas que me dieron ♥ y a quienes yo aún no (las que pasé con "No" o que nunca vi)
export function useLesIntereso() {
  const [lista, setLista] = useState<Interesado[] | null>(null)
  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('les_intereso')
    setLista(data ?? [])
  }, [])
  useEffect(() => { cargar() }, [cargar])
  return { lista, cargar }
}

// Aviso corto para la pantalla de Perfiles
export function AvisoLesIntereso() {
  const { lista } = useLesIntereso()
  if (!lista || lista.length === 0) return null
  return (
    <Link to="/agenda" className="mb-4 flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-rosa/10 px-4 py-2 text-sm font-semibold text-[#B0103F]">
      <span>{lista.length === 1 ? '1 persona quiere reunirse contigo' : `${lista.length} personas quieren reunirse contigo`}</span>
      <span className="shrink-0 underline">Ver</span>
    </Link>
  )
}

// Sección de Mi agenda: un toque en "Me interesa" crea el match y lleva a elegir la hora
export function LesIntereso() {
  const { lista, cargar } = useLesIntereso()
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!lista || lista.length === 0) return null

  async function meInteresa(p: Interesado) {
    if (ocupado) return
    setOcupado(p.id); setError(null)
    const { data, error } = await supabase.rpc('swipe', { p_to: p.id, p_liked: true })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    if (data) navigate(`/match/${data}`); else cargar()
  }

  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-tinta-suave">Les interesas · ¿quieres reunirte? ({lista.length})</h2>
      <p className="text-sm text-tinta-suave">Estas personas te marcaron con ♥. Si a ti también te interesa, toca "Me interesa" y eligen la hora.</p>
      {error && <Aviso>{error}</Aviso>}
      {lista.map((p) => (
        <article key={p.id} className="tarjeta p-4">
          <div className="flex items-center gap-3">
            <Avatar path={p.foto_path} nombre={p.nombre} tam="h-12 w-12 text-base" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{p.nombre}</p>
              <p className="truncate text-sm text-tinta-suave">{[p.cargo, p.empresa].filter(Boolean).join(' · ')}</p>
              {(p.tipo === 'expositor' && p.stand) ? <p className="text-xs font-bold text-[#8A4500]">Expositor · Stand {p.stand}</p>
                : p.proveedor ? <p className="text-xs font-bold text-[#006B6B]">Proveedor / servicio</p> : null}
            </div>
          </div>
          {abierto === p.id && (
            <div className="mt-3 space-y-3">
              {p.bio && <p className="text-sm leading-relaxed">{p.bio}</p>}
              {p.busca.length > 0 && <div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#B0103F]">Busca</p><Etiquetas items={p.busca} color="rosa" /></div>}
              {p.ofrece.length > 0 && <div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-azul">Ofrece</p><Etiquetas items={p.ofrece} color="azul" /></div>}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn-secundario px-3 text-sm" onClick={() => setAbierto(abierto === p.id ? null : p.id)}>{abierto === p.id ? 'Ocultar perfil' : 'Ver perfil'}</button>
            <button className="btn bg-rosa px-3 text-sm text-white" disabled={ocupado !== null} onClick={() => meInteresa(p)}>{ocupado === p.id ? '…' : '♥ Me interesa'}</button>
          </div>
        </article>
      ))}
    </section>
  )
}
