import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Aviso, Pantalla } from '../components/ui'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/utilidades'

// Destino del botón del correo: #/confirmar?th=<token_hash>&t=email|invite
// El enlace no abre la sesión por sí solo: hace falta tocar el botón. Así, los escáneres de
// correo corporativo (que "abren" los enlaces para revisarlos) no gastan el acceso.
export default function Confirmar() {
  const [params] = useSearchParams()
  const th = params.get('th') ?? ''
  const tipo = params.get('t') === 'invite' ? 'invite' : 'email'
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar() {
    setEnviando(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({ token_hash: th, type: tipo })
    // si funciona, la sesión cambia y la app navega sola
    if (error) { setError(mensajeError(error)); setEnviando(false) }
  }

  if (!th) return <Pantalla><Aviso>El enlace está incompleto. Abre el correo de nuevo o pide un código desde "Entrar".</Aviso></Pantalla>
  return (
    <Pantalla>
      <div className="space-y-5">
        <h1 className="text-2xl font-extrabold">{tipo === 'invite' ? 'Bienvenido a Expohost Match' : 'Ya casi entras'}</h1>
        <p className="text-tinta-suave">{tipo === 'invite' ? 'Toca el botón para crear tu perfil de expositor.' : 'Toca el botón para abrir tu sesión en este navegador.'}</p>
        {error && <Aviso>{error}</Aviso>}
        <button className="btn-primario w-full" onClick={entrar} disabled={enviando}>{enviando ? 'Abriendo…' : 'Entrar a Expohost Match'}</button>
        {error && <Link to="/entrar" className="btn-secundario w-full">Pedir un código nuevo</Link>}
      </div>
    </Pantalla>
  )
}
