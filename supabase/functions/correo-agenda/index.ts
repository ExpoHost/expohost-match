// Edge Function: correo "Tu agenda de mañana" con botón "Confirmo" por reunión.
// Se dispara a las 7 p.m. (Bogotá) del 5 y 6 de octubre por pg_cron (cabecera x-cron-secret)
// o a mano desde el panel (admin con sesión). Body opcional: { "dia": "2026-10-06", "solo": "correo@x" }.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const APP_URL = Deno.env.get('APP_URL') ?? 'https://expohost.github.io/expohost-match'
const FROM = Deno.env.get('RESEND_FROM') ?? 'Expohost Match <match@match.expohost.travel>'
const DIAS: Record<string, string> = { '2026-10-06': 'martes 6 de octubre', '2026-10-07': 'miércoles 7 de octubre' }
const hora = (t: string) => t.slice(0, 5)
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Token de confirmación: HMAC del id de reunión + persona, sin necesidad de iniciar sesión
export async function firmar(meeting: string, user: string, secreto: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${meeting}:${user}`))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const secreto = Deno.env.get('CONFIRM_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // autorización: cron (secreto compartido) o admin con sesión
  const cronOk = !!Deno.env.get('CRON_SECRET') && req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET')
  if (!cronOk) {
    const quien = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await quien.auth.getUser()
    if (user?.app_metadata?.role !== 'admin') return json({ error: 'no autorizado' }, 403)
  }

  const body = await req.json().catch(() => ({})) as { dia?: string; solo?: string }
  // por defecto, "mañana" en hora de Bogotá
  const manana = new Date(Date.now() - 5 * 3600_000 + 86400_000).toISOString().slice(0, 10)
  const dia = body.dia ?? manana
  if (!DIAS[dia]) return json({ enviado: false, motivo: `no hay feria el ${dia}` })

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return json({ enviado: false, motivo: 'RESEND_API_KEY no configurada' })

  const { data: reuniones, error } = await admin.rpc('admin_reuniones_servicio', { p_dia: dia })
  if (error) return json({ error: error.message }, 500)

  // agrupar por persona
  type R = { id: string; inicio: string; lugar: string; mesa: number | null; stand: string | null; a_id: string; a_nombre: string; a_empresa: string | null; b_id: string; b_nombre: string; b_empresa: string | null; a_email: string; b_email: string; confirmo_a: boolean; confirmo_b: boolean }
  const porPersona = new Map<string, { email: string; nombre: string; items: { r: R; otroNombre: string; otroEmpresa: string | null; confirmo: boolean }[] }>()
  for (const r of (reuniones as R[])) {
    for (const lado of ['a', 'b'] as const) {
      const id = r[`${lado}_id`], email = r[`${lado}_email`]
      if (!email || email.endsWith('@expohost.invalid')) continue
      if (body.solo && email !== body.solo.toLowerCase()) continue
      const otro = lado === 'a' ? 'b' : 'a'
      const p = porPersona.get(id) ?? { email, nombre: r[`${lado}_nombre`], items: [] }
      p.items.push({ r, otroNombre: r[`${otro}_nombre`], otroEmpresa: r[`${otro}_empresa`], confirmo: r[`confirmo_${lado}`] })
      porPersona.set(id, p)
    }
  }

  const resultados: { email: string; ok: boolean }[] = []
  for (const [uid, p] of porPersona) {
    p.items.sort((x, y) => x.r.inicio.localeCompare(y.r.inicio))
    const filas = await Promise.all(p.items.map(async ({ r, otroNombre, otroEmpresa, confirmo }) => {
      const t = await firmar(r.id, uid, secreto)
      const lugar = r.lugar === 'stand' ? `Stand ${r.stand}` : `Zona Match · Mesa ${r.mesa}`
      const boton = confirmo
        ? `<span style="display:inline-block;padding:10px 16px;border-radius:999px;background:#E0F7F7;color:#006B6B;font-weight:700;font-size:13px;">Confirmada</span>`
        : `<a href="${url}/functions/v1/confirmar-reunion?m=${r.id}&u=${uid}&t=${t}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0049FE;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:13px;">Confirmo</a>`
      return `<tr><td style="padding:14px 0;border-top:1px solid #E4E6F0;font-family:Montserrat,Arial,sans-serif;">
        <p style="margin:0;font-size:16px;font-weight:800;color:#0D0D16;">${hora(r.inicio)} · ${esc(lugar)}</p>
        <p style="margin:4px 0 10px 0;font-size:14px;color:#4A4B58;">con ${esc(otroNombre)}${otroEmpresa ? ` (${esc(otroEmpresa)})` : ''}</p>${boton}</td></tr>`
    }))
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tu agenda de mañana</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#F7F8FC;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F8FC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="${APP_URL}/correo/arcos.png" width="74" height="24" alt="" style="display:block;border:0;"></td><td style="vertical-align:middle;font-family:Montserrat,Arial,sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;color:#0D0D16;">EXPOHOST <span style="color:#0049FE;">MATCH</span></td></tr></table></td></tr>
<tr><td style="background:#FFFFFF;border-radius:22px;padding:36px 28px;font-family:Montserrat,Arial,sans-serif;color:#0D0D16;">
<h1 style="margin:0 0 8px 0;font-size:24px;line-height:1.3;font-weight:800;">Tu agenda del ${DIAS[dia]}</h1>
<p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#4A4B58;">Hola, ${esc(p.nombre.split(' ')[0])}. Tienes ${p.items.length} reunión${p.items.length === 1 ? '' : 'es'} mañana en ExpoHost Bogotá. Toca "Confirmo" en cada una para avisar que vas.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas.join('')}</table>
<p style="margin:24px 0 0 0;font-size:13px;line-height:1.6;color:#4A4B58;">Si no puedes ir a alguna, cancélala desde <a href="${APP_URL}/#/agenda" style="color:#0049FE;">Mi agenda</a> para liberar el espacio. Gimnasio Moderno, Bogotá. En la feria entra con tus datos móviles.</p>
</td></tr>
<tr><td style="padding:20px 8px 0 8px;font-family:Montserrat,Arial,sans-serif;font-size:12px;line-height:1.6;color:#4A4B58;text-align:center;">ExpoHost Bogotá 2026 · Expohost SAS · NIT 901702368-6</td></tr>
</table></td></tr></table></body></html>`
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [p.email], subject: `Tu agenda del ${DIAS[dia]} en ExpoHost · ${p.items.length} reunión${p.items.length === 1 ? '' : 'es'}`, html }),
    })
    resultados.push({ email: p.email, ok: r.ok })
  }
  return json({ enviado: true, dia, personas: resultados.length, resultados })
})
