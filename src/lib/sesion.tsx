import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { z } from 'zod'
import { SESION_DIAS, supabase } from './supabase'
import { CONSENT_TEXTO, CONSENT_VERSION, sha256 } from './catalogos'

export type Perfil = {
  id: string
  nombre: string
  cargo: string | null
  ciudad: string | null
  bio: string | null
  foto_path: string | null
  tipo: 'asistente' | 'expositor'
  tier: string
  activo?: boolean
  categoria: string | null
  busca: string[]
  ofrece: string[]
  franjas: string[]
  empresa: { nombre: string; tipo: string; stand: string | null; solicitud: string | null; stand_declarado: string | null } | null
  telefono: string | null
  email: string
}

// Datos del registro guardados en el navegador mientras la persona confirma su correo.
export type Borrador = {
  nombre: string
  empresa: string
  cargo: string
  ciudad: string
  telefono: string
  categoria: string
  solicitud: string
  stand: string
  bio: string
  foto: string | null // data URL ya redimensionada
  busca: string[]
  ofrece: string[]
  franjas: string[]
  comercial: boolean
  email: string
}

const CLAVE_BORRADOR = 'expohost-registro'
export const leerBorrador = (): Borrador | null => {
  try { return JSON.parse(localStorage.getItem(CLAVE_BORRADOR) ?? 'null') } catch { return null }
}
// En modo privado o en algunos navegadores dentro de apps, localStorage puede fallar: el registro
// no depende de él (los datos también van al servidor), así que solo se ignora el error.
export const guardarBorrador = (b: Borrador) => { try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b)) } catch { /* sin almacenamiento local */ } }
export const borrarBorrador = () => { try { localStorage.removeItem(CLAVE_BORRADOR) } catch { /* sin almacenamiento local */ } }

export const perfilCompleto = (p: Perfil | null) => !!p && p.busca.length + p.ofrece.length > 0

const esquemaBorrador = z.object({
  nombre: z.string().max(80), empresa: z.string().max(80), cargo: z.string().max(80), ciudad: z.string().max(60),
  telefono: z.string().max(25), categoria: z.string().max(40), solicitud: z.string().max(30), stand: z.string().max(20),
  bio: z.string().max(280), foto: z.string().max(200_000).nullable(),
  busca: z.array(z.string().max(60)).max(30), ofrece: z.array(z.string().max(60)).max(30), franjas: z.array(z.string().max(10)).max(4),
  comercial: z.boolean(), email: z.string().max(120),
})
export const esBorrador = (x: unknown): x is Borrador => esquemaBorrador.safeParse(x).success

// Guarda perfil, empresa y teléfono; con consentimiento, lo registra.
export async function guardarPerfil(b: Borrador, conConsentimiento: boolean) {
  const { error } = await supabase.rpc('completar_registro', {
    p_nombre: b.nombre, p_cargo: b.cargo, p_ciudad: b.ciudad, p_bio: b.bio, p_telefono: b.telefono,
    p_categoria: b.categoria, p_empresa: b.empresa, p_solicitud: b.solicitud, p_stand: b.stand,
    p_busca: b.busca, p_ofrece: b.ofrece, p_franjas: b.franjas,
  })
  if (error) throw error
  if (conConsentimiento) {
    const { error: e2 } = await supabase.rpc('registrar_consentimiento', {
      p_version: CONSENT_VERSION, p_hash: await sha256(CONSENT_TEXTO), p_comercial: b.comercial, p_ip: '', p_ua: navigator.userAgent,
    })
    if (e2) throw e2
  }
  // La foto no frena el registro: si falla, la persona la agrega después desde "Editar mi perfil".
  // (No se usa fetch(data:) porque la política de seguridad de la página lo bloquea en Safari.)
  if (b.foto) {
    try { await subirFoto(dataUrlABlob(b.foto)) } catch (e) { console.warn('foto no subida', e) }
  }
}

function dataUrlABlob(dataUrl: string) {
  const [cabecera, datos] = dataUrl.split(',')
  const tipo = /data:([^;]+)/.exec(cabecera ?? '')?.[1] ?? 'image/jpeg'
  const bin = atob(datos ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: tipo })
}

