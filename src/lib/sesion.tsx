import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
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
export const guardarBorrador = (b: Borrador) => localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b))
export const borrarBorrador = () => localStorage.removeItem(CLAVE_BORRADOR)

export const perfilCompleto = (p: Perfil | null) => !!p && p.busca.length + p.ofrece.length > 0

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
  const path = `${data.user.id}/foto-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  const { error: e2 } = await supabase.from('profiles').update({ foto_path: path }).eq('id', data.user.id)
  if (e2) throw e2
}

async function cargarPerfil(uid: string): Promise<Perfil | null> {
  const [{ data: p }, { data: priv }] = await Promise.all([
    supabase.from('profiles')
      .select('id, nombre, cargo, ciudad, bio, foto_path, tipo, tier, categoria, busca, ofrece, franjas, empresa:companies(nombre, tipo, stand, solicitud, stand_declarado)')
      .eq('id', uid).maybeSingle(),
    supabase.from('profiles_private').select('email, telefono').eq('user_id', uid).maybeSingle(),
  ])
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
    // Sesión de máximo 7 días desde que la persona entró con su correo (el plan Free no lo limita)
    const entro = s.user.last_sign_in_at ? Date.parse(s.user.last_sign_in_at) : Date.now()
    if (Date.now() - entro > SESION_DIAS * 86400_000) { await supabase.auth.signOut(); return }
    setError(null)
    try {
      // Si la persona acaba de confirmar su correo, terminar el registro que dejó guardado.
      // Primero el borrador de este navegador (trae la foto); si no hay, el guardado en el servidor
      // (el enlace del correo pudo abrirse en otro navegador). Tomarlo del servidor lo borra.
      const local = leerBorrador()
      const mio = local && local.email.toLowerCase() === (s.user.email ?? '').toLowerCase() ? local : null
      const { data: remoto } = await supabase.rpc('tomar_registro_pendiente')
      const b = mio ?? (remoto as Borrador | null)
      if (b) {
        borrarBorrador() // antes de guardar, para no guardarlo dos veces si esto corre en paralelo
        try { await guardarPerfil(b, true) } catch (e) { guardarBorrador(b); throw e }
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
    if (session) setPerfil(await cargarPerfil(session.user.id))
  }, [session])

  return <SesionCtx.Provider value={{ session, perfil, cargando, error, recargar }}>{children}</SesionCtx.Provider>
}

export const useSesion = () => useContext(SesionCtx)
