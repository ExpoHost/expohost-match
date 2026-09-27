import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Aviso, Avatar, Pantalla } from '../components/ui'
import { supabase } from '../lib/supabase'
import { avisarReunion } from '../lib/correos'
import { descargarIcs, diaTexto, hora, horaFin, lugarTexto, whatsappUrl, type MiMatch } from '../lib/reuniones'
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

  return (
    <Pantalla nav>
      <h1 className="text-2xl font-extrabold">Mi agenda</h1>
      <p className="mt-1 text-sm text-tinta-suave">ExpoHost Bogotá 2026 · Gimnasio Moderno. En la feria entra con tus datos móviles.</p>
      {error && <div className="mt-4"><Aviso>{error}</Aviso></div>}
      {items === null && !error && <p className="mt-6 text-tinta-suave" role="status">Cargando…</p>}

      {items && items.length === 0 && (
        <div className="tarjeta mt-6 p-6 text-center">
          <p className="font-bold">Aún no tienes matches</p>
          <p className="mt-1 text-sm text-tinta-suave">Cuando a alguien que te interesa también le intereses, aparecerá aquí para agendar.</p>
          <Link to="/descubrir" className="btn-primario mt-5 w-full">Descubrir perfiles</Link>
        </div>
      )}

      {reuniones.length > 0 && (
        <section className="mt-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-tinta-suave">Reuniones ({reuniones.length})</h2>
          {reuniones.map((r) => <Reunion key={r.meeting_id} r={r} onCambio={cargar} />)}
        </section>
      )}

      {porAgendar.length > 0 && (
        <section className="mt-8 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-tinta-suave">Matches por agendar ({porAgendar.length})</h2>
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
  const [error, setError] = useState<string | null>(null)

  async function verContacto() {
    const { data, error } = await supabase.rpc('contacto_de', { p_user: r.otro_id })
    if (error) setError(mensajeError(error)); else setContacto(data?.[0] ?? null)
  }

  async function cancelar() {
    const { error } = await supabase.rpc('cancelar_reunion', { p_meeting: r.meeting_id })
    if (error) { setError(mensajeError(error)); return }
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
        <button className="btn-secundario px-3 text-sm" onClick={() => descargarIcs({ ...r, meeting_id: r.meeting_id!, dia: r.dia!, inicio: r.inicio! })}>Al calendario</button>
        {confirmarCancelar
          ? <button className="btn border border-rosa bg-rosa/10 px-3 text-sm text-[#B0103F]" onClick={cancelar}>Sí, cancelar</button>
          : <button className="btn-secundario px-3 text-sm" onClick={() => setConfirmarCancelar(true)}>Cancelar reunión</button>}
      </div>
      {confirmarCancelar && (
        <p className="mt-2 text-xs text-tinta-suave">
          Se liberará el horario y le avisaremos a {r.nombre.split(' ')[0]} por correo.{' '}
          <button className="font-semibold text-azul" onClick={() => setConfirmarCancelar(false)}>No cancelar</button>
        </p>
      )}
    </article>
  )
}
