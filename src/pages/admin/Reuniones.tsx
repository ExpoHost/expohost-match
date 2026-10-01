import { useCallback, useEffect, useState } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { descargarCsv } from '../../lib/csv'
import { avisarReunion } from '../../lib/correos'
import { diaTexto, hora, horaFin, lugarTexto } from '../../lib/reuniones'
import { mensajeError } from '../../lib/utilidades'
import { ASISTENCIA, type Asistencia, type ReunionAdmin } from './tipos'

type BloqueSimple = { id: number; dia: string; inicio: string; bloqueado: boolean }
type Espera = { block_id: number; dia: string; inicio: string; personas: number; nombres: string }

// Cambiar bloque y/o lugar de una reunión confirmada (la base valida choques de personas y mesas)
function Reasignar({ r, bloques, onListo, onError }: { r: ReunionAdmin; bloques: BloqueSimple[]; onListo: () => void; onError: (m: string) => void }) {
  const [block, setBlock] = useState(r.block_id)
  const [lugar, setLugar] = useState<'stand' | 'mesa'>(r.lugar)
  const [mesa, setMesa] = useState(String(r.mesa ?? 1))
  const [stand, setStand] = useState(r.stand ?? '')
  const [ocupado, setOcupado] = useState(false)
  async function guardar() {
    setOcupado(true)
    const { error } = await supabase.rpc('admin_reasignar', { p_meeting: r.id, p_block: block, p_lugar: lugar, p_mesa: lugar === 'mesa' ? Number(mesa) : null, p_stand: lugar === 'stand' ? stand : null })
    setOcupado(false)
    if (error) onError(mensajeError(error)); else { avisarReunion(r.id, 'confirmada'); onListo() }
  }
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl bg-hueso p-3">
      <label className="text-xs font-semibold text-tinta-suave">Bloque
        <select className="campo mt-0 block min-h-9 w-auto py-1 text-sm" value={block} onChange={(e) => setBlock(Number(e.target.value))}>
          {bloques.filter((b) => !b.bloqueado).map((b) => <option key={b.id} value={b.id}>{diaTexto(b.dia).split(' ')[0]} {hora(b.inicio)}</option>)}
        </select></label>
      <label className="text-xs font-semibold text-tinta-suave">Lugar
        <select className="campo mt-0 block min-h-9 w-auto py-1 text-sm" value={lugar} onChange={(e) => setLugar(e.target.value as 'stand' | 'mesa')}>
          <option value="mesa">Zona Match</option><option value="stand">Stand</option>
        </select></label>
      {lugar === 'mesa'
        ? <label className="text-xs font-semibold text-tinta-suave">Mesa<input className="campo mt-0 block min-h-9 w-20 py-1 text-sm" type="number" min={1} value={mesa} onChange={(e) => setMesa(e.target.value)} /></label>
        : <label className="text-xs font-semibold text-tinta-suave">Stand<input className="campo mt-0 block min-h-9 w-24 py-1 text-sm" value={stand} onChange={(e) => setStand(e.target.value)} maxLength={20} /></label>}
      <button className="btn-primario min-h-9 px-4 text-sm" disabled={ocupado} onClick={guardar}>Guardar</button>
      <p className="w-full text-xs text-tinta-suave">Las dos personas reciben un correo con la nueva hora y el lugar.</p>
    </div>
  )
}

