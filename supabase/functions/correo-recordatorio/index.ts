// Edge Function: correo de seguimiento a quien dejó su registro a la mitad.
// La dispara pg_cron cada 15 minutos (cabecera x-cron-secret): busca a quienes empezaron hace más de
// 45 minutos, no terminaron el perfil y no han recibido el recordatorio, y les envía UN solo correo
// con un botón que los deja dentro de la app para terminar. No envía de noche (9:30 p.m. a 7:00 a.m. de Bogotá).
// A mano desde el panel (admin con sesión): body { "user_id": "…" } lo envía a esa persona aunque ya lo haya recibido.
// Body { "ensayo": true } solo dice a quién le tocaría, sin enviar nada.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const APP_URL = Deno.env.get('APP_URL') ?? 'https://match.expohost.travel'
const FROM = Deno.env.get('RESEND_FROM') ?? 'Expohost Match <match@match.expohost.travel>'
const FIN_FERIA = Date.parse('2026-10-07T18:00:00-05:00')
const APERTURA = Date.parse('2026-10-02T00:00:00-05:00')  // el viernes 2 se abre al público
const NO_ENVIAR = /@(expohost\.invalid|example\.com)$/i

type Pendiente = { user_id: string; email: string; expositor: boolean; tiene_borrador: boolean }

