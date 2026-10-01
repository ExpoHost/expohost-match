import { useState } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { descargarCsv } from '../../lib/csv'
import { avisarReunion } from '../../lib/correos'
import { mensajeError } from '../../lib/utilidades'
import { ESTADOS, estadoPersona, etiquetaParticipacion, TIERS, type Estado, type Participante } from './tipos'

type Filtro = Estado | 'todos'
const FILTROS: { id: Filtro; texto: string; ayuda: string }[] = [
  { id: 'completo', texto: 'Ya tienen perfil', ayuda: 'Personas que terminaron su registro. Ya aparecen en la app y pueden agendar reuniones.' },
  { id: 'invitado', texto: 'Invitados sin entrar', ayuda: 'Les llegó la invitación por correo pero todavía no han entrado. Nadie los ve en la app.' },
  { id: 'sin_terminar', texto: 'Sin terminar', ayuda: 'Empezaron su registro pero no terminaron el perfil. Nadie los ve en la app hasta que lo terminen. A los 45 minutos les llega solo un correo para que lo retomen; también se lo puedes enviar tú.' },
  { id: 'fuera', texto: 'Fuera de la app', ayuda: 'Personas que la organización sacó. No pueden entrar y nadie las ve. Sus datos se conservan y se pueden volver a admitir.' },
  { id: 'todos', texto: 'Todos', ayuda: 'Todas las personas, en cualquier estado.' },
]
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' })

