import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Categoria = { slug: string; nombre: string }

// Etiquetas activas y categorías (editables en el panel; legibles sin sesión)
export function useCatalogos() {
  const [tags, setTags] = useState<string[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  useEffect(() => {
    supabase.from('tags').select('nombre').eq('activo', true).order('orden')
      .then(({ data }) => setTags((data ?? []).map((t) => t.nombre)))
    supabase.from('categories').select('slug, nombre').order('orden')
      .then(({ data }) => setCategorias(data ?? []))
  }, [])
  return { tags, categorias }
}

// Recorta al centro y redimensiona a 512 px (JPEG) antes de subir
export async function redimensionarFoto(file: File, lado = 512): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => mal(new Error('No pudimos leer la imagen'))
      i.src = url
    })
    const s = Math.min(img.width, img.height)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = Math.min(lado, s)
    canvas.getContext('2d')!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// URL firmada (bucket privado) para mostrar una foto
export function useFoto(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    let vivo = true
    supabase.storage.from('fotos').createSignedUrl(path, 3600).then(({ data }) => vivo && setUrl(data?.signedUrl ?? null))
    return () => { vivo = false }
  }, [path])
  return url
}

export const iniciales = (nombre: string) =>
  nombre.split(/\s+/).filter((p) => /^\p{L}/u.test(p)).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'

// Traduce errores técnicos a mensajes para la persona
export function mensajeError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(m)) return 'El código no es válido o ya venció. Pide uno nuevo.'
  if (/rate limit|security purposes|too many/i.test(m)) return 'Ya enviamos un código hace poco. Espera un minuto e inténtalo de nuevo.'
  if (/signups not allowed|user not found/i.test(m)) return 'No encontramos un perfil con ese correo. Crea tu perfil primero.'
  if (/error sending (confirmation |magic link |recovery )?email/i.test(m)) return 'No pudimos enviar el correo en este momento. Inténtalo en un minuto o escríbenos a management@expohost.travel.'
  if (/failed to fetch|network/i.test(m)) return 'Sin conexión. Revisa tus datos móviles e inténtalo de nuevo.'
  if (/^no autenticado|jwt|session/i.test(m)) return 'Tu sesión terminó. Entra de nuevo con tu correo.'
  if (/^no autorizado|permission denied|row-level security/i.test(m)) return 'No tienes permiso para hacer esto.'
  if (/match no encontrado/i.test(m)) return 'Este match ya no existe. Vuelve a Mi agenda.'
  if (/reunión no encontrada/i.test(m)) return 'Esta reunión ya no existe o fue cancelada.'
  if (/empresa no encontrada/i.test(m)) return 'No encontramos esa empresa.'
  if (/duplicate key|unique/i.test(m)) return 'Eso ya existe. Revisa e inténtalo de nuevo.'
  if (/tope de ♥/i.test(m)) return 'Ya marcaste muchas personas hoy. Mañana puedes seguir; mientras tanto revisa Mi agenda.'
  // los mensajes escritos por la app (en español, con mayúscula inicial) se muestran; lo técnico, no
  if (/^[A-ZÁÉÍÓÚÑ¿¡]/.test(m) && !/[{}_]|constraint|column|relation|violates|syntax|JSON/i.test(m)) return m
  console.warn(m)
  return 'Algo no salió bien. Inténtalo de nuevo; si sigue pasando, escríbenos a management@expohost.travel.'
}
