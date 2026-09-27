// Edge Function: botón "Confirmo" del correo de agenda. GET ?m=<reunión>&u=<persona>&t=<firma>.
// Verifica la firma HMAC (sin sesión), marca la confirmación y lleva a la app.
import { createClient } from 'npm:@supabase/supabase-js@2'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://expohost.github.io/expohost-match'

async function firmar(meeting: string, user: string, secreto: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${meeting}:${user}`))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
const pagina = (titulo: string, texto: string) => new Response(
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="3;url=${APP_URL}/#/agenda"><title>${titulo}</title></head>
<body style="margin:0;background:#F7F8FC;font-family:Montserrat,Arial,sans-serif;color:#0D0D16;"><div style="max-width:480px;margin:48px auto;background:#fff;border-radius:22px;padding:32px 28px;">
<h1 style="font-size:22px;margin:0 0 12px 0;">${titulo}</h1><p style="color:#4A4B58;line-height:1.6;margin:0 0 20px 0;">${texto}</p>
<a href="${APP_URL}/#/agenda" style="display:inline-block;background:#0049FE;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:999px;">Ir a mi agenda</a></div></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

Deno.serve(async (req) => {
  const u = new URL(req.url)
  const m = u.searchParams.get('m') ?? '', p = u.searchParams.get('u') ?? '', t = u.searchParams.get('t') ?? ''
  const uuid = /^[0-9a-f-]{36}$/i
  if (!uuid.test(m) || !uuid.test(p)) return pagina('Enlace incompleto', 'Abre el correo de nuevo y toca el botón "Confirmo".')
  const secreto = Deno.env.get('CONFIRM_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (t !== await firmar(m, p, secreto)) return pagina('Enlace no válido', 'Este enlace no corresponde a tu reunión. Confirma desde la app.')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: mt } = await admin.from('meetings').select('id, estado, match:matches(user_a, user_b)').eq('id', m).maybeSingle()
  const match = mt?.match as unknown as { user_a: string; user_b: string } | null
  if (!mt || !match) return pagina('Reunión no encontrada', 'Puede que se haya cancelado. Revisa tu agenda en la app.')
  if (mt.estado !== 'confirmada') return pagina('Esta reunión fue cancelada', 'Revisa tu agenda en la app para elegir otro horario.')
  const cambios = p === match.user_a ? { confirmo_a: true } : p === match.user_b ? { confirmo_b: true } : null
  if (!cambios) return pagina('Enlace no válido', 'Este enlace no corresponde a tu reunión.')
  await admin.from('meetings').update(cambios).eq('id', m)
  return pagina('Confirmado, gracias', 'Le avisaremos a la organización que vas. Nos vemos en ExpoHost Bogotá.')
})
