import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/utilidades'
import { Aviso } from './ui'

// Ley 1581: la persona puede suprimir sus datos. La RPC cancela reuniones, borra matches y anonimiza.
export function EliminarCuenta() {
  const [paso, setPaso] = useState<0 | 1>(0)
  const [error, setError] = useState<string | null>(null)
  const [borrando, setBorrando] = useState(false)

  async function eliminar() {
    setBorrando(true); setError(null)
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
