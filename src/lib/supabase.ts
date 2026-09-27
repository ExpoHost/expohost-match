import { createClient } from '@supabase/supabase-js'

// Valores públicos por diseño (la publishable key solo permite lo que RLS autoriza).
// Se pueden sobrescribir con un .env local.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://ujfhvhoutlqphbpwrgfq.supabase.co'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_9HMoKVIP8AH0NAx3W1onaA_mUXi7spd'

// flowType 'implicit': el botón del correo ({{ .ConfirmationURL }}) funciona aunque se abra en otro
// navegador del celular. El regreso (#access_token=...) lo procesa leerRegresoDelCorreo() en main.tsx,
// antes de que el HashRouter interprete el hash como una ruta.
export const supabase = createClient(url, key, {
  auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

// Solo en desarrollo local, para pruebas desde la consola del navegador
if (import.meta.env.DEV) (window as unknown as { supabase: typeof supabase }).supabase = supabase

// Adonde vuelve la persona después de tocar el botón del correo (debe estar en Redirect URLs)
export const urlRegreso = () => window.location.origin + window.location.pathname

export const SESION_DIAS = 7
