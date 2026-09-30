// Activa el dominio propio match.expohost.travel en Supabase (Site URL, Redirect URLs, APP_URL de las
// funciones y enlaces de las plantillas de correo). Correr SOLO cuando el CNAME exista y GitHub Pages
// ya sirva la app en https://match.expohost.travel (Settings → Pages → Custom domain + Enforce HTTPS).
// Uso: SBP=<token de acceso de Supabase> node scripts/dominio.mjs
// Antes: crear public/CNAME con el texto "match.expohost.travel" y publicar.
import { readFileSync } from 'node:fs'

const REF = 'ujfhvhoutlqphbpwrgfq'
const NUEVA = 'https://match.expohost.travel'
const VIEJA = 'https://expohost.github.io/expohost-match' // los archivos ya usan la nueva; el reemplazo es inofensivo
const SBP = process.env.SBP
if (!SBP) { console.error('Falta SBP (token de acceso de Supabase)'); process.exit(1) }
const api = (path, body) => fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
  method: body ? (path === '/secrets' ? 'POST' : 'PATCH') : 'GET',
  headers: { Authorization: `Bearer ${SBP}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json())

const plantilla = (f) => readFileSync(new URL(`../supabase/plantillas/${f}`, import.meta.url), 'utf8').replaceAll(VIEJA, NUEVA)
const r = await api('/config/auth', {
  site_url: NUEVA,
  uri_allow_list: `${NUEVA}/**,${VIEJA}/**`,
  mailer_templates_magic_link_content: plantilla('magic.html'),
  mailer_templates_confirmation_content: plantilla('confirmacion.html'),
  mailer_templates_invite_content: plantilla('invitacion.html'),
})
console.log('auth:', r.message ?? { site_url: r.site_url, redirects: r.uri_allow_list })
const s = await api('/secrets', [{ name: 'APP_URL', value: NUEVA }])
console.log('secreto APP_URL:', s.message ?? 'ok')
console.log('Falta: volver a publicar las Edge Functions para que tomen APP_URL (npx supabase functions deploy correo-reunion correo-agenda correo-encuesta confirmar-reunion responder-encuesta invitar-expositores).')
