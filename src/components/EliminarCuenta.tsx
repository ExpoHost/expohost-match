import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/utilidades'
import { Aviso } from './ui'

// Cerrar sesión con aviso: sin contraseñas, volver a entrar exige un código nuevo
export function CerrarSesion() {
  const [confirmar, setConfirmar] = useState(false)
  if (!confirmar) return <button className="mt-2 block min-h-11 text-sm font-semibold text-tinta-suave" onClick={() => setConfirmar(true)}>Cerrar sesión en este celular</button>
  return (
    <div className="mt-2 space-y-3 rounded-2xl bg-white p-4">
      <p className="text-sm text-tinta-suave">Para volver a entrar tendrás que pedir un código nuevo a tu correo. ¿Seguro?</p>
      <div className="flex gap-3">
        <button className="btn-secundario flex-1" onClick={() => setConfirmar(false)}>No, seguir aquí</button>
        <button className="btn-primario flex-1" onClick={() => supabase.auth.signOut({ scope: 'local' })}>Sí, cerrar sesión</button>
      </div>
    </div>
  )
}

// Ley 1581: la persona puede suprimir sus datos. La RPC cancela reuniones, borra matches y anonimiza.
export function EliminarCuenta() {
  const [paso, setPaso] = useState<0 | 1>(0)
  const [error, setError] = useState<string | null>(null)
  const [borrando, setBorrando] = useState(false)

  async function eliminar() {
    setBorrando(true); setError(null)
    // primero la foto (el almacenamiento solo se puede borrar con sesión)
    const { data: u } = await supabase.auth.getUser()
    if (u.user) {
      const { data: fotos } = await supabase.storage.from('fotos').list(u.user.id)
      if (fotos?.length) await supabase.storage.from('fotos').remove(fotos.map((f) => `${u.user!.id}/${f.name}`))
    }
    const { error } = await supabase.rpc('eliminar_mi_cuenta')
    if (error) { setError(mensajeError(error)); setBorrando(false); return }
    await supabase.auth.signOut({ scope: 'local' })
    window.location.hash = '#/'
  }

  return (
    <div className="mt-8 border-t border-linea pt-6">
      {paso === 0 ? (
        <button className="min-h-11 text-sm font-semibold text-tinta-suave" onClick={() => setPaso(1)}>Eliminar mi cuenta</button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-tinta-suave">Se cancelarán tus reuniones, se borrarán tus matches y tu perfil dejará de existir. No se puede deshacer.</p>
          {error && <Aviso>{error}</Aviso>}
          <div className="flex gap-3">
            <button className="btn-secundario flex-1" onClick={() => setPaso(0)}>No, conservar</button>
            <button className="btn flex-1 border border-rosa bg-rosa/10 text-[#B0103F]" onClick={eliminar} disabled={borrando}>{borrando ? 'Eliminando…' : 'Sí, eliminar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
