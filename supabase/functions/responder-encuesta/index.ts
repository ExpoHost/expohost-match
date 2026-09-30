// Edge Function: respuesta de la encuesta T+1. El correo lleva a la app (#/encuesta?m=&u=&r=&t=)
// y la app hace POST aquí. GET (correos antiguos) → redirige a la app con los mismos parámetros.
import { createClient } from 'npm:@supabase/supabase-js@2'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://match.expohost.travel'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function firmar(texto: string, secreto: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
const igual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    const p = ['m', 'u', 'r', 't'].map((k) => `${k}=${encodeURIComponent(q.get(k) ?? '')}`).join('&')
    return Response.redirect(`${APP_URL}/#/encuesta?${p}`, 302)
  }
  if (req.method !== 'POST') return json({ ok: false, motivo: 'método no permitido' }, 405)
  const { m = '', u: p = '', r = '', t = '' } = await req.json().catch(() => ({})) as { m?: string; u?: string; r?: string; t?: string }
  const uuid = /^[0-9a-f-]{36}$/i
  if (!uuid.test(m) || !uuid.test(p) || !['si', 'no'].includes(r)) return json({ ok: false, motivo: 'incompleto' })
  const secreto = Deno.env.get('CONFIRM_SECRET')
  if (!secreto) return json({ ok: false, motivo: 'sin configurar' }, 500)
  if (!igual(String(t), await firmar(`${m}:${p}`, secreto))) return json({ ok: false, motivo: 'firma' })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await admin.rpc('responder_encuesta_servicio', { p_meeting: m, p_user: p, p_util: r === 'si' })
  return error ? json({ ok: false, motivo: 'error' }) : json({ ok: true, util: r === 'si' })
})
