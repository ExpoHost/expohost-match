import { useEffect, useState } from 'react'
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

// Según la lista oficial, a quién pertenece el stand declarado (no se aprobó solo porque el correo no coincidió)
function PistaStand({ stand }: { stand: string }) {
  const [pista, setPista] = useState<string | null | undefined>(undefined)
  useEffect(() => { supabase.rpc('admin_pista_stand', { p_stand: stand }).then(({ data }) => setPista(data ?? null)) }, [stand])
  if (pista === undefined) return null
  return <p className={`mt-1 text-xs font-semibold ${pista ? 'text-[#8A4500]' : 'text-tinta-suave'}`}>{pista ? `Según la lista, el stand ${stand} es de: ${pista}. El correo no coincide: revisa antes de aprobar.` : `El stand ${stand} no está en la lista oficial.`}</p>
}

export default function Solicitudes({ participantes, recargar }: { participantes: Participante[] | null; recargar: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [stands, setStands] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  // confirmación visible dentro de la tarjeta de la empresa sobre la que se actuó
  const [hecho, setHecho] = useState<{ id: string; texto: string; ok: boolean } | null>(null)
  if (!participantes) return <p className="text-tinta-suave" role="status">Cargando…</p>

  const empresas = agrupar(participantes)
  const pendientes = empresas.filter((e) => e.solicitud && e.tipo !== 'expositor')
  const aprobadas = empresas.filter((e) => e.tipo === 'expositor')

  async function accion(id: string, fn: () => PromiseLike<{ error: unknown }>, listo: string) {
    setOcupado(id); setError(null); setHecho(null)
    const { error } = await fn()
    if (error) { setError(mensajeError(error)); setHecho({ id, texto: mensajeError(error), ok: false }) }
    else { await recargar(); setHecho({ id, texto: listo, ok: true }) }
    setOcupado(null)
  }
  const aprobar = (e: Empresa, comoProveedor: boolean) =>
    accion(e.id, () => supabase.rpc('aprobar_expositor', { p_company: e.id, p_stand: stands[e.id] ?? e.stand_declarado ?? '', p_como_proveedor: comoProveedor }),
      comoProveedor ? `Listo: ${e.nombre} quedó aprobada como proveedor, sin stand.` : `Listo: ${e.nombre} quedó aprobada como expositor.`)
  const rechazar = (e: Empresa) => window.confirm(`¿Rechazar la solicitud de ${e.nombre}? Seguirá en la app como asistente.`) && accion(e.id, () => supabase.rpc('rechazar_solicitud', { p_company: e.id }), `${e.nombre} quedó como asistente.`)
  const quitar = (e: Empresa) => window.confirm(`¿Quitar a ${e.nombre} de los expositores? Sus personas quedarán como asistentes.`) && accion(e.id, () => supabase.rpc('quitar_expositor', { p_company: e.id }), `${e.nombre} volvió a ser asistente.`)
  // Corregir el stand de una empresa ya aprobada. Usa la misma función de aprobar para que las personas
  // de la empresa queden con la etiqueta y la prioridad correctas (con stand = expositor; sin stand = proveedor).
  const cambiarStand = (e: Empresa) => {
    const nuevo = (stands[e.id] ?? e.stand ?? '').trim()
    if (nuevo === (e.stand ?? '')) {
      setHecho({ id: e.id, ok: true, texto: nuevo ? `${e.nombre} ya tiene el stand ${nuevo}: no había nada que cambiar. Para corregirlo, escribe el número nuevo en la casilla y toca "Guardar stand".` : `${e.nombre} ya está sin stand: no había nada que cambiar.` })
      return
    }
    return accion(e.id, () => supabase.rpc('aprobar_expositor', { p_company: e.id, p_stand: nuevo, p_como_proveedor: nuevo === '' }),
      nuevo ? `Guardado: ${e.nombre} ahora aparece en el stand ${nuevo}.` : `Guardado: ${e.nombre} quedó sin stand, como proveedor / servicio.`)
  }
  const Hecho = ({ id }: { id: string }) => (hecho?.id === id ? <Aviso tipo={hecho.ok ? 'ok' : 'error'}>{hecho.texto}</Aviso> : null)

  return (
    <div className="space-y-8">
      {error && <Aviso>{error}</Aviso>}
      {hecho?.ok && <Aviso tipo="ok">{hecho.texto}</Aviso>}
      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Empresas que esperan tu aprobación ({pendientes.length})</h2>
        <Aviso tipo="info">
          Aquí solo llegan las empresas que al registrarse dijeron ser expositoras y que la app no pudo comprobar con la lista oficial de stands.
          Los expositores que invitaste por correo y los que coinciden con la lista quedan aprobados solos: con ellos no tienes que hacer nada.
          Los asistentes tampoco necesitan aprobación.
        </Aviso>
        {pendientes.length === 0 && <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm font-semibold">No hay nadie por aprobar.</p>}
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
              {e.stand_declarado && <PistaStand stand={e.stand_declarado} />}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm"><span className="etiqueta">Stand</span>
                <input className="campo w-32" value={stands[e.id] ?? e.stand_declarado ?? ''} onChange={(ev) => setStands({ ...stands, [e.id]: ev.target.value })} maxLength={20} placeholder="A-12" /></label>
              <button className="btn-primario" disabled={ocupado === e.id} onClick={() => aprobar(e, false)}>Aprobar como expositor</button>
              <button className="btn-secundario" disabled={ocupado === e.id} onClick={() => aprobar(e, true)}>Aprobar como proveedor (sin stand)</button>
              <button className="btn-secundario text-[#B0103F]" disabled={ocupado === e.id} onClick={() => rechazar(e)}>Rechazar</button>
            </div>
            <Hecho id={e.id} />
            <p className="text-xs text-tinta-suave">Si rechazas, la persona sigue en la app como asistente. Para que no pueda entrar, búscala en "Personas" y toca "Sacar de la app".</p>
          </article>
        ))}
      </section>

      <details className="space-y-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-lg font-extrabold">Empresas ya aprobadas ({aprobadas.length}) · ver o corregir el stand</summary>
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
            <Hecho id={e.id} />
            <p className="text-xs text-tinta-suave">"Guardar stand" solo sirve para corregir el número de stand: escribe el nuevo y toca el botón. Con stand = Expositor (primero en Perfiles). Si dejas la casilla vacía, queda como Proveedor / servicio.</p>
          </article>
        ))}
      </details>
    </div>
  )
}