export default function Participantes({ participantes, recargar }: { participantes: Participante[] | null; recargar: () => Promise<void> }) {
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('completo')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  if (!participantes) return <p className="text-tinta-suave" role="status">Cargando…</p>

  const cuenta = (f: Filtro) => (f === 'todos' ? participantes.length : participantes.filter((p) => estadoPersona(p) === f).length)
  const q = busqueda.trim().toLowerCase()
  // al buscar se busca en todos, sin importar la pestaña elegida
  const lista = participantes
    .filter((p) => (q ? [p.nombre, p.empresa, p.email, p.cargo, p.ciudad].some((v) => v?.toLowerCase().includes(q)) : filtro === 'todos' || estadoPersona(p) === filtro))

  async function cambiarPrioridad(p: Participante, tier: string) {
    setError(null); setAviso(null)
    const { error } = await supabase.rpc('admin_participante', { p_user: p.id, p_tier: tier })
    if (error) setError(mensajeError(error)); else await recargar()
  }

  async function sacar(p: Participante) {
    const reuniones = p.reuniones > 0 ? ` Se cancelarán sus ${p.reuniones} reunión(es) y se avisará por correo a las otras personas.` : ''
    if (!window.confirm(`¿Sacar a ${p.nombre} de la app?\n\nNo podrá entrar y nadie verá su perfil.${reuniones}\n\nSus datos NO se borran: quedan guardados y puedes volver a admitirla cuando quieras.`)) return
    setOcupado(p.id); setError(null); setAviso(null)
    const { data, error } = await supabase.rpc('admin_sacar', { p_user: p.id, p_sacar: true })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    for (const id of (data as string[] | null) ?? []) avisarReunion(id, 'cancelada')
    setAviso(`${p.nombre} quedó fuera de la app. La encuentras en "Fuera de la app" si quieres volver a admitirla.`)
    await recargar()
  }

  async function admitir(p: Participante) {
    setOcupado(p.id); setError(null); setAviso(null)
    const { error } = await supabase.rpc('admin_sacar', { p_user: p.id, p_sacar: false })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    setAviso(`${p.nombre} puede volver a entrar a la app con su correo.`)
    await recargar()
  }

  async function recordar(p: Participante) {
    setOcupado(p.id); setError(null); setAviso(null)
    const { data, error } = await supabase.functions.invoke('correo-recordatorio', { body: { user_id: p.id } })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    if (data?.enviado && data.personas > 0) { setAviso(`Le enviamos el recordatorio a ${p.email}.`); await recargar() }
    else setError(`No se envió el recordatorio a ${p.email}${data?.motivo ? `: ${data.motivo}` : '.'}`)
  }

  async function reenviar(p: Participante) {
    if (!p.email) return
    setOcupado(p.id); setError(null); setAviso(null)
    const { data, error } = await supabase.functions.invoke('invitar-expositores', { body: { reenviar: [p.email] } })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    const r = data?.resultados?.[0] as { estado: string; detalle?: string } | undefined
    if (r?.estado === 'invitación reenviada') setAviso(`Le reenviamos la invitación a ${p.email}.`)
    else setError(`${p.email}: ${r?.estado ?? 'no se pudo reenviar'}${r?.detalle ? ` · ${r.detalle}` : ''}`)
  }

  const exportar = () => descargarCsv('participantes', participantes.map((p) => ({
    nombre: p.nombre, empresa: p.empresa, cargo: p.cargo, ciudad: p.ciudad, correo: p.email, celular: p.telefono,
    estado: ESTADOS[estadoPersona(p)].texto, participacion: etiquetaParticipacion(p), tier: p.tier, categoria: p.categoria,
    busca: p.busca, ofrece: p.ofrece, franjas: p.franjas, matches: p.matches, reuniones: p.reuniones,
    registro: p.created_at.slice(0, 16).replace('T', ' '),
  })))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar personas">
        {FILTROS.map((f) => (
          <button key={f.id} onClick={() => { setFiltro(f.id); setBusqueda('') }} aria-pressed={filtro === f.id && !q}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${filtro === f.id && !q ? 'border-tinta bg-tinta text-white' : 'border-linea bg-white text-tinta'}`}>
            {f.texto} ({cuenta(f.id)})
          </button>
        ))}
      </div>
      <p className="text-sm text-tinta-suave">{q ? `Buscando "${busqueda.trim()}" entre todas las personas.` : FILTROS.find((f) => f.id === filtro)!.ayuda}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input className="campo mt-0 min-w-0 flex-1" placeholder="Buscar por nombre, empresa, correo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar persona" />
        <button className="btn-secundario text-sm" onClick={exportar}>Descargar en Excel</button>
      </div>
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {lista.length === 0 && <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-tinta-suave">{q ? 'No encontramos a nadie con ese dato.' : 'No hay nadie en este grupo.'}</p>}
      <ul className="space-y-2">
        {lista.map((p) => {
          const estado = estadoPersona(p)
          return (
            <li key={p.id} className={`tarjeta p-4 ${estado === 'fuera' ? 'opacity-70' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{p.nombre === 'Nuevo participante' ? (p.empresa ?? 'Sin nombre todavía') : p.nombre} <span className="text-sm font-normal text-tinta-suave">{p.nombre === 'Nuevo participante' ? '' : [p.cargo, p.empresa].filter(Boolean).join(' · ')}</span></p>
                  <p className="break-words text-sm text-tinta-suave">{p.email}{p.telefono ? ` · ${p.telefono}` : ''}{p.ciudad ? ` · ${p.ciudad}` : ''}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                    <span className={`rounded-full px-2.5 py-1 ${ESTADOS[estado].clase}`}>{ESTADOS[estado].texto}</span>
                    <span className="text-azul">{etiquetaParticipacion(p)}</span>
                    {p.solicitud && p.empresa_tipo !== 'expositor' && <span className="rounded-full bg-rosa/15 px-2.5 py-1 text-[#B0103F]">Pidió ser expositor · está en "Por aprobar"</span>}
                    {p.es_admin && <span className="text-tinta-suave">Organización</span>}
                  </p>
                  <p className="mt-1 text-xs text-tinta-suave">
                    {estado === 'completo' ? `${p.matches} matches · ${p.reuniones} reuniones · ` : ''}{p.invitado ? 'Invitado' : estado === 'sin_terminar' ? 'Empezó' : 'Se registró'} el {fecha(p.created_at)}
                    {estado === 'sin_terminar' && (p.recordatorio_at ? ` · Recordatorio enviado el ${fecha(p.recordatorio_at)}` : ' · Aún sin recordatorio')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {estado === 'completo' && p.tipo !== 'expositor' && (
                    <label className="text-xs font-semibold text-tinta-suave">Prioridad{' '}
                      <select className="campo mt-0 inline-block min-h-11 w-auto py-1 text-sm" value={p.tier} onChange={(e) => cambiarPrioridad(p, e.target.value)} aria-label={`Prioridad de ${p.nombre}`}>
                        {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                  )}
                  {estado === 'invitado' && <button className="btn-secundario min-h-11 px-4 text-sm" disabled={ocupado === p.id} onClick={() => reenviar(p)}>{ocupado === p.id ? 'Enviando…' : 'Reenviar invitación'}</button>}
                  {estado === 'sin_terminar' && <button className="btn-secundario min-h-11 px-4 text-sm" disabled={ocupado === p.id} onClick={() => recordar(p)}>{ocupado === p.id ? 'Enviando…' : p.recordatorio_at ? 'Enviar otro recordatorio' : 'Enviar recordatorio'}</button>}
                  {estado === 'fuera'
                    ? <button className="btn-secundario min-h-11 px-4 text-sm" disabled={ocupado === p.id} onClick={() => admitir(p)}>Volver a admitir</button>
                    : !p.es_admin && <button className="btn-secundario min-h-11 px-4 text-sm text-[#B0103F]" disabled={ocupado === p.id} onClick={() => sacar(p)}>Sacar de la app</button>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
