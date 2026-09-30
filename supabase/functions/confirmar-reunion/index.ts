// Edge Function: confirmación de asistencia desde el correo de agenda.
// El correo lleva a la app (#/confirmar-reunion?m=&u=&t=); la app hace POST aquí con esos datos.
// Así un escáner de correo que "abre" el enlace no confirma nada, y la persona ve una pantalla de la app.
// GET (enlaces de correos antiguos) → redirige a la app con los mismos parámetros.
import { createClient } from 'npm:@supabase/supabase-js@2'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://match.expohost.travel'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function firmar(meeting: string, user: string, secreto: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${meeting}:${user}`))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
// comparación en tiempo constante
const igual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    return Response.redirect(`${APP_URL}/#/confirmar-reunion?m=${encodeURIComponent(q.get('m') ?? '')}&u=${encodeURIComponent(q.get('u') ?? '')}&t=${encodeURIComponent(q.get('t') ?? '')}`, 302)
  }
  if (req.method !== 'POST') return json({ ok: false, motivo: 'método no permitido' }, 405)
  const { m = '', u: p = '', t = '' } = await req.json().catch(() => ({})) as { m?: string; u?: string; t?: string }
  const uuid = /^[0-9a-f-]{36}$/i
  if (!uuid.test(m) || !uuid.test(p)) return json({ ok: false, motivo: 'incompleto' })
  const secreto = Deno.env.get('CONFIRM_SECRET')
  if (!secreto) return json({ ok: false, motivo: 'sin configurar' }, 500)
  if (!igual(String(t), await firmar(m, p, secreto))) return json({ ok: false, motivo: 'firma' })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: mt } = await admin.from('meetings').select('id, estado, lugar, mesa, stand, match:matches(user_a, user_b), block:blocks(dia, inicio)').eq('id', m).maybeSingle()
  const match = mt?.match as unknown as { user_a: string; user_b: string } | null
  if (!mt || !match) return json({ ok: false, motivo: 'no_existe' })
  if (mt.estado !== 'confirmada') return json({ ok: false, motivo: 'cancelada' })
  const cambios = p === match.user_a ? { confirmo_a: true } : p === match.user_b ? { confirmo_b: true } : null
  if (!cambios) return json({ ok: false, motivo: 'firma' })
  await admin.from('meetings').update(cambios).eq('id', m)
  const block = mt.block as unknown as { dia: string; inicio: string } | null
  return json({ ok: true, dia: block?.dia, inicio: block?.inicio, lugar: mt.lugar === 'stand' ? `Stand ${mt.stand}` : `Zona Match · Mesa ${mt.mesa}` })
})
