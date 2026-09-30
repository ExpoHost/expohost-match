// Edge Function: encuesta T+1 (8 de octubre, 9 a.m. Bogotá, por pg_cron) o manual desde el panel.
// Un correo por persona con una pregunta por reunión: "¿La reunión fue útil?" Sí / No (enlaces firmados).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const APP_URL = Deno.env.get('APP_URL') ?? 'https://match.expohost.travel'
const FROM = Deno.env.get('RESEND_FROM') ?? 'Expohost Match <match@match.expohost.travel>'
const DIAS: Record<string, string> = { '2026-10-06': 'martes 6', '2026-10-07': 'miércoles 7' }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

async function firmar(texto: string, secreto: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const secreto = Deno.env.get('CONFIRM_SECRET')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const cronOk = !!Deno.env.get('CRON_SECRET') && req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET')
  if (!cronOk) {
    const quien = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await quien.auth.getUser()
    if (user?.app_metadata?.role !== 'admin') return json({ error: 'no autorizado' }, 403)
  }
  const body = await req.json().catch(() => ({})) as { solo?: string }
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return json({ enviado: false, motivo: 'RESEND_API_KEY no configurada' })

  const { data: filas, error } = await admin.rpc('reuniones_para_encuesta')
  if (error) return json({ error: error.message }, 500)
  type F = { meeting_id: string; user_id: string; nombre: string; email: string; otro_nombre: string; dia: string; inicio: string }
  const porPersona = new Map<string, F[]>()
  for (const f of (filas as F[])) {
    if (body.solo && f.email !== body.solo.toLowerCase()) continue
    porPersona.set(f.user_id, [...(porPersona.get(f.user_id) ?? []), f])
  }
  const resultados: { email: string; ok: boolean }[] = []
  for (const [uid, items] of porPersona) {
    const filasHtml = await Promise.all(items.map(async (f) => {
      const t = await firmar(`${f.meeting_id}:${uid}`, secreto)
      const enlace = (util: boolean) => `${APP_URL}/#/encuesta?m=${f.meeting_id}&u=${uid}&r=${util ? 'si' : 'no'}&t=${t}`
      return `<tr><td style="padding:14px 0;border-top:1px solid #E4E6F0;font-family:Montserrat,Arial,sans-serif;">
        <p style="margin:0 0 10px 0;font-size:15px;color:#0D0D16;"><strong>${esc(f.otro_nombre)}</strong> · ${DIAS[f.dia] ?? f.dia}, ${f.inicio.slice(0, 5)}</p>
        <a href="${enlace(true)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0049FE;color:#fff;text-decoration:none;font-weight:700;font-size:13px;margin-right:8px;">Sí, fue útil</a>
        <a href="${enlace(false)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#fff;border:1px solid #E4E6F0;color:#0D0D16;text-decoration:none;font-weight:700;font-size:13px;">No</a></td></tr>`
    }))
    const nombre = items[0]!.nombre.split(' ')[0]
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>¿Cómo te fue?</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#F7F8FC;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F8FC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="${APP_URL}/correo/arcos.png" width="74" height="24" alt="" style="display:block;border:0;"></td><td style="vertical-align:middle;font-family:Montserrat,Arial,sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;color:#0D0D16;">EXPOHOST <span style="color:#0049FE;">MATCH</span></td></tr></table></td></tr>
<tr><td style="background:#fff;border-radius:22px;padding:36px 28px;font-family:Montserrat,Arial,sans-serif;color:#0D0D16;">
<h1 style="margin:0 0 8px 0;font-size:24px;line-height:1.3;font-weight:800;">Gracias por estar en ExpoHost, ${esc(nombre)}</h1>
<p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#4A4B58;">Una sola pregunta por cada reunión que tuviste: ¿fue útil? Tu respuesta nos ayuda a mejorar Expohost Match para la próxima edición.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filasHtml.join('')}</table>
</td></tr>
<tr><td style="padding:20px 8px 0 8px;font-family:Montserrat,Arial,sans-serif;font-size:12px;line-height:1.6;color:#4A4B58;text-align:center;">ExpoHost Bogotá 2026 · Expohost SAS · NIT 901702368-6</td></tr>
</table></td></tr></table></body></html>`
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [items[0]!.email], subject: '¿Cómo te fue en tus reuniones de ExpoHost? Una sola pregunta', html }) })
    resultados.push({ email: items[0]!.email, ok: r.ok })
  }
  return json({ enviado: true, personas: resultados.length, resultados })
})
