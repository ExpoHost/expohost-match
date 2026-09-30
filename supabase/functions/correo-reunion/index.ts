// Edge Function: correo de confirmación (con .ics) o de cancelación de una reunión, a ambas personas.
// La llama la app justo después de reservar_reunion / cancelar_reunion. Solo un participante
// de la reunión puede pedir el envío. Sin RESEND_API_KEY no envía nada (responde 200 y lo dice).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const APP_URL = Deno.env.get('APP_URL') ?? 'https://match.expohost.travel'
const FROM = Deno.env.get('RESEND_FROM') ?? 'Expohost Match <match@match.expohost.travel>'

const DIAS: Record<string, string> = { '2026-10-06': 'martes 6 de octubre', '2026-10-07': 'miércoles 7 de octubre' }
const hora = (t: string) => t.slice(0, 5)
const horaFin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  const total = h * 60 + m + 25
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

type Persona = { id: string; nombre: string; cargo: string | null; empresa: string | null; email: string }
type Reunion = { id: string; estado: string; lugar: string; mesa: number | null; stand: string | null; dia: string; inicio: string }

const lugarTexto = (r: Reunion) => (r.lugar === 'stand' ? `Stand ${r.stand}` : `Zona Match · Mesa ${r.mesa}`)

// Bogotá es UTC-5 todo el año
function ics(r: Reunion, otro: Persona) {
  const utc = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return `${r.dia.replaceAll('-', '')}T${String(h + 5).padStart(2, '0')}${String(m).padStart(2, '0')}00Z`
  }
  const e = (s: string) => s.replace(/[\\;,]/g, (c) => '\\' + c)
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Expohost//Match//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${r.id}@match.expohost.travel`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${utc(r.inicio)}`, `DTEND:${utc(horaFin(r.inicio))}`,
    `SUMMARY:${e(`Reunión con ${otro.nombre}${otro.empresa ? ` (${otro.empresa})` : ''} · Expohost Match`)}`,
    `LOCATION:${e(`${lugarTexto(r)} · ExpoHost Bogotá 2026 · Gimnasio Moderno`)}`,
    `DESCRIPTION:${e('Reunión agendada en Expohost Match. En la feria entra con tus datos móviles.')}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}

function html(titulo: string, parrafos: string[], cta: { texto: string; url: string }, detalle?: string[]) {
  const p = (t: string) => `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#4A4B58;">${t}</p>`
  const caja = detalle
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td style="background:#F7F8FC;border-radius:16px;padding:18px 20px;font-family:Montserrat,Arial,Helvetica,sans-serif;">${detalle.map((d, i) => `<p style="margin:0;font-size:${i === 0 ? 18 : 15}px;line-height:1.5;font-weight:${i === 0 ? 800 : 600};color:${i === 0 ? '#0D0D16' : '#0049FE'};">${d}</p>`).join('')}</td></tr></table>`
    : ''
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(titulo)}</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#F7F8FC;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F8FC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="${APP_URL}/correo/arcos.png" width="74" height="24" alt="" style="display:block;border:0;"></td>
<td style="vertical-align:middle;font-family:Montserrat,Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;color:#0D0D16;">EXPOHOST <span style="color:#0049FE;">MATCH</span></td></tr></table></td></tr>
<tr><td style="background:#FFFFFF;border-radius:22px;padding:36px 28px;font-family:Montserrat,Arial,Helvetica,sans-serif;color:#0D0D16;">
<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;font-weight:800;color:#0D0D16;">${esc(titulo)}</h1>
${parrafos.map(p).join('')}${caja}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><a href="${cta.url}" style="display:inline-block;background:#0049FE;color:#FFFFFF;text-decoration:none;font-family:Montserrat,Arial,Helvetica,sans-serif;font-weight:700;font-size:16px;line-height:1;padding:17px 32px;border-radius:999px;">${esc(cta.texto)}</a></td></tr></table>
</td></tr>
<tr><td style="padding:20px 8px 0 8px;font-family:Montserrat,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#4A4B58;text-align:center;">ExpoHost Bogotá 2026 · 6 y 7 de octubre · Gimnasio Moderno<br>Expohost SAS · NIT 901702368-6 · <a href="https://www.expohost.travel/tratamientodedatos" style="color:#4A4B58;">Tratamiento de datos</a></td></tr>
</table></td></tr></table></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const quien = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: { user } } = await quien.auth.getUser()
  if (!user) return json({ error: 'no autenticado' }, 401)

  const { meeting_id, tipo } = await req.json().catch(() => ({}))
  if (typeof meeting_id !== 'string' || !['confirmada', 'cancelada'].includes(tipo)) return json({ error: 'datos incompletos' }, 400)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: mt } = await admin.from('meetings')
    .select('id, estado, lugar, mesa, stand, cancelada_por, correo_confirmacion_at, correo_cancelacion_at, match:matches(user_a, user_b), block:blocks(dia, inicio)')
    .eq('id', meeting_id).maybeSingle()
  const match = mt?.match as unknown as { user_a: string; user_b: string } | null
  const block = mt?.block as unknown as { dia: string; inicio: string } | null
  if (!mt || !match || !block) return json({ error: 'reunión no encontrada' }, 404)
  if (user.id !== match.user_a && user.id !== match.user_b && user.app_metadata?.role !== 'admin') return json({ error: 'no autorizado' }, 403)
  if (mt.estado !== tipo) return json({ error: 'el estado de la reunión no coincide' }, 409)
  // Un solo correo por reunión y por tipo (evita reenvíos repetidos y gasto del cupo de Resend)
  const columna = tipo === 'confirmada' ? 'correo_confirmacion_at' : 'correo_cancelacion_at'
  if ((mt as Record<string, unknown>)[columna]) return json({ enviado: false, motivo: 'ya se envió' })

  const ids = [match.user_a, match.user_b]
  const [{ data: perfiles }, { data: privados }] = await Promise.all([
    admin.from('profiles').select('id, nombre, cargo, company:companies(nombre)').in('id', ids),
    admin.from('profiles_private').select('user_id, email').in('user_id', ids),
  ])
  const personas: Persona[] = ids.map((id) => {
    const p = perfiles?.find((x) => x.id === id)
    return { id, nombre: p?.nombre ?? 'Participante', cargo: p?.cargo ?? null,
      empresa: (p?.company as unknown as { nombre: string } | null)?.nombre ?? null,
      email: privados?.find((x) => x.user_id === id)?.email ?? '' }
  })
  const reunion: Reunion = { id: mt.id, estado: mt.estado, lugar: mt.lugar, mesa: mt.mesa, stand: mt.stand, dia: block.dia, inicio: block.inicio }

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return json({ enviado: false, motivo: 'RESEND_API_KEY no configurada todavía' })

  const cuando = `${DIAS[reunion.dia] ?? reunion.dia}, ${hora(reunion.inicio)} – ${horaFin(reunion.inicio)}`
  const lugar = esc(lugarTexto(reunion))  // el stand es texto libre del registro
  const resultados = []
  for (const yo of personas) {
    const otro = personas.find((p) => p.id !== yo.id)!
    if (!yo.email || yo.email.endsWith('@expohost.invalid')) continue
    const quien = `<strong style="color:#0D0D16;">${esc(otro.nombre)}</strong>${otro.empresa ? ` (${esc(otro.empresa)})` : ''}`
    const correo = tipo === 'confirmada'
      ? {
          subject: `Reunión confirmada · ${cuando} · ${lugarTexto(reunion)}`,
          html: html('Tu reunión quedó confirmada', [
            `Tienes una reunión con ${quien} en ExpoHost Bogotá 2026. Llega 5 minutos antes al lugar indicado.`,
            'Si no puedes ir, cancélala desde la app para liberar el espacio. El archivo adjunto agrega la reunión a tu calendario.',
          ], { texto: 'Ver mi agenda', url: `${APP_URL}/#/agenda` }, [cuando, lugar, 'Gimnasio Moderno, Bogotá']),
          attachments: [{ filename: 'reunion-expohost.ics', content: btoa(unescape(encodeURIComponent(ics(reunion, otro)))) }],
          texto: `Reunión confirmada con ${otro.nombre}: ${cuando}, ${lugarTexto(reunion)}. Agenda: ${APP_URL}/#/agenda`,
        }
      : {
          subject: `Reunión cancelada · ${cuando}`,
          html: html('Tu reunión fue cancelada', [
            `${mt.cancelada_por === yo.id ? 'Cancelaste' : mt.cancelada_por === otro.id ? `${quien} canceló` : 'La organización canceló'} la reunión del ${cuando} en ${lugar}. El horario quedó libre.`,
            'Si quieren verse, pueden elegir otro horario desde la app.',
          ], { texto: 'Elegir otro horario', url: `${APP_URL}/#/agenda` }),
          attachments: [],
          texto: `Reunión cancelada con ${otro.nombre} (${cuando}). Elige otro horario: ${APP_URL}/#/agenda`,
        }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [yo.email], subject: correo.subject, html: correo.html, text: correo.texto, attachments: correo.attachments }),
    })
    resultados.push({ para: yo.id, ok: r.ok, estado: r.status })
  }
  if (resultados.some((r) => r.ok)) await admin.from('meetings').update({ [columna]: new Date().toISOString() }).eq('id', mt.id)
  return json({ enviado: true, resultados })
})