export async function subirFoto(blob: Blob) {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('Sin sesión')
  // una sola foto por persona: se borran las anteriores
  const { data: viejas } = await supabase.storage.from('fotos').list(data.user.id)
  if (viejas?.length) await supabase.storage.from('fotos').remove(viejas.map((f) => `${data.user!.id}/${f.name}`))
  const path = `${data.user.id}/foto-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  const { error: e2 } = await supabase.from('profiles').update({ foto_path: path }).eq('id', data.user.id)
  if (e2) throw e2
}

async function cargarPerfil(uid: string): Promise<Perfil | null> {
  const [{ data: p, error: e1 }, { data: priv, error: e2 }] = await Promise.all([
    supabase.from('profiles')
      .select('id, nombre, cargo, ciudad, bio, foto_path, tipo, tier, categoria, busca, ofrece, franjas, activo, empresa:companies(nombre, tipo, stand, solicitud, stand_declarado)')
      .eq('id', uid).maybeSingle(),
    supabase.from('profiles_private').select('email, telefono').eq('user_id', uid).maybeSingle(),
  ])
  // Un fallo de red no debe confundirse con "no tiene perfil" (mandaría a la persona a llenarlo otra vez)
  if (e1 || e2) throw new Error('No pudimos cargar tu perfil. Revisa tu conexión.')
  if (!p) return null
  return { ...(p as unknown as Omit<Perfil, 'telefono' | 'email'>), telefono: priv?.telefono ?? null, email: priv?.email ?? '' }
}

type Ctx = {
  session: Session | null
  perfil: Perfil | null
  cargando: boolean
  error: string | null
  recargar: () => Promise<void>
}
const SesionCtx = createContext<Ctx>({ session: null, perfil: null, cargando: true, error: null, recargar: async () => {} })

export function SesionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sincronizar = useCallback(async (s: Session | null) => {
    setSession(s)
    if (!s) { setPerfil(null); setCargando(false); return }
    // Sesión de máximo SESION_DIAS desde que la persona entró con su correo (el plan Free no lo limita).
    // Nunca se expulsa a nadie entre el 5 y el 8 de octubre: en la feria no hay tiempo de pedir correos.
    const entro = s.user.last_sign_in_at ? Date.parse(s.user.last_sign_in_at) : Date.now()
    const hoy = new Date().toISOString().slice(0, 10)
    const enFeria = hoy >= '2026-10-05' && hoy <= '2026-10-08'
    if (!enFeria && Date.now() - entro > SESION_DIAS * 86400_000) { await supabase.auth.signOut({ scope: 'local' }); return }
    setError(null)
    try {
      // Si la persona acaba de confirmar su correo, terminar el registro que dejó guardado.
      // Primero el borrador de este navegador (trae la foto); si no hay, el guardado en el servidor
      // (el enlace del correo pudo abrirse en otro navegador). Tomarlo del servidor lo borra.
      const local = leerBorrador()
      const mio = local && local.email?.toLowerCase() === (s.user.email ?? '').toLowerCase() ? local : null
      const { data: remoto } = await supabase.rpc('tomar_registro_pendiente')
      // El pendiente del servidor se valida antes de aplicarlo (lo pudo escribir cualquiera con el correo)
      if (mio) {
        borrarBorrador() // antes de guardar, para no guardarlo dos veces si esto corre en paralelo
        try { await guardarPerfil(mio, true) } catch (e) { guardarBorrador(mio); throw e }
      } else if (esBorrador(remoto)) {
        // Lo que vino del servidor pudo escribirlo cualquiera con este correo: NO se aplica solo.
        // Se usa para prellenar el formulario y la persona lo revisa, acepta y guarda en este navegador.
        try { sessionStorage.setItem('expohost-prellenado', JSON.stringify({ ...remoto, foto: null, comercial: false })) } catch { /* sin almacenamiento */ }
      }
      setPerfil(await cargarPerfil(s.user.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos cargar tu perfil')
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    let uid: string | undefined
    let primera = true
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => {
      // INITIAL_SESSION llega siempre primero. Después, recargar todo solo si cambió la persona
      // (al volver a la pestaña también llega SIGNED_IN con la misma persona).
      if (primera || s?.user.id !== uid) {
        primera = false; uid = s?.user.id; setCargando(true)
        setTimeout(() => sincronizar(s), 0) // fuera del callback, como recomienda supabase-js
      } else setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [sincronizar])

  const recargar = useCallback(async () => {
    if (!session) return
    try { setPerfil(await cargarPerfil(session.user.id)) } catch { /* se conserva el perfil que ya teníamos */ }
  }, [session])

  return <SesionCtx.Provider value={{ session, perfil, cargando, error, recargar }}>{children}</SesionCtx.Provider>
}

export const useSesion = () => useContext(SesionCtx)
