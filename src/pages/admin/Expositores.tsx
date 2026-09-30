import { useState } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { mensajeError } from '../../lib/utilidades'
import type { Participante } from './tipos'

type Fila = { empresa: string; stand: string; nombre: string; email: string; categoria: string }
type Resultado = { email: string; estado: string; detalle?: string }

// Acepta CSV separado por ; o , (o pegado desde Excel, con tabulador), con o sin encabezado.
// Columnas: empresa, stand, nombre, correo, categoría (slug o nombre, opcional)
function parsear(texto: string): Fila[] {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const sep = (l: string) => (l.includes('\t') ? '\t' : l.includes(';') ? ';' : ',')
  const filas = lineas.map((l) => l.split(sep(l)).map((c) => c.trim().replace(/^"|"$/g, '')))
  if (filas[0] && /empresa|correo|email/i.test(filas[0].join(' '))) filas.shift()
  return filas.map((c) => ({ empresa: c[0] ?? '', stand: c[1] ?? '', nombre: c[2] ?? '', email: c[3] ?? '', categoria: c[4] ?? '' }))
    .filter((f) => f.empresa || f.email)
}

export default function Expositores({ participantes, recargar }: { participantes: Participante[] | null; recargar: () => Promise<void> }) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Resultado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const filas = parsear(texto)
  const invalidas = filas.filter((f) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) || f.empresa.length < 2)
  const invitados = participantes?.filter((p) => p.invitado) ?? []

  async function enviar(modo: 'invitar' | 'crear' | 'ensayar') {
    setEnviando(true); setError(null); setResultados(null)
    const { data, error } = await supabase.functions.invoke('invitar-expositores', { body: { filas, solo_crear: modo === 'crear', solo_validar: modo === 'ensayar' } })
    setEnviando(false)
    if (error) { setError(mensajeError(error)); return }
    setResultados(data.resultados)
    if (modo !== 'ensayar') { setTexto(''); recargar() }
  }

  return (
    <div className="space-y-8">
      <section className="tarjeta space-y-3 p-5">
        <h2 className="text-lg font-extrabold">Cargar expositores e invitarlos</h2>
        <p className="text-sm text-tinta-suave">
          Pega las filas desde Excel o un CSV, una por persona, en este orden: <strong>empresa · stand · nombre · correo · categoría</strong> (la categoría es opcional).
          Hasta 100 filas por envío.
        </p>
        <textarea className="campo min-h-40 py-3 font-mono text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'Demo PMS Andino;A-01;Laura Gómez;laura@demo.com;tecnologia\nDemo Lencería;B-07;Andrés Rojas;andres@demo.com'} aria-label="Filas de expositores" />
        {filas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-tinta-suave"><th className="py-1 pr-3">Empresa</th><th className="py-1 pr-3">Stand</th><th className="py-1 pr-3">Nombre</th><th className="py-1 pr-3">Correo</th><th className="py-1">Categoría</th></tr></thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i} className={invalidas.includes(f) ? 'text-[#B0103F]' : ''}>
                    <td className="py-1 pr-3">{f.empresa}</td><td className="py-1 pr-3">{f.stand}</td><td className="py-1 pr-3">{f.nombre}</td><td className="py-1 pr-3">{f.email}</td><td className="py-1">{f.categoria}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {invalidas.length > 0 && <Aviso>{invalidas.length} fila(s) en rojo tienen correo o empresa inválidos y se omitirán.</Aviso>}
        {error && <Aviso>{error}</Aviso>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-secundario" disabled={enviando || filas.length === 0} onClick={() => enviar('ensayar')}>Ensayar (no envía nada)</button>
          <button className="btn-primario" disabled={enviando || filas.length === 0} onClick={() => { if (window.confirm(`¿Enviar ${filas.length} invitación(es) por correo ahora?`)) enviar('invitar') }}>{enviando ? 'Enviando…' : `Crear e invitar por correo (${filas.length})`}</button>
          <button className="btn-secundario" disabled={enviando || filas.length === 0} onClick={() => enviar('crear')}>Solo crear, sin enviar correo</button>
        </div>
        {resultados && (
          <ul className="space-y-1 text-sm">
            {resultados.map((r, i) => <li key={i} className={r.estado === 'error' || r.estado === 'omitida' ? 'text-[#B0103F]' : 'text-[#006B6B]'}>{r.email}: {r.estado}{r.detalle ? ` · ${r.detalle}` : ''}</li>)}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-extrabold">Invitados que aún no entran ({invitados.length})</h2>
        {invitados.length === 0 && <p className="text-sm text-tinta-suave">Nadie pendiente.</p>}
        <ul className="space-y-1 text-sm">
          {invitados.map((p) => <li key={p.id} className="rounded-2xl bg-white px-3 py-2">{p.email} · {p.empresa ?? 'sin empresa'}{p.stand ? ` · Stand ${p.stand}` : ''} · invitado el {p.created_at.slice(0, 10)}</li>)}
        </ul>
        <p className="text-xs text-tinta-suave">Para reenviar una invitación, vuelve a cargar la fila: si el correo ya existe, solo se vincula a la empresa; la persona puede entrar con "Entrar" y su correo.</p>
      </section>
    </div>
  )
}
