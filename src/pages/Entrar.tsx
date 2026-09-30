import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { Aviso, Pantalla } from '../components/ui'
import { Codigo } from '../components/Codigo'
import { supabase, urlRegreso } from '../lib/supabase'
import { mensajeError } from '../lib/utilidades'

const esquema = z.string().trim().toLowerCase().email('Escribe un correo válido')

export default function Entrar() {
  // Recuerda el último correo usado en este navegador para que volver a entrar sea un toque
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('expohost-ultimo-correo') ?? '' } catch { return '' } })
  const [enviado, setEnviado] = useState(false)
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(params.get('error') === 'enlace' ? 'El enlace del correo ya se usó o venció. Pide un código nuevo.' : null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(correo: string) {
    const { error } = await supabase.auth.signInWithOtp({ email: correo, options: { shouldCreateUser: false, emailRedirectTo: urlRegreso() } })
    if (error) throw error
  }

  async function pedir(e: FormEvent) {
    e.preventDefault()
    const r = esquema.safeParse(email)
    if (!r.success) { setError(r.error.issues[0]!.message); return }
    setEnviando(true); setError(null)
    try {
      await enviar(r.data); setEmail(r.data); setEnviado(true)
      try { localStorage.setItem('expohost-ultimo-correo', r.data) } catch { /* sin almacenamiento */ }
    } catch (err) { setError(mensajeError(err)) }
    setEnviando(false)
  }

  if (enviado) return <Pantalla><Codigo email={email} onReenviar={() => enviar(email)} onCambiarCorreo={() => setEnviado(false)} /></Pantalla>

  return (
    <Pantalla volver="/">
      <form onSubmit={pedir} className="space-y-5" noValidate>
        <div>
          <h1 className="text-2xl font-extrabold">Entrar</h1>
          <p className="mt-2 text-tinta-suave">Escribe el correo con el que creaste tu perfil. Te enviaremos un código.</p>
        </div>
        <label className="block"><span className="etiqueta">Correo</span>
          <input className="campo" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        {error && <Aviso>{error}</Aviso>}
        <button className="btn-primario w-full" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar código'}</button>
        <button type="button" className="min-h-11 w-full text-sm font-semibold text-azul" onClick={() => { const r = esquema.safeParse(email); if (!r.success) { setError('Escribe primero tu correo.'); return } setEmail(r.data); setError(null); setEnviado(true) }}>Ya tengo un código</button>
        <p className="text-center text-sm text-tinta-suave">¿Aún no tienes perfil? <Link to="/registro" className="inline-flex min-h-11 items-center px-2 font-semibold text-azul">Créalo aquí</Link></p>
      </form>
    </Pantalla>
  )
}
