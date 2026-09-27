import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/utilidades'
import { Aviso } from './ui'

// Paso de confirmación: la persona escribe el código del correo (o usa el botón del correo)
export function Codigo({ email, onReenviar, onCambiarCorreo }: { email: string; onReenviar: () => Promise<void>; onCambiarCorreo: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function verificar(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6,8}$/.test(codigo)) { setError('Escribe el código de 6 dígitos que te enviamos.'); return }
    setEnviando(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({ email, token: codigo, type: 'email' })
    // Si funciona, la sesión cambia y la app navega sola
    if (error) { setError(mensajeError(error)); setEnviando(false) }
  }

  async function reenviar() {
    setError(null); setInfo(null)
    try { await onReenviar(); setInfo('Te enviamos un código nuevo.') } catch (e) { setError(mensajeError(e)) }
  }

  return (
    <form onSubmit={verificar} className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Revisa tu correo</h1>
        <p className="mt-2 text-tinta-suave">Enviamos un correo a <strong className="text-tinta">{email}</strong>. Toca el enlace del correo para entrar. Si el correo trae un código, también puedes escribirlo aquí.</p>
      </div>
      <label className="block">
        <span className="etiqueta">Código (si lo recibiste)</span>
        <input className="campo text-center text-2xl font-bold tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code"
          maxLength={8} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} autoFocus />
      </label>
      {error && <Aviso>{error}</Aviso>}
      {info && <Aviso tipo="ok">{info}</Aviso>}
      <button className="btn-primario w-full" disabled={enviando}>{enviando ? 'Verificando…' : 'Entrar'}</button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onCambiarCorreo} className="min-h-11 font-semibold text-tinta-suave">Cambiar correo</button>
        <button type="button" onClick={reenviar} className="min-h-11 font-semibold text-azul">Reenviar código</button>
      </div>
      <p className="text-xs text-tinta-suave">Si no lo ves en unos minutos, revisa la carpeta de spam o promociones.</p>
    </form>
  )
}
