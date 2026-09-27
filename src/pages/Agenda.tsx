import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Aviso, Avatar, Pantalla } from '../components/ui'
import { NotaLead } from '../components/NotaLead'
import { descargarCsv } from '../lib/csv'
import { useSesion } from '../lib/sesion'
import { supabase } from '../lib/supabase'
import { avisarReunion } from '../lib/correos'
import { descargarIcs, diaTexto, googleCalendarUrl, hora, horaFin, lugarTexto, whatsappUrl, type MiMatch } from '../lib/reuniones'
import { mensajeError } from '../lib/utilidades'

export default function Agenda() {
  const [items, setItems] = useState<MiMatch[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('mis_matches')
    if (error) setError(mensajeError(error)); else { setItems(data); setError(null) }
  }, [])
  // Se recarga al entrar y cada 30 segundos (sin Realtime)
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 30_000)
    return () => clearInterval(t)
  }, [cargar])

  const reuniones = items?.filter((i) => i.meeting_id) ?? []
  const porAgendar = items?.filter((i) => !i.meeting_id) ?? []
  const { perfil } = useSesion()
  const esEmpresa = perfil?.empresa?.tipo === 'expositor'

  // Expositores y proveedores: sus matches con contacto y notas, en CSV (cada contacto queda auditado)
  async function exportar() {
    if (!items) return
    const [{ data: notas }, contactos] = await Promise.all([
      supabase.from('lead_notes').select('about_id, texto'),
      Promise.all(items.map((m) => supabase.rpc('contacto_de', { p_user: m.otro_id }).then((r) => r.data?.[0] ?? null))),
    ])
    descargarCsv('mis-matches', items.map((m, i) => ({
      nombre: m.nombre, cargo: m.cargo, empresa: m.empresa, correo: contactos[i]?.email, celular: contactos[i]?.telefono,
      reunion: m.dia ? `${diaTexto(m.dia)} ${hora(m.inicio!)} · ${lugarTexto(m)}` : 'sin agendar',
      notas: notas?.find((n) => n.about_id === m.otro_id)?.texto ?? '',
    })))
  }

  return (
    <Pantalla nav>
      <h1 className="text-2xl font-extrabold">Mi agenda</h1>
      <p className="mt-1 text-sm text-tinta-suave">Aquí están tus reuniones de la feria, con el lugar y la hora. ExpoHost Bogotá 2026 · Gimnasio Moderno.</p>
      {esEmpresa && items && items.length > 0 && (
        <button className="btn-secundario mt-3 text-sm" onClick={exportar}>Descargar mis contactos (Excel)</button>
      )}
      {error && <div className="mt-4"><Aviso>{error}</Aviso></div>}
      {items === null && !error && <p className="mt-6 text-tinta-suave" role="status">Cargando…</p>}

      {items && items.length === 0 && (
        <div className="tarjeta mt-6 p-6 text-center">
          <p className="font-bold">Aún no tienes reuniones</p>
          <p className="mt-1 text-sm text-tinta-suave">Cuando tú y otra persona se marquen con ♥, aparecerá aquí para que elijan la hora de la reunión.</p>
          <Link to="/descubrir" className="btn-primario mt-5 w-full">Ver perfiles</Link>
        </div>
      )}

      {reuniones.length > 0 && (
        <section className="mt-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-tinta-suave">Tus reuniones confirmadas ({reuniones.length})</h2>
          {reuniones.map((r) => <Reunion key={r.meeting_id} r={r} onCambio={cargar} />)}
        </section>
      )}

      {porAgendar.length > 0 && (
        <section className="mt-8 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-tinta-suave">Quieren reunirse contigo · falta elegir horario ({porAgendar.length})</h2>
          {porAgendar.map((m) => (
            <Link key={m.match_id} to={`/match/${m.match_id}`} className="tarjeta flex items-center gap-4 p-4">
              <Avatar path={m.foto_path} nombre={m.nombre} tam="h-12 w-12 text-base" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{m.nombre}</span>
                <span className="block truncate text-sm text-tinta-suave">{m.empresa}</span>
              </span>
              <span className="shrink-0 text-sm font-bold text-azul">Elegir horario</span>
            </Link>
          ))}
        </section>
      )}
    </Pantalla>
  )
}

function Reunion({ r, onCambio }: { r: MiMatch; onCambio: () => void }) {
  const [contacto, setContacto] = useState<{ email: string; telefono: string | null } | null>(null)
  const [confirmarCancelar, setConfirmarCancelar] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function verContacto() {
    const { data, error } = await supabase.rpc('contacto_de', { p_user: r.otro_id })
    if (error) setError(mensajeError(error)); else setContacto(data?.[0] ?? null)
  }

  async function cancelar() {
    if (cancelando) return
    setCancelando(true)
    const { error } = await supabase.rpc('cancelar_reunion', { p_meeting: r.meeting_id })
    if (error) { setError(mensajeError(error)); setCancelando(false); return }
    avisarReunion(r.meeting_id!, 'cancelada')
    onCambio()
  }

  return (
    <article className="tarjeta p-5">
      <p className="text-sm font-bold text-azul">{diaTexto(r.dia!)} · {hora(r.inicio!)} – {horaFin(r.inicio!)}</p>
      <p className="text-sm font-semibold">{lugarTexto(r)}</p>
      <div className="mt-3 flex items-center gap-3">
        <Avatar path={r.foto_path} nombre={r.nombre} tam="h-12 w-12 text-base" />
        <div className="min-w-0">
          <p className="truncate font-bold">{r.nombre}</p>
          <p className="truncate text-sm text-tinta-suave">{[r.cargo, r.empresa].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {error && <div className="mt-3"><Aviso>{error}</Aviso></div>}

      {contacto ? (
        <div className="mt-4 space-y-2">
          {contacto.telefono && (
            <a href={whatsappUrl(contacto.telefono, r.nombre)} target="_blank" rel="noopener noreferrer" className="btn w-full bg-[#1FA855] text-white">Escribir por WhatsApp</a>
          )}
          <a href={`mailto:${contacto.email}`} className="btn-secundario w-full">{contacto.email}</a>
        </div>
      ) : (
        <button className="btn-secundario mt-4 w-full" onClick={verContacto}>Ver contacto</button>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <a href={googleCalendarUrl({ ...r, dia: r.dia!, inicio: r.inicio! })} target="_blank" rel="noopener noreferrer" className="btn-secundario px-3 text-sm">Google Calendar</a>
        <button className="btn-secundario px-3 text-sm" onClick={() => descargarIcs({ ...r, meeting_id: r.meeting_id!, dia: r.dia!, inicio: r.inicio! })}>Otro calendario (.ics)</button>
      </div>
      <div className="mt-2">
        {confirmarCancelar
          ? <button className="btn w-full border border-rosa bg-rosa/10 px-3 text-sm text-[#B0103F]" onClick={cancelar} disabled={cancelando}>{cancelando ? 'Cancelando…' : 'Sí, cancelar la reunión'}</button>
          : <button className="btn-secundario w-full px-3 text-sm" onClick={() => setConfirmarCancelar(true)}>Cancelar reunión</button>}
      </div>
      <NotaLead aboutId={r.otro_id} />
      {confirmarCancelar && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-tinta-suave">
          <span>Se liberará el horario y le avisaremos a {r.nombre.split(' ')[0]} por correo.</span>
          <button className="inline-flex min-h-11 items-center font-semibold text-azul" onClick={() => setConfirmarCancelar(false)}>No cancelar</button>
        </p>
      )}
    </article>
  )
}
