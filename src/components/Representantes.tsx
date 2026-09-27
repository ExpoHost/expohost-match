import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/utilidades'
import { Aviso } from './ui'

type Empresa = {
  id: string; nombre: string; tipo: 'asistente' | 'expositor'; stand: string | null; prefiere_zona_match: boolean
  integrantes: { id: string; nombre: string; cargo: string | null; invitado: boolean }[]
  invitaciones: { email: string; created_at: string }[]
}

// Sección del perfil para empresas expositoras/proveedoras: hasta 3 representantes por empresa
export function Representantes() {
  const [e, setE] = useState<Empresa | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('mi_empresa')
    setE(data)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  if (!e || e.tipo !== 'expositor') return null
  const cupo = 3 - e.integrantes.length - e.invitaciones.length

  async function invitar(ev: FormEvent) {
    ev.preventDefault(); setError(null); setOk(null)
    const { error } = await supabase.rpc('invitar_representante', { p_email: email })
    if (error) { setError(mensajeError(error)); return }
    setOk('Listo. Cuando esa persona cree su perfil con ese correo, quedará en tu empresa.')
    setEmail(''); cargar()
  }
  async function retirar(correo: string) {
    const { error } = await supabase.rpc('retirar_invitacion', { p_email: correo })
    if (error) setError(mensajeError(error)); else cargar()
  }
  async function zonaMatch(v: boolean) {
    const { error } = await supabase.from('companies').update({ prefiere_zona_match: v }).eq('id', e!.id)
    if (error) setError(mensajeError(error)); else cargar()
  }

  return (
    <section className="tarjeta mt-4 space-y-3 p-5">
      <h2 className="text-xs font-bold uppercase tracking-wider text-tinta-suave">{e.nombre}{e.stand ? ` · Stand ${e.stand}` : ' · Proveedor / servicio'}</h2>
      <ul className="space-y-1 text-sm">
        {e.integrantes.map((p) => <li key={p.id}>{p.nombre}{p.cargo ? ` · ${p.cargo}` : ''}{p.invitado ? ' · sin completar perfil' : ''}</li>)}
        {e.invitaciones.map((i) => (
          <li key={i.email} className="flex items-center justify-between gap-2 text-tinta-suave">
            <span>{i.email} · invitación pendiente</span>
            <button className="min-h-9 text-xs font-semibold text-azul" onClick={() => retirar(i.email)}>Retirar</button>
          </li>
        ))}
      </ul>
      {cupo > 0 ? (
        <form onSubmit={invitar} className="flex items-end gap-2">
          <label className="block flex-1"><span className="etiqueta">Agregar representante (correo)</span>
            <input className="campo" type="email" inputMode="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="colega@empresa.com" /></label>
          <button className="btn-primario">Agregar</button>
        </form>
      ) : <p className="text-xs text-tinta-suave">Tu empresa ya tiene los 3 representantes.</p>}
      <p className="text-xs text-tinta-suave">Cada representante tiene su propio perfil, sus matches y su agenda. Pídele que cree su perfil con ese correo.</p>
      {e.stand && (
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-azul" checked={e.prefiere_zona_match} onChange={(ev) => zonaMatch(ev.target.checked)} />
          Prefiero reunirme en la Zona Match en vez del stand
        </label>
      )}
      {error && <Aviso>{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
    </section>
  )
}
