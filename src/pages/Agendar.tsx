import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Aviso, Avatar, Pantalla } from '../components/ui'
import { NotaLead } from '../components/NotaLead'
import { supabase } from '../lib/supabase'
import { descargarIcs, diaTexto, googleCalendarUrl, hora, horaFin, lugarTexto, type MiMatch, type Propuesta } from '../lib/reuniones'
import { avisarReunion } from '../lib/correos'
import { mensajeError } from '../lib/utilidades'

// Después del match: 3 horarios donde ambos están libres y hay lugar. Un toque confirma.
export default function Agendar() {
  const { id } = useParams()
  const [m, setM] = useState<MiMatch | null>(null)
  const [noExiste, setNoExiste] = useState(false)
  const [propuestas, setPropuestas] = useState<Propuesta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reservando, setReservando] = useState<number | null>(null)
  const [confirmarDeshacer, setConfirmarDeshacer] = useState(false)
  const [enEspera, setEnEspera] = useState<number | null>(null)
  const navigate = useNavigate()

  async function deshacer() {
    const { data, error } = await supabase.rpc('deshacer_match', { p_match: id })
    if (error) { setError(mensajeError(error)); setConfirmarDeshacer(false); return }
    if (data) avisarReunion(data, 'cancelada')
    navigate('/descubrir', { replace: true })
  }

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('mis_matches')
    if (error) { setError(mensajeError(error)); return }
    const encontrado = (data as MiMatch[]).find((x) => x.match_id === id) ?? null
    setM(encontrado)
    setNoExiste(!encontrado)
    if (encontrado && !encontrado.meeting_id) {
      const r = await supabase.rpc('propuestas', { p_match: id })
      if (r.error) setError(mensajeError(r.error)); else setPropuestas(r.data)
    }
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  async function reservar(p: Propuesta) {
    setReservando(p.block_id); setError(null)
    const { data, error } = await supabase.rpc('reservar_reunion', { p_match: id, p_block: p.block_id })
    setReservando(null)
    if (error) { setError(mensajeError(error)); setPropuestas(null); cargar(); return } // el horario se ocupó: nuevas propuestas
    avisarReunion(data, 'confirmada')
    cargar()
  }

  if (!m) return (
    <Pantalla nav volver="/agenda">
      {error ? <Aviso>{error}</Aviso>
        : noExiste ? <div className="space-y-4"><Aviso tipo="info">No encontramos este match. Puede que se haya deshecho.</Aviso><Link to="/agenda" className="btn-primario w-full">Ver mi agenda</Link></div>
        : <p className="text-tinta-suave" role="status">Cargando…</p>}
    </Pantalla>
  )

  return (
    <Pantalla nav volver="/agenda">
      <div className="flex items-center gap-4">
        <Avatar path={m.foto_path} nombre={m.nombre} />
        <div>
          <p className="text-sm font-semibold text-[#B0103F]">Interés mutuo</p>
          <h1 className="text-xl font-extrabold leading-tight">{m.nombre}</h1>
          <p className="text-sm text-tinta-suave">{[m.cargo, m.empresa].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      {m.meeting_id && m.dia && m.inicio ? (
        <section className="tarjeta mt-6 p-6">
          <p className="text-sm font-semibold text-[#006B6B]">Reunión confirmada</p>
          <p className="mt-2 text-xl font-extrabold">{diaTexto(m.dia)}</p>
          <p className="text-lg">{hora(m.inicio)} – {horaFin(m.inicio)}</p>
          <p className="mt-1 font-semibold text-azul">{lugarTexto(m)}</p>
          <p className="mt-4 text-sm text-tinta-suave">Les enviaremos un correo con los detalles a ambos. En la feria entra con tus datos móviles.</p>
          <a href={googleCalendarUrl({ ...m, dia: m.dia!, inicio: m.inicio! })} target="_blank" rel="noopener noreferrer" className="btn-secundario mt-5 w-full">Agregar a Google Calendar</a>
          <button className="btn-secundario mt-3 w-full" onClick={() => descargarIcs({ ...m, meeting_id: m.meeting_id!, dia: m.dia!, inicio: m.inicio! })}>Otro calendario (.ics)</button>
          <Link to="/agenda" className="btn-primario mt-3 w-full">Ver mi agenda</Link>
        </section>
      ) : (
        <section className="mt-6">
          <h2 className="text-lg font-extrabold">Elige la hora de la reunión</h2>
          <p className="mt-1 text-sm text-tinta-suave">Estas son las primeras horas en que los dos están libres. Toca "Confirmar" en la que prefieras: queda reservada y les llega un correo a ambos.</p>
          {error && <div className="mt-4"><Aviso>{error}</Aviso></div>}
          <div className="mt-4 space-y-3">
            {propuestas === null && <p className="text-tinta-suave" role="status">Buscando horarios…</p>}
            {propuestas?.length === 0 && (
              <div className="space-y-3">
                <Aviso tipo="info">No encontramos un horario libre para ambos. Revisa tus franjas de disponibilidad en <Link to="/perfil/editar" className="inline-flex min-h-11 items-center font-semibold underline">tu perfil</Link> o intenta más tarde.</Aviso>
                {enEspera === null
                  ? <button className="btn-secundario w-full" onClick={async () => { const { data, error } = await supabase.rpc('lista_de_espera', { p_match: id }); if (error) setError(mensajeError(error)); else setEnEspera(data ?? 0) }}>Anotarme en la lista de espera</button>
                  : <Aviso tipo="ok">Quedaste en la lista de espera. Si se libera un horario, la organización te avisará en la feria.</Aviso>}
              </div>
            )}
            {propuestas?.map((p) => (
              <button key={p.block_id} onClick={() => reservar(p)} disabled={reservando !== null}
                className="tarjeta flex w-full items-center justify-between gap-4 p-5 text-left transition hover:ring-2 hover:ring-azul/30 disabled:opacity-60">
                <span>
                  <span className="block font-extrabold">{diaTexto(p.dia)}</span>
                  <span className="block">{hora(p.inicio)} – {horaFin(p.inicio)}</span>
                  <span className="block text-sm font-semibold text-azul">{lugarTexto(p)}</span>
                </span>
                <span className="shrink-0 rounded-full bg-azul px-4 py-2 text-sm font-bold text-white">{reservando === p.block_id ? '…' : 'Confirmar'}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <NotaLead aboutId={m.otro_id} />

      <section className="mt-10 border-t border-linea pt-6">
        {confirmarDeshacer ? (
          <div className="space-y-3">
            <p className="text-sm text-tinta-suave">
              Se quitará el match{m.meeting_id ? ' y se cancelará la reunión' : ''}. {m.nombre.split(' ')[0]} volverá a aparecer en Perfiles y, si le das ♥ otra vez, el match se rehace.
            </p>
            <div className="flex gap-3">
              <button className="btn-secundario flex-1" onClick={() => setConfirmarDeshacer(false)}>No, dejarlo</button>
              <button className="btn flex-1 border border-rosa bg-rosa/10 text-[#B0103F]" onClick={deshacer}>Sí, deshacer</button>
            </div>
          </div>
        ) : (
          <button className="min-h-11 text-sm font-semibold text-tinta-suave" onClick={() => setConfirmarDeshacer(true)}>Deshacer este match</button>
        )}
      </section>
    </Pantalla>
  )
}
