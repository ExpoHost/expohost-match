import { useState } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { mensajeError } from '../../lib/utilidades'
import type { Participante } from './tipos'

type Empresa = { id: string; nombre: string; solicitud: string | null; stand_declarado: string | null; stand: string | null; tipo: string | null; personas: Participante[] }

function agrupar(ps: Participante[]) {
  const m = new Map<string, Empresa>()
  for (const p of ps) {
    if (!p.company_id) continue
    const e = m.get(p.company_id) ?? { id: p.company_id, nombre: p.empresa ?? '', solicitud: p.solicitud, stand_declarado: p.stand_declarado, stand: p.stand, tipo: p.empresa_tipo, personas: [] }
    e.personas.push(p)
    m.set(p.company_id, e)
  }
  return [...m.values()]
}

export default function Solicitudes({ participantes, recargar }: { participantes: Participante[] | null; recargar: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [stands, setStands] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  if (!participantes) return <p className="text-tinta-suave" role="status">Cargando…</p>

  const empresas = agrupar(participantes)
  const pendientes = empresas.filter((e) => e.solicitud && e.tipo !== 'expositor')
  const aprobadas = empresas.filter((e) => e.tipo === 'expositor')

  async function accion(id: string, fn: () => PromiseLike<{ error: unknown }>) {
    setOcupado(id); setError(null)
    const { error } = await fn()
    if (error) setError(mensajeError(error)); else await recargar()
    setOcupado(null)
  }
  const aprobar = (e: Empresa, comoProveedor: boolean) =>
    accion(e.id, () => supabase.rpc('aprobar_expositor', { p_company: e.id, p_stand: stands[e.id] ?? e.stand_declarado ?? '', p_como_proveedor: comoProveedor }))
  const rechazar = (e: Empresa) => accion(e.id, () => supabase.rpc('rechazar_solicitud', { p_company: e.id }))
  const quitar = (e: Empresa) => accion(e.id, () => supabase.rpc('quitar_expositor', { p_company: e.id }))
  const cambiarStand = (e: Empresa) => accion(e.id, () => supabase.from('companies').update({ stand: (stands[e.id] ?? e.stand ?? '').trim() || null }).eq('id', e.id).then((r) => ({ error: r.error })))

  return (
    <div className="space-y-8">
      {error && <Aviso>{error}</Aviso>}
      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Solicitudes pendientes ({pendientes.length})</h2>
        {pendientes.length === 0 && <p className="text-sm text-tinta-suave">No hay solicitudes por revisar.</p>}
        {pendientes.map((e) => (
          <article key={e.id} className="tarjeta space-y-3 p-5">
            <div>
              <h3 className="font-extrabold">{e.nombre}</h3>
              <p className="text-sm text-tinta-suave">
                Pide: <strong className="text-tinta">{e.solicitud === 'expositor_stand' ? `Expositor con stand${e.stand_declarado ? ` · declaró stand ${e.stand_declarado}` : ''}` : 'Empresa/servicio sin stand'}</strong>
              </p>
              <ul className="mt-1 text-sm">
                {e.personas.map((p) => <li key={p.id}>{p.nombre}{p.cargo ? ` · ${p.cargo}` : ''} · {p.email}{p.telefono ? ` · ${p.telefono}` : ''}</li>)}
              </ul>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm"><span className="etiqueta">Stand</span>
                <input className="campo w-32" value={stands[e.id] ?? e.stand_declarado ?? ''} onChange={(ev) => setStands({ ...stands, [e.id]: ev.target.value })} maxLength={20} placeholder="A-12" /></label>
              <button className="btn-primario" disabled={ocupado === e.id} onClick={() => aprobar(e, false)}>Aprobar como expositor</button>
              <button className="btn-secundario" disabled={ocupado === e.id} onClick={() => aprobar(e, true)}>Aprobar como proveedor (sin stand)</button>
              <button className="btn-secundario text-[#B0103F]" disabled={ocupado === e.id} onClick={() => rechazar(e)}>Rechazar</button>
            </div>
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Expositores y proveedores aprobados ({aprobadas.length})</h2>
        {aprobadas.length === 0 && <p className="text-sm text-tinta-suave">Todavía no hay empresas aprobadas.</p>}
        {aprobadas.map((e) => (
          <article key={e.id} className="tarjeta space-y-3 p-5">
            <div>
              <h3 className="font-extrabold">{e.nombre} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${e.stand ? 'bg-naranja text-tinta' : 'bg-turquesa/30 text-tinta'}`}>{e.stand ? `Expositor · Stand ${e.stand}` : 'Proveedor / servicio'}</span></h3>
              <ul className="mt-1 text-sm">
                {e.personas.map((p) => <li key={p.id}>{p.nombre}{p.cargo ? ` · ${p.cargo}` : ''} · {p.email}</li>)}
              </ul>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm"><span className="etiqueta">Stand</span>
                <input className="campo w-32" value={stands[e.id] ?? e.stand ?? ''} onChange={(ev) => setStands({ ...stands, [e.id]: ev.target.value })} maxLength={20} placeholder="Sin stand" /></label>
              <button className="btn-secundario" disabled={ocupado === e.id} onClick={() => cambiarStand(e)}>Guardar stand</button>
              <button className="btn-secundario text-[#B0103F]" disabled={ocupado === e.id} onClick={() => quitar(e)}>Volver a asistente</button>
            </div>
            <p className="text-xs text-tinta-suave">Con stand = Expositor (primero en el feed). Sin stand = Proveedor / servicio. Al cambiar el stand, las personas de la empresa cambian de etiqueta al instante.</p>
          </article>
        ))}
      </section>
    </div>
  )
}
