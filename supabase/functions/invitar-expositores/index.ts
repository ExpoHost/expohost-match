// Edge Function: alta e invitación de expositores desde el panel (solo admin).
// Por cada fila: crea (o reutiliza) la empresa expositora, invita al correo con Supabase Auth
// (plantilla "Invite user", enviada por el SMTP configurado = Resend) y deja el perfil marcado
// como invitado con su empresa, tipo y tier. Al completar el registro, la app lo hace visible.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const APP_URL = Deno.env.get('APP_URL') ?? 'https://expohost.github.io/expohost-match'

type Fila = { empresa: string; stand?: string; nombre: string; email: string; categoria?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const quien = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: { user } } = await quien.auth.getUser()
  if (!user) return json({ error: 'no autenticado' }, 401)
  if (user.app_metadata?.role !== 'admin') return json({ error: 'no autorizado' }, 403)

  const { filas, solo_crear, solo_validar } = await req.json().catch(() => ({})) as { filas?: Fila[]; solo_crear?: boolean; solo_validar?: boolean }
  if (!Array.isArray(filas) || filas.length === 0 || filas.length > 100) return json({ error: 'envía entre 1 y 100 filas' }, 400)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const resultados: { email: string; estado: string; detalle?: string }[] = []

  // Ensayo: solo dice qué pasaría con cada fila (existe el usuario, existe la empresa), sin crear ni enviar nada
  if (solo_validar) {
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 })
    for (const f of filas) {
      const email = String(f.email ?? '').trim().toLowerCase()
      const empresa = String(f.empresa ?? '').trim()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || empresa.length < 2) { resultados.push({ email, estado: 'omitida', detalle: 'correo o empresa inválidos' }); continue }
      const existe = lista?.users.some((u) => u.email?.toLowerCase() === email)
      const { data: emp } = await admin.from('companies').select('id').ilike('nombre', empresa).limit(1).maybeSingle()
      resultados.push({ email, estado: existe ? 'ya tiene usuario: se vincularía sin correo' : 'se invitaría por correo', detalle: emp ? 'empresa existente' : 'empresa nueva' })
    }
    return json({ ensayo: true, resultados })
  }

  for (const f of filas) {
    const email = String(f.email ?? '').trim().toLowerCase()
    const empresa = String(f.empresa ?? '').trim().slice(0, 80)
    const nombre = String(f.nombre ?? '').trim().slice(0, 80) || 'Nuevo participante'
    const stand = String(f.stand ?? '').trim().slice(0, 20) || null
    const categoria = String(f.categoria ?? '').trim() || null
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || empresa.length < 2) { resultados.push({ email, estado: 'omitida', detalle: 'correo o empresa inválidos' }); continue }

    // empresa: reutilizar por nombre (misma feria) o crear
    let companyId: string
    const { data: existente } = await admin.from('companies').select('id').ilike('nombre', empresa).limit(1).maybeSingle()
    if (existente) {
      companyId = existente.id
      await admin.from('companies').update({ tipo: 'expositor', stand, ...(categoria ? { categoria } : {}) }).eq('id', companyId)
    } else {
      const { data: nueva, error } = await admin.from('companies').insert({ nombre: empresa, tipo: 'expositor', stand, categoria }).select('id').single()
      if (error || !nueva) { resultados.push({ email, estado: 'error', detalle: error?.message }); continue }
      companyId = nueva.id
    }

    // usuario: si ya existe, solo se vincula; si no, se invita por correo
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 })
    let uid = lista?.users.find((u) => u.email?.toLowerCase() === email)?.id
    let estado = 'vinculado'
    if (!uid) {
      if (solo_crear) {
        const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { nombre } })
        if (error || !data.user) { resultados.push({ email, estado: 'error', detalle: error?.message }); continue }
        uid = data.user.id; estado = 'creado sin correo'
      } else {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { nombre }, redirectTo: `${APP_URL}/` })
        if (error || !data.user) { resultados.push({ email, estado: 'error', detalle: error?.message }); continue }
        uid = data.user.id; estado = 'invitado'
      }
    }
    // perfil sin completar → queda como invitado (invisible) con su empresa; perfil completo → solo se asegura la empresa
    const { data: perfil } = await admin.from('profiles').select('busca, ofrece, company_id').eq('id', uid).maybeSingle()
    const completo = (perfil?.busca?.length ?? 0) + (perfil?.ofrece?.length ?? 0) > 0
    const cambios = { company_id: companyId, tipo: stand ? 'expositor' : 'asistente', tier: stand ? 'expositor' : 'vip', ...(categoria ? { categoria } : {}) }
    const { error: e2 } = completo
      ? await admin.from('profiles').update(cambios).eq('id', uid).is('company_id', null)
      : await admin.from('profiles').update({ ...cambios, invitado: true }).eq('id', uid)
    resultados.push({ email, estado: completo ? 'ya tenía perfil (vinculado)' : estado, detalle: e2?.message })
  }
  return json({ resultados })
})