export default function Reuniones() {
  const [todas, setTodas] = useState<ReunionAdmin[] | null>(null)
  // En la feria arranca en el día de hoy (hora de Bogotá)
  const hoyBogota = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10)
  const [dia, setDia] = useState(hoyBogota === '2026-10-07' ? '2026-10-07' : '2026-10-06')
  const ahora = hoyBogota === dia ? new Date(Date.now() - 5 * 3600_000).toISOString().slice(11, 16) : null
  const [verCanceladas, setVerCanceladas] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviandoAgenda, setEnviandoAgenda] = useState(false)
  const [reasignando, setReasignando] = useState<string | null>(null)
  const [bloquesTodos, setBloquesTodos] = useState<BloqueSimple[]>([])
  const [espera, setEspera] = useState<Espera[]>([])

  const cargar = useCallback(async () => {
    const [{ data, error }, b, w] = await Promise.all([
      supabase.rpc('admin_reuniones'),
      supabase.from('blocks').select('id, dia, inicio, bloqueado').order('dia').order('inicio'),
      supabase.rpc('admin_lista_espera'),
    ])
    if (error) setError(mensajeError(error)); else { setTodas(data); setError(null) }
    setBloquesTodos(b.data ?? []); setEspera(w.data ?? [])
  }, [])
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 30_000)
    return () => clearInterval(t)
  }, [cargar])

  if (!todas) return <p className="text-tinta-suave" role="status">Cargando…</p>

  const q = busqueda.trim().toLowerCase()
  const lista = todas.filter((r) => r.dia === dia && (verCanceladas || r.estado === 'confirmada')
    && (!q || [r.a_nombre, r.b_nombre, r.a_empresa, r.b_empresa, r.stand].some((v) => v?.toLowerCase().includes(q))))
  const bloques = [...new Set(lista.map((r) => r.inicio))].sort()
  const activas = todas.filter((r) => r.estado === 'confirmada')

  async function asistencia(r: ReunionAdmin, user: string, valor: Asistencia) {
    const { error } = await supabase.rpc('admin_asistencia', { p_meeting: r.id, p_user: user, p_valor: valor })
    if (error) setError(mensajeError(error)); else cargar()
  }
  async function cancelar(r: ReunionAdmin) {
    if (!window.confirm(`¿Cancelar la reunión de ${r.a_nombre} y ${r.b_nombre} de las ${hora(r.inicio)}? Se les avisará por correo.`)) return
    const { error } = await supabase.rpc('cancelar_reunion', { p_meeting: r.id })
    if (error) { setError(mensajeError(error)); return }
    avisarReunion(r.id, 'cancelada')
    cargar()
  }
  // Correo "Tu agenda de mañana" con botón Confirmo: se envía solo el 5 y 6 de octubre a las 7 p.m.; aquí se puede forzar
  async function enviarAgenda() {
    if (!window.confirm(`¿Enviar ahora el correo de agenda del ${diaTexto(dia)} a todas las personas con reunión ese día?`)) return
    setEnviandoAgenda(true); setError(null)
    const { data, error } = await supabase.functions.invoke('correo-agenda', { body: { dia } })
    setEnviandoAgenda(false)
    if (error) setError(mensajeError(error)); else setAviso(data.enviado ? `Correo enviado a ${data.personas} persona(s).` : `No se envió: ${data.motivo}`)
  }
  const exportar = () => descargarCsv('reuniones', activas.map((r) => ({
    dia: r.dia, inicio: hora(r.inicio), fin: horaFin(r.inicio), lugar: lugarTexto(r),
    persona_a: r.a_nombre, empresa_a: r.a_empresa, asistencia_a: ASISTENCIA[r.asistencia_a], confirmo_a: r.confirmo_a ? 'sí' : 'no',
    persona_b: r.b_nombre, empresa_b: r.b_empresa, asistencia_b: ASISTENCIA[r.asistencia_b], confirmo_b: r.confirmo_b ? 'sí' : 'no',
  })))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {['2026-10-06', '2026-10-07'].map((d) => (
          <button key={d} onClick={() => setDia(d)} className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${dia === d ? 'border-azul bg-azul text-white' : 'border-linea bg-white'}`}>{diaTexto(d)}</button>
        ))}
        <label className="ml-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-azul" checked={verCanceladas} onChange={(e) => setVerCanceladas(e.target.checked)} /> Ver canceladas</label>
        <button className="btn-secundario ml-auto text-sm" onClick={exportar}>Descargar en Excel</button>
        <button className="btn-secundario text-sm" disabled={enviandoAgenda} onClick={enviarAgenda}>{enviandoAgenda ? 'Enviando…' : 'Enviar correo de agenda'}</button>
      </div>
      <input className="campo" placeholder="Escribe el nombre de quien pregunta por su reunión" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar reunión" />
      <p className="text-sm text-tinta-suave">{activas.length} reuniones confirmadas en total · {lista.filter((r) => r.estado === 'confirmada').length} este día. Se actualiza cada 30 segundos. El correo de agenda sale solo el 5 y 6 de octubre a las 7 p.m.</p>
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {espera.filter((e) => e.dia === dia).length > 0 && (
        <Aviso tipo="info">Lista de espera este día: {espera.filter((e) => e.dia === dia).map((e) => `${hora(e.inicio)} (${e.personas}: ${e.nombres})`).join(' · ')}</Aviso>
      )}
      {bloques.length === 0 && <p className="text-sm text-tinta-suave">Sin reuniones este día.</p>}
      {bloques.map((b) => (
        <section key={b} className={`space-y-2 ${ahora && hora(b) <= ahora && ahora < horaFin(b).replace(/:(\d\d)$/, (_, m) => `:${String(Number(m) + 5).padStart(2, '0')}`) ? 'rounded-[22px] bg-azul/8 p-3' : ''}`}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-tinta-suave">{hora(b)} – {horaFin(b)}{ahora && hora(b) <= ahora && ahora < horaFin(b) ? ' · ahora' : ''}</h2>
          {lista.filter((r) => r.inicio === b).map((r) => (
            <article key={r.id} className={`tarjeta p-4 ${r.estado === 'cancelada' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-azul">{lugarTexto(r)}{r.estado === 'cancelada' ? ' · cancelada' : ''}</p>
                {r.estado === 'confirmada' && (
                  <div className="flex gap-2">
                    <button className="btn-secundario min-h-9 px-3 text-xs" onClick={() => setReasignando(reasignando === r.id ? null : r.id)}>Reasignar</button>
                    <button className="btn-secundario min-h-9 px-3 text-xs text-[#B0103F]" onClick={() => cancelar(r)}>Cancelar</button>
                  </div>
                )}
              </div>
              {reasignando === r.id && <Reasignar r={r} bloques={bloquesTodos} onListo={() => { setReasignando(null); cargar() }} onError={setError} />}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[{ id: r.a_id, nombre: r.a_nombre, empresa: r.a_empresa, asis: r.asistencia_a, conf: r.confirmo_a }, { id: r.b_id, nombre: r.b_nombre, empresa: r.b_empresa, asis: r.asistencia_b, conf: r.confirmo_b }].map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-2xl bg-hueso px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.nombre}</p>
                      <p className="truncate text-xs text-tinta-suave">{p.empresa ?? ''}{p.conf ? ' · confirmó' : ''}</p>
                    </div>
                    {r.estado === 'confirmada' && (
                      <div className="flex shrink-0 gap-1" role="group" aria-label={`Asistencia de ${p.nombre}`}>
                        {(['asistio', 'no_vino'] as Asistencia[]).map((k) => (
                          <button key={k} onClick={() => asistencia(r, p.id, p.asis === k ? 'pendiente' : k)} aria-pressed={p.asis === k}
                            className={`min-h-11 rounded-full border px-3 text-xs font-bold ${p.asis === k ? (k === 'asistio' ? 'border-[#006B6B] bg-turquesa/25 text-[#006B6B]' : 'border-rosa bg-rosa/10 text-[#B0103F]') : 'border-linea bg-white text-tinta-suave'}`}>
                            {ASISTENCIA[k]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}
