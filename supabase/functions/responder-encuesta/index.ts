// Edge Function: respuesta de la encuesta T+1 desde el correo. GET ?m=<reunión>&u=<persona>&r=si|no&t=<firma>
import { createClient } from 'npm:@supabase/supabase-js@2'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://expohost.github.io/expohost-match'
async function firmar(texto: string, secreto: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
const pagina = (titulo: string, texto: string) => new Response(
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title></head>
<body style="margin:0;background:#F7F8FC;font-family:Montserrat,Arial,sans-serif;color:#0D0D16;"><div style="max-width:480px;margin:48px auto;background:#fff;border-radius:22px;padding:32px 28px;">
<h1 style="font-size:22px;margin:0 0 12px 0;">${titulo}</h1><p style="color:#4A4B58;line-height:1.6;margin:0 0 20px 0;">${texto}</p>
<a href="${APP_URL}/" style="display:inline-block;background:#0049FE;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:999px;">Ir a Expohost Match</a></div></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

Deno.serve(async (req) => {
  const u = new URL(req.url)
  const m = u.searchParams.get('m') ?? '', p = u.searchParams.get('u') ?? '', r = u.searchParams.get('r'), t = u.searchParams.get('t') ?? ''
  const uuid = /^[0-9a-f-]{36}$/i
  if (!uuid.test(m) || !uuid.test(p) || !['si', 'no'].includes(r ?? '')) return pagina('Enlace incompleto', 'Abre el correo de nuevo y toca una de las dos opciones.')
  const secreto = Deno.env.get('CONFIRM_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (t !== await firmar(`${m}:${p}`, secreto)) return pagina('Enlace no válido', 'Este enlace no corresponde a tu reunión.')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await admin.rpc('responder_encuesta_servicio', { p_meeting: m, p_user: p, p_util: r === 'si' })
  if (error) return pagina('No pudimos guardar tu respuesta', 'Inténtalo de nuevo más tarde.')
  return pagina('Gracias por tu respuesta', r === 'si' ? 'Nos alegra que la reunión haya sido útil. Nos vemos en la próxima edición.' : 'Gracias por contarnos. Lo tendremos en cuenta para mejorar.')
})
