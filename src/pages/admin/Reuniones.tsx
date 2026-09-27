import { useCallback, useEffect, useState } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { descargarCsv } from '../../lib/csv'
import { avisarReunion } from '../../lib/correos'
import { diaTexto, hora, horaFin, lugarTexto } from '../../lib/reuniones'
import { mensajeError } from '../../lib/utilidades'
import { ASISTENCIA, type Asistencia, type ReunionAdmin } from './tipos'

export default function Reuniones() {
  const [todas, setTodas] = useState<ReunionAdmin[] | null>(null)
  const [dia, setDia] = useState('2026-10-06')
  const [verCanceladas, setVerCanceladas] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_reuniones')
    if (error) setError(mensajeError(error)); else { setTodas(data); setError(null) }
  }, [])
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 30_000)
    return () => clearInterval(t)
  }, [cargar])

  if (!todas) return <p className="text-tinta-suave" role="status">Cargando…</p>

  const lista = todas.filter((r) => r.dia === dia && (verCanceladas || r.estado === 'confirmada'))
  const bloques = [...new Set(lista.map((r) => r.inicio))].sort()
  const activas = todas.filter((r) => r.estado === 'confirmada')

  async function asistencia(r: ReunionAdmin, user: string, valor: Asistencia) {
    const { error } = await supabase.rpc('admin_asistencia', { p_meeting: r.id, p_user: user, p_valor: valor })
    if (error) setError(mensajeError(error)); else cargar()
  }
  async function cancelar(r: ReunionAdmin) {
    const { error } = await supabase.rpc('cancelar_reunion', { p_meeting: r.id })
    if (error) { setError(mensajeError(error)); return }
    avisarReunion(r.id, 'cancelada')
    cargar()
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
        <button className="btn-secundario ml-auto text-sm" onClick={exportar}>Exportar CSV</button>
      </div>
      <p className="text-sm text-tinta-suave">{activas.length} reuniones confirmadas en total · {lista.filter((r) => r.estado === 'confirmada').length} este día. Se actualiza cada 30 segundos.</p>
      {error && <Aviso>{error}</Aviso>}
      {bloques.length === 0 && <p className="text-sm text-tinta-suave">Sin reuniones este día.</p>}
      {bloques.map((b) => (
        <section key={b} className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-tinta-suave">{hora(b)} – {horaFin(b)}</h2>
          {lista.filter((r) => r.inicio === b).map((r) => (
            <article key={r.id} className={`tarjeta p-4 ${r.estado === 'cancelada' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-azul">{lugarTexto(r)}{r.estado === 'cancelada' ? ' · cancelada' : ''}</p>
                {r.estado === 'confirmada' && <button className="btn-secundario min-h-9 px-3 text-xs text-[#B0103F]" onClick={() => cancelar(r)}>Cancelar</button>}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[{ id: r.a_id, nombre: r.a_nombre, empresa: r.a_empresa, asis: r.asistencia_a, conf: r.confirmo_a }, { id: r.b_id, nombre: r.b_nombre, empresa: r.b_empresa, asis: r.asistencia_b, conf: r.confirmo_b }].map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-2xl bg-hueso px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.nombre}</p>
                      <p className="truncate text-xs text-tinta-suave">{p.empresa ?? ''}{p.conf ? ' · confirmó' : ''}</p>
                    </div>
                    {r.estado === 'confirmada' && (
                      <select className="campo mt-0 w-auto min-h-9 py-1 text-sm" value={p.asis} onChange={(e) => asistencia(r, p.id, e.target.value as Asistencia)} aria-label={`Asistencia de ${p.nombre}`}>
                        {(Object.keys(ASISTENCIA) as Asistencia[]).map((k) => <option key={k} value={k}>{ASISTENCIA[k]}</option>)}
                      </select>
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
