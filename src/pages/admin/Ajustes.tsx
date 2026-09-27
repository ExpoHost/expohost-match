import { useCallback, useEffect, useState } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { diaTexto, hora } from '../../lib/reuniones'
import { mensajeError } from '../../lib/utilidades'

type Bloque = { id: number; dia: string; inicio: string; bloqueado: boolean }
type Tag = { id: number; nombre: string; activo: boolean; orden: number }

export default function Ajustes() {
  const [mesas, setMesas] = useState('')
  const [bloques, setBloques] = useState<Bloque[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [nuevaTag, setNuevaTag] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [s, b, t] = await Promise.all([
      supabase.from('settings').select('value').eq('key', 'num_mesas').maybeSingle(),
      supabase.from('blocks').select('id, dia, inicio, bloqueado').order('dia').order('inicio'),
      supabase.from('tags').select('id, nombre, activo, orden').order('orden'),
    ])
    setMesas(String(s.data?.value ?? 10))
    setBloques(b.data ?? [])
    setTags(t.data ?? [])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function hacer(fn: () => PromiseLike<{ error: unknown }>, mensaje: string) {
    setError(null); setOk(null)
    const { error } = await fn()
    if (error) setError(mensajeError(error)); else { setOk(mensaje); await cargar() }
  }

  return (
    <div className="space-y-8">
      {error && <Aviso>{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}

      <section className="tarjeta space-y-3 p-5">
        <h2 className="text-lg font-extrabold">Zona Match</h2>
        <p className="text-sm text-tinta-suave">Número de mesas disponibles por bloque para reuniones entre asistentes o con proveedores sin stand.</p>
        <div className="flex items-end gap-2">
          <label className="block"><span className="etiqueta">Mesas</span><input className="campo w-28" type="number" min={0} max={50} value={mesas} onChange={(e) => setMesas(e.target.value)} /></label>
          <button className="btn-primario" onClick={() => hacer(() => supabase.from('settings').upsert({ key: 'num_mesas', value: Math.max(0, Math.min(50, Number(mesas) || 0)) }), 'Mesas guardadas.')}>Guardar</button>
        </div>
      </section>

      <section className="tarjeta space-y-3 p-5">
        <h2 className="text-lg font-extrabold">Bloques de reunión</h2>
        <p className="text-sm text-tinta-suave">Marca un bloque para bloquearlo (por ejemplo, durante la inauguración). Los bloqueados no se ofrecen a nadie.</p>
        {['2026-10-06', '2026-10-07'].map((d) => (
          <div key={d}>
            <h3 className="mb-2 text-sm font-bold">{diaTexto(d)}</h3>
            <div className="flex flex-wrap gap-2">
              {bloques.filter((b) => b.dia === d).map((b) => (
                <button key={b.id} aria-pressed={b.bloqueado} onClick={() => hacer(() => supabase.from('blocks').update({ bloqueado: !b.bloqueado }).eq('id', b.id), b.bloqueado ? 'Bloque habilitado.' : 'Bloque bloqueado.')}
                  className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${b.bloqueado ? 'border-rosa bg-rosa/10 text-[#B0103F] line-through' : 'border-linea bg-white'}`}>
                  {hora(b.inicio)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="tarjeta space-y-3 p-5">
        <h2 className="text-lg font-extrabold">Etiquetas Busco / Ofrezco</h2>
        <p className="text-sm text-tinta-suave">Desactivar una etiqueta la quita del registro; quien ya la tenía la conserva.</p>
        <ul className="space-y-1">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-2xl bg-hueso px-3 py-2 text-sm">
              <span className={t.activo ? '' : 'text-tinta-suave line-through'}>{t.nombre}</span>
              <button className="btn-secundario min-h-9 px-3 text-xs" onClick={() => hacer(() => supabase.from('tags').update({ activo: !t.activo }).eq('id', t.id), 'Etiqueta actualizada.')}>{t.activo ? 'Desactivar' : 'Activar'}</button>
            </li>
          ))}
        </ul>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const n = nuevaTag.trim(); if (n.length < 2) return; hacer(() => supabase.from('tags').insert({ nombre: n, orden: (tags.at(-1)?.orden ?? 0) + 1 }), 'Etiqueta agregada.'); setNuevaTag('') }}>
          <label className="block flex-1"><span className="etiqueta">Nueva etiqueta</span><input className="campo" value={nuevaTag} onChange={(e) => setNuevaTag(e.target.value)} maxLength={60} /></label>
          <button className="btn-primario">Agregar</button>
        </form>
      </section>
    </div>
  )
}
