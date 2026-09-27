import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
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
    // Con datos móviles lentos no se deja la pantalla en blanco: a los 10 s se sigue con la sesión guardada localmente
    const { error } = await Promise.race([
      supabase.auth.setSession({ access_token, refresh_token }),
      new Promise<{ error: null }>((r) => setTimeout(() => r({ error: null }), 10_000)),
    ])
    limpiar(error ? '#/entrar?error=enlace' : '#/')
  } else {
    limpiar('#/entrar?error=enlace')
  }
}

leerRegresoDelCorreo().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  ),
)