function html(p: Pendiente, enlace: string) {
  const parrafo = (t: string, m = '0 0 16px 0') => `<p style="margin:${m};font-size:15px;line-height:1.6;color:#4A4B58;">${t}</p>`
  const b = (t: string) => `<strong style="color:#0D0D16;">${t}</strong>`
  const cuerpo = p.expositor
    ? [
        `Empezaste a crear tu perfil de expositor en ${b('Expohost Match')} y te faltó terminarlo. Mientras no esté completo, los asistentes no te pueden ver ni agendar reuniones contigo.`,
        `${Date.now() < APERTURA ? `Este ${b('viernes 2 de octubre')} abrimos la app al público.` : `La app ya está ${b('abierta al público')}.`} Con tu perfil listo apareces entre los primeros y tu agenda se empieza a llenar antes de la feria.`,
      ]
    : [
        `Empezaste a crear tu perfil en ${b('Expohost Match')} y te faltó terminarlo. Mientras no esté completo, nadie te puede ver en la app.`,
        `Al terminarlo eliges con quién quieres reunirte en ExpoHost, el ${b('6 y 7 de octubre')}, y llegas a la feria con tus citas ya agendadas.`,
      ]
  const cierre = `Te toma menos de 3 minutos${p.tiene_borrador ? ', y lo que ya escribiste quedó guardado' : ''}. No te quedes por fuera.`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Te falta un paso</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#F7F8FC;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F8FC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="${APP_URL}/correo/arcos.png" width="74" height="24" alt="" style="display:block;border:0;"></td>
<td style="vertical-align:middle;font-family:Montserrat,Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;color:#0D0D16;">EXPOHOST <span style="color:#0049FE;">MATCH</span></td></tr></table></td></tr>
<tr><td style="background:#FFFFFF;border-radius:22px;padding:36px 28px;font-family:Montserrat,Arial,Helvetica,sans-serif;color:#0D0D16;">
<p style="margin:0 0 10px 0;font-size:12px;line-height:1.4;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#FF3772;">Tu perfil quedó a medias</p>
<h1 style="margin:0 0 14px 0;font-size:25px;line-height:1.25;font-weight:800;color:#0D0D16;">Te falta un paso para ser parte de Expohost Match</h1>
${cuerpo.map((t) => parrafo(t)).join('')}${parrafo(cierre, '0 0 28px 0')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><a href="${enlace}" style="display:inline-block;background:#0049FE;color:#FFFFFF;text-decoration:none;font-family:Montserrat,Arial,Helvetica,sans-serif;font-weight:700;font-size:16px;line-height:1;padding:17px 32px;border-radius:999px;">Terminar mi perfil</a></td></tr></table>
<p style="margin:28px 0 0 0;font-size:13px;line-height:1.6;color:#4A4B58;">Si el botón ya no funciona, entra a match.expohost.travel, toca "Entrar" y escribe este mismo correo: te llega un código. Este es el único recordatorio que te enviaremos. Si no empezaste este registro, ignora este mensaje.</p>
</td></tr>
<tr><td style="padding:20px 8px 0 8px;font-family:Montserrat,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#4A4B58;text-align:center;">ExpoHost Bogotá 2026 · 6 y 7 de octubre · Gimnasio Moderno<br>Expohost SAS · NIT 901702368-6 · <a href="https://www.expohost.travel/tratamientodedatos" style="color:#4A4B58;">Tratamiento de datos</a></td></tr>
</table></td></tr></table></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // autorización: cron (secreto compartido) o admin con sesión
  const cronOk = !!Deno.env.get('CRON_SECRET') && req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET')
  if (!cronOk) {
    const quien = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await quien.auth.getUser()
    if (!user) return json({ error: 'no autenticado' }, 401)
    if (user.app_metadata?.role !== 'admin') return json({ error: 'no autorizado' }, 403)
  }
  const body = await req.json().catch(() => ({})) as { user_id?: string; ensayo?: boolean }

  let pendientes: Pendiente[]
  if (body.user_id) {
    // a mano desde el panel: una persona concreta, aunque ya haya recibido el recordatorio
    if (!/^[0-9a-f-]{36}$/i.test(body.user_id)) return json({ error: 'datos incompletos' }, 400)
    const [{ data: p }, { data: priv }] = await Promise.all([
      admin.from('profiles').select('id, busca, ofrece, activo, company:companies(tipo)').eq('id', body.user_id).maybeSingle(),
      admin.from('profiles_private').select('email').eq('user_id', body.user_id).maybeSingle(),
    ])
    if (!p || !priv?.email) return json({ error: 'persona no encontrada' }, 404)
    if ((p.busca?.length ?? 0) + (p.ofrece?.length ?? 0) > 0) return json({ enviado: false, motivo: 'esa persona ya terminó su perfil' })
    if (!p.activo) return json({ enviado: false, motivo: 'esa persona está fuera de la app' })
    const { data: borrador } = await admin.from('pending_registrations').select('email').eq('email', priv.email.toLowerCase()).maybeSingle()
    pendientes = [{ user_id: p.id, email: priv.email.toLowerCase(), expositor: (p.company as unknown as { tipo: string } | null)?.tipo === 'expositor', tiene_borrador: !!borrador }]
  } else {
    if (Date.now() > FIN_FERIA) return json({ enviado: false, motivo: 'la feria ya terminó' })
    // de noche no se envía: quien quedó pendiente lo recibe en la mañana
    const bogota = new Date(Date.now() - 5 * 3600_000)
    const minutos = bogota.getUTCHours() * 60 + bogota.getUTCMinutes()
    if (!body.ensayo && (minutos < 7 * 60 || minutos > 21 * 60 + 30)) return json({ enviado: false, motivo: 'fuera de horario (7:00 a 21:30 de Bogotá)' })
    const { data, error } = await admin.rpc('pendientes_de_recordatorio')
    if (error) return json({ error: error.message }, 500)
    pendientes = ((data ?? []) as Pendiente[]).slice(0, 40)
  }
  pendientes = pendientes.filter((p) => p.email && !NO_ENVIAR.test(p.email))
  if (body.ensayo) return json({ ensayo: true, personas: pendientes.length, a_quien: pendientes.map((p) => ({ email: p.email, expositor: p.expositor })) })

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return json({ enviado: false, motivo: 'RESEND_API_KEY no configurada' })

  const resultados: { email: string; ok: boolean; detalle?: string }[] = []
  for (const p of pendientes) {
    // enlace que deja a la persona dentro de la app (misma pantalla con botón de los correos de acceso);
    // si no se puede generar, el botón lleva a "Entrar"
    let enlace = `${APP_URL}/#/entrar`
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: p.email })
    const th = link?.properties?.hashed_token
    if (th) enlace = `${APP_URL}/#/confirmar?th=${th}&t=email`
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [p.email],
        subject: 'Te falta un paso para entrar a Expohost Match',
        html: html(p, enlace),
        text: `Empezaste a crear tu perfil en Expohost Match y te faltó terminarlo. Te toma menos de 3 minutos. Termínalo aquí: ${enlace}\n\nSi el enlace ya no funciona, entra a match.expohost.travel, toca "Entrar" y escribe este mismo correo. Este es el único recordatorio que te enviaremos.`,
      }),
    })
    if (r.ok) await admin.from('profiles').update({ recordatorio_at: new Date().toISOString() }).eq('id', p.user_id)
    resultados.push({ email: p.email, ok: r.ok, detalle: r.ok ? undefined : `Resend ${r.status}` })
  }
  return json({ enviado: true, personas: resultados.filter((r) => r.ok).length, resultados })
})
