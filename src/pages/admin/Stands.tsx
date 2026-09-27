import { useCallback, useEffect, useState } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { descargarCsv } from '../../lib/csv'
import { mensajeError } from '../../lib/utilidades'

type Fila = { stand: string; empresa: string; correos: string[]; categoria: string | null }

// Lista oficial de stands: empresa · stand · correos o dominios autorizados (separados por espacio o coma)
function parsear(texto: string): Fila[] {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const sep = (l: string) => (l.includes('\t') ? '\t' : l.includes(';') ? ';' : ',')
  const filas = lineas.map((l) => l.split(sep(l)).map((c) => c.trim().replace(/^"|"$/g, '')))
  if (filas[0] && /empresa|stand/i.test(filas[0].join(' '))) filas.shift()
  return filas.map((c) => ({
    empresa: c[0] ?? '', stand: (c[1] ?? '').toUpperCase().replace(/[\s\-_.]/g, ''),
    correos: (c[2] ?? '').split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean), categoria: c[3]?.trim() || null,
  })).filter((f) => f.empresa && f.stand)
}

export default function Stands() {
  const [lista, setLista] = useState<Fila[]>([])
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('stand_list').select('stand, empresa, correos, categoria').order('stand')
    setLista(data ?? [])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const nuevas = parsear(texto)

  async function guardar() {
    setError(null); setOk(null)
    const { error } = await supabase.from('stand_list').upsert(nuevas, { onConflict: 'stand' })
    if (error) { setError(mensajeError(error)); return }
    setOk(`${nuevas.length} stand(s) guardados.`); setTexto(''); cargar()
  }
  async function borrar(stand: string) {
    const { error } = await supabase.from('stand_list').delete().eq('stand', stand)
    if (error) setError(mensajeError(error)); else cargar()
  }

  return (
    <div className="space-y-8">
      <section className="tarjeta space-y-3 p-5">
        <h2 className="text-lg font-extrabold">Lista oficial de stands</h2>
        <p className="text-sm text-tinta-suave">
          Pega filas en este orden: <strong>empresa · stand · correos autorizados</strong> (uno o varios, o un dominio como <code>@empresa.com</code>) · categoría (opcional).
          Quien se registre como "Expositor con stand" con un stand de esta lista y un correo autorizado queda aprobado automáticamente. Si el correo no coincide, queda pendiente y verás aquí a quién pertenece el stand.
        </p>
        <textarea className="campo min-h-32 py-3 font-mono text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'Demo PMS Andino;A-01;laura@pmsandino.com @pmsandino.com;tecnologia\nDemo Lencería;B-07;@lenceria.co'} aria-label="Filas de stands" />
        {nuevas.length > 0 && <p className="text-sm text-tinta-suave">{nuevas.length} fila(s) listas para guardar. Los stands repetidos se actualizan.</p>}
        {error && <Aviso>{error}</Aviso>}
        {ok && <Aviso tipo="ok">{ok}</Aviso>}
        <button className="btn-primario" disabled={nuevas.length === 0} onClick={guardar}>Guardar en la lista</button>
      </section>
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-extrabold">Stands cargados ({lista.length})</h2>
          {lista.length > 0 && <button className="btn-secundario ml-auto text-sm" onClick={() => descargarCsv('stands', lista.map((f) => ({ empresa: f.empresa, stand: f.stand, correos: f.correos, categoria: f.categoria })))}>Exportar CSV</button>}
        </div>
        {lista.length === 0 && <p className="text-sm text-tinta-suave">Aún no hay stands cargados.</p>}
        <ul className="space-y-1 text-sm">
          {lista.map((f) => (
            <li key={f.stand} className="flex items-center justify-between gap-2 rounded-2xl bg-white px-3 py-2">
              <span><strong>{f.stand}</strong> · {f.empresa} <span className="text-tinta-suave">· {f.correos.join(', ') || 'sin correos (no se aprueba solo)'}</span></span>
              <button className="min-h-9 text-xs font-semibold text-[#B0103F]" onClick={() => borrar(f.stand)}>Quitar</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
