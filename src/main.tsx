import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { supabase } from './lib/supabase'
import './index.css'

// Regreso desde el botón del correo: la URL trae #access_token=...&refresh_token=... (o #error=...).
// Se abre la sesión y se deja el hash limpio para el router.
async function leerRegresoDelCorreo() {
  const h = window.location.hash
  if (!/(^#|&)(access_token|error)=/.test(h)) return
  const p = new URLSearchParams(h.slice(1))
  const limpiar = (ruta: string) => history.replaceState(null, '', window.location.pathname + ruta)
  const access_token = p.get('access_token'), refresh_token = p.get('refresh_token')
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token })
    limpiar(error ? '#/entrar?error=enlace' : '#/')
  } else {
    limpiar('#/entrar?error=enlace')
  }
}

leerRegresoDelCorreo().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
