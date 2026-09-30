import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Aviso, Pantalla } from '../components/ui'
import { supabase } from '../lib/supabase'
import { diaTexto, hora, horaFin } from '../lib/reuniones'

// Pantallas a las que llegan los botones de los correos ("Confirmo" y la encuesta). No piden sesión:
// el enlace trae una firma. La acción solo ocurre al tocar el botón de la pantalla, así un escáner
// de correo que abre el enlace no confirma ni responde nada.
async function llamar(funcion: string, body: Record<string, string>) {
  const { data, error } = await supabase.functions.invoke(funcion, { body })
  if (error) return { ok: false, motivo: 'red' } as const
  return data as { ok: boolean; motivo?: string; dia?: string; inicio?: string; lugar?: string; util?: boolean }
}
const MOTIVOS: Record<string, string> = {
  incompleto: 'El enlace está incompleto. Abre el correo de nuevo y toca el botón.',
  firma: 'Este enlace no corresponde a tu reunión. Confirma desde Mi agenda.',
  no_existe: 'No encontramos esta reunión. Puede que se haya cancelado.',
  cancelada: 'Esta reunión fue cancelada. Revisa Mi agenda para elegir otro horario.',
  red: 'Sin conexión. Revisa tus datos móviles e inténtalo de nuevo.',
}

export function ConfirmarReunion() {
  const [p] = useSearchParams()
  const [estado, setEstado] = useState<'inicio' | 'enviando' | 'listo'>('inicio')
  const [error, setError] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<{ dia?: string; inicio?: string; lugar?: string } | null>(null)

  async function confirmar() {
    setEstado('enviando'); setError(null)
    const r = await llamar('confirmar-reunion', { m: p.get('m') ?? '', u: p.get('u') ?? '', t: p.get('t') ?? '' })
    if (!r.ok) { setError(MOTIVOS[r.motivo ?? ''] ?? 'No pudimos confirmar. Inténtalo de nuevo.'); setEstado('inicio'); return }
    setDetalle(r); setEstado('listo')
  }

  return (
    <Pantalla>
      <div className="space-y-5">
        {estado === 'listo' ? (
          <>
            <h1 className="text-2xl font-extrabold">Confirmado, gracias</h1>
            {detalle?.dia && detalle.inicio && <p className="tarjeta p-5"><span className="block font-extrabold">{diaTexto(detalle.dia)}</span><span className="block">{hora(detalle.inicio)} – {horaFin(detalle.inicio)}</span><span className="block font-semibold text-azul">{detalle.lugar}</span></p>}
            <p className="text-tinta-suave">Le avisamos a la organización que vas. Llega 5 minutos antes. Nos vemos en ExpoHost Bogotá.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold">¿Confirmas tu reunión?</h1>
            <p className="text-tinta-suave">Toca el botón para avisar que sí vas. Si no puedes ir, cancélala desde Mi agenda para liberar el espacio.</p>
            {error && <Aviso>{error}</Aviso>}
            <button className="btn-primario w-full" onClick={confirmar} disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Confirmando…' : 'Sí, confirmo'}</button>
          </>
        )}
        <Link to="/agenda" className="btn-secundario w-full">Ir a mi agenda</Link>
      </div>
    </Pantalla>
  )
}

export function Encuesta() {
  const [p] = useSearchParams()
  const [respuesta, setRespuesta] = useState<'si' | 'no' | null>(p.get('r') === 'si' ? 'si' : p.get('r') === 'no' ? 'no' : null)
  const [estado, setEstado] = useState<'inicio' | 'enviando' | 'listo'>('inicio')
  const [error, setError] = useState<string | null>(null)

  async function enviar(r: 'si' | 'no') {
    setRespuesta(r); setEstado('enviando'); setError(null)
    const res = await llamar('responder-encuesta', { m: p.get('m') ?? '', u: p.get('u') ?? '', t: p.get('t') ?? '', r })
    if (!res.ok) { setError(MOTIVOS[res.motivo ?? ''] ?? 'No pudimos guardar tu respuesta. Inténtalo de nuevo.'); setEstado('inicio'); return }
    setEstado('listo')
  }

  return (
    <Pantalla>
      <div className="space-y-5">
        {estado === 'listo' ? (
          <>
            <h1 className="text-2xl font-extrabold">Gracias por tu respuesta</h1>
            <p className="text-tinta-suave">{respuesta === 'si' ? 'Nos alegra que la reunión haya sido útil. Nos vemos en la próxima edición.' : 'Gracias por contarnos. Lo tendremos en cuenta para mejorar.'}</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold">¿La reunión fue útil?</h1>
            <p className="text-tinta-suave">Una sola pregunta. Tu respuesta nos ayuda a mejorar Expohost Match.</p>
            {error && <Aviso>{error}</Aviso>}
            <div className="grid grid-cols-2 gap-3">
              <button className={respuesta === 'si' ? 'btn-primario' : 'btn-secundario'} disabled={estado === 'enviando'} onClick={() => enviar('si')}>Sí, fue útil</button>
              <button className={respuesta === 'no' ? 'btn-primario' : 'btn-secundario'} disabled={estado === 'enviando'} onClick={() => enviar('no')}>No</button>
            </div>
            {respuesta && estado === 'inicio' && !error && <p className="text-sm text-tinta-suave">Toca tu respuesta para enviarla.</p>}
          </>
        )}
      </div>
    </Pantalla>
  )
}
