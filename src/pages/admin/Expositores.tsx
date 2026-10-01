import { useState, type FormEvent } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { mensajeError } from '../../lib/utilidades'
import { esEmpresaExpositora, estadoPersona, type Participante } from './tipos'

type Fila = { empresa: string; stand: string; nombre: string; email: string; categoria: string }
type Resultado = { email: string; estado: string; detalle?: string }

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const APP = 'https://match.expohost.travel'
const MENSAJE_ASISTENTE = `Hola. Te invito a Expohost Match, la app de ExpoHost para agendar reuniones uno a uno en la feria, el 6 y 7 de octubre en Bogotá. Creas tu perfil en 3 minutos, eliges con quién quieres reunirte y la cita queda agendada. Entra aquí: ${APP}`

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

// Lo que respondió la función, en palabras claras
function textoResultado(r: Resultado) {
  if (r.estado === 'invitado') return 'invitación enviada por correo'
  if (r.estado === 'invitación reenviada') return 'invitación reenviada'
  if (r.estado === 'vinculado' || r.estado.startsWith('ya tenía perfil')) return 'ese correo ya tenía cuenta: quedó unido a la empresa, sin correo nuevo. Puede entrar con "Entrar".'
  return `${r.estado}${r.detalle ? ` · ${r.detalle}` : ''}`
}
const salioBien = (r: Resultado) => r.estado !== 'error' && r.estado !== 'omitida'

export default function Expositores({ participantes, recargar }: { participantes: Participante[] | null; recargar: () => Promise<void> }) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Resultado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const filas = parsear(texto)
  const invalidas = filas.filter((f) => !CORREO.test(f.email) || f.empresa.length < 2)

  // Personas de empresas expositoras (invitadas o que se registraron solas), sin las que se sacaron de la app
  const deEmpresa = (participantes ?? []).filter((p) => esEmpresaExpositora(p) && estadoPersona(p) !== 'fuera')
  const listos = deEmpresa.filter((p) => estadoPersona(p) === 'completo')
  const faltan = deEmpresa.filter((p) => estadoPersona(p) !== 'completo')
  const sinEntrar = faltan.filter((p) => estadoPersona(p) === 'invitado' && p.email)

  async function llamar(clave: string, body: Record<string, unknown>) {
    setEnviando(clave); setError(null); setAviso(null); setResultados(null)
    const { data, error } = await supabase.functions.invoke('invitar-expositores', { body })
    setEnviando(null)
    if (error) { setError(mensajeError(error)); return null }
    return (data?.resultados ?? []) as Resultado[]
  }

  async function enviarLista(modo: 'invitar' | 'crear' | 'ensayar') {
    const r = await llamar('lista', { filas, solo_crear: modo === 'crear', solo_validar: modo === 'ensayar' })
    if (!r) return
    setResultados(r)
    if (modo !== 'ensayar') { setTexto(''); recargar() }
  }

  async function invitarUno(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const form = ev.currentTarget
    const d = new FormData(form)
    const fila: Fila = { empresa: String(d.get('empresa') ?? '').trim(), stand: String(d.get('stand') ?? '').trim(), nombre: String(d.get('nombre') ?? '').trim(), email: String(d.get('email') ?? '').trim().toLowerCase(), categoria: '' }
    if (fila.empresa.length < 2) { setError('Escribe el nombre de la empresa.'); return }
    if (!CORREO.test(fila.email)) { setError('Escribe un correo válido.'); return }
    if (!window.confirm(`¿Enviar la invitación de expositor a ${fila.email}?`)) return
    const r = await llamar('uno', { filas: [fila] })
    if (!r) return
    const uno = r[0]
    if (uno && salioBien(uno)) { setAviso(`${fila.email}: ${textoResultado(uno)}.`); form.reset(); recargar() }
    else setError(`${fila.email}: ${uno ? textoResultado(uno) : 'no se pudo invitar'}`)
  }

  async function reenviar(correos: string[], clave: string) {
    if (correos.length > 1 && !window.confirm(`¿Reenviar la invitación a las ${correos.length} personas que no han entrado?`)) return
    const r = await llamar(clave, { reenviar: correos })
    if (!r) return
    const bien = r.filter((x) => x.estado === 'invitación reenviada').length
    if (correos.length === 1) {
      if (bien) setAviso(`Invitación reenviada a ${correos[0]}.`); else setError(`${correos[0]}: ${r[0] ? textoResultado(r[0]) : 'no se pudo reenviar'}`)
    } else {
      setAviso(`Invitación reenviada a ${bien} de ${correos.length} personas.`)
      if (bien < r.length) setResultados(r.filter((x) => x.estado !== 'invitación reenviada'))
    }
    recargar()
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(MENSAJE_ASISTENTE); setCopiado(true); setTimeout(() => setCopiado(false), 2500) } catch { setError('No pudimos copiar. Selecciona el texto y cópialo a mano.') }
  }

  if (!participantes) return <p className="text-tinta-suave" role="status">Cargando…</p>

  return (
    <div className="space-y-6">
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}

      <section className="tarjeta space-y-4 p-5">
        <div>
          <h2 className="text-lg font-extrabold">Cómo van los expositores</h2>
          <p className="text-sm text-tinta-suave"><strong className="text-tinta">{listos.length} de {deEmpresa.length}</strong> ya crearon su perfil. Faltan {faltan.length}.</p>
        </div>

        <details open={faltan.length > 0 && faltan.length <= 12}>
          <summary className="flex min-h-11 cursor-pointer items-center font-bold text-[#8A4500]">Faltan por crear su perfil ({faltan.length})</summary>
          {sinEntrar.length > 1 && (
            <button className="btn-secundario mt-2 min-h-11 text-sm" disabled={enviando !== null} onClick={() => reenviar(sinEntrar.map((p) => p.email!), 'todos')}>
              {enviando === 'todos' ? 'Reenviando…' : `Reenviar la invitación a los ${sinEntrar.length} que no han entrado`}
            </button>
          )}
          {faltan.length === 0 && <p className="mt-2 text-sm text-tinta-suave">No falta nadie.</p>}
          <ul className="mt-2 space-y-1 text-sm">
            {faltan.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-hueso px-3 py-2">
                <span className="min-w-0 break-words">
                  <strong>{p.empresa ?? 'Sin empresa'}</strong>{p.stand ? ` · Stand ${p.stand}` : ' · sin stand'}<br />
                  <span className="text-tinta-suave">{p.email} · {estadoPersona(p) === 'invitado' ? 'no ha entrado' : 'entró, pero no terminó el perfil'}</span>
                </span>
                {estadoPersona(p) === 'invitado' && p.email && (
                  <button className="btn-secundario min-h-11 px-4 text-sm" disabled={enviando !== null} onClick={() => reenviar([p.email!], p.id)}>{enviando === p.id ? 'Enviando…' : 'Reenviar invitación'}</button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-tinta-suave">El botón del correo sirve 24 horas. Quien ya entró y no terminó no necesita otra invitación: entra con "Entrar" y su correo.</p>
        </details>

        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-bold text-[#006B6B]">Ya crearon su perfil ({listos.length})</summary>
          {listos.length === 0 && <p className="mt-2 text-sm text-tinta-suave">Todavía nadie.</p>}
          <ul className="mt-2 space-y-1 text-sm">
            {listos.map((p) => (
              <li key={p.id} className="rounded-2xl bg-hueso px-3 py-2"><strong>{p.empresa}</strong>{p.stand ? ` · Stand ${p.stand}` : ' · sin stand'} · {p.nombre} <span className="text-tinta-suave">· {p.matches} matches · {p.reuniones} reuniones</span></li>
            ))}
          </ul>
        </details>
      </section>

      <section className="tarjeta space-y-3 p-5">
        <h2 className="text-lg font-extrabold">Invitar a un expositor</h2>
        <p className="text-sm text-tinta-suave">Le llega el correo de invitación para expositores y queda aprobado desde ya: no tienes que aprobarlo después.</p>
        <form onSubmit={invitarUno} className="grid gap-3 sm:grid-cols-2" noValidate>
          <label className="block"><span className="etiqueta">Empresa</span><input name="empresa" className="campo" maxLength={80} autoComplete="off" /></label>
          <label className="block"><span className="etiqueta">Stand <span className="font-normal text-tinta-suave">(vacío si no tiene)</span></span><input name="stand" className="campo" maxLength={20} placeholder="Por ejemplo D04" autoComplete="off" /></label>
          <label className="block"><span className="etiqueta">Correo de la persona</span><input name="email" type="email" inputMode="email" className="campo" maxLength={120} autoComplete="off" /></label>
          <label className="block"><span className="etiqueta">Nombre <span className="font-normal text-tinta-suave">(opcional)</span></span><input name="nombre" className="campo" maxLength={80} autoComplete="off" /></label>
          <button className="btn-primario sm:col-span-2" disabled={enviando !== null}>{enviando === 'uno' ? 'Enviando…' : 'Enviar invitación'}</button>
        </form>
      </section>

      <section className="tarjeta space-y-3 p-5">
        <h2 className="text-lg font-extrabold">Invitar a un asistente</h2>
        <p className="text-sm text-tinta-suave">Los asistentes no necesitan invitación ni aprobación: crean su perfil solos desde el enlace. Envíales este mensaje.</p>
        <p className="rounded-2xl bg-hueso px-4 py-3 text-sm">{MENSAJE_ASISTENTE}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secundario" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar mensaje'}</button>
          <a className="btn bg-[#1FA855] text-white" href={`https://wa.me/?text=${encodeURIComponent(MENSAJE_ASISTENTE)}`} target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a>
        </div>
      </section>

      <details className="tarjeta p-5">
        <summary className="flex min-h-11 cursor-pointer items-center text-lg font-extrabold">Invitar a varios expositores desde una lista</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-tinta-suave">
            Pega las filas desde Excel o un CSV, una por persona, en este orden: <strong>empresa · stand · nombre · correo · categoría</strong> (el nombre y la categoría son opcionales).
            Hasta 100 filas por envío.
          </p>
          <textarea className="campo min-h-40 py-3 font-mono text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'PMS Andino;A-01;Laura Gómez;laura@empresa.com;tecnologia\nLencería Hotelera;B-07;;andres@empresa.com'} aria-label="Filas de expositores" />
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
          <div className="flex flex-wrap gap-2">
            <button className="btn-secundario" disabled={enviando !== null || filas.length === 0} onClick={() => enviarLista('ensayar')}>Ensayar (no envía nada)</button>
            <button className="btn-primario" disabled={enviando !== null || filas.length === 0} onClick={() => { if (window.confirm(`¿Enviar ${filas.length} invitación(es) por correo ahora?`)) enviarLista('invitar') }}>{enviando === 'lista' ? 'Enviando…' : `Crear e invitar por correo (${filas.length})`}</button>
            <button className="btn-secundario" disabled={enviando !== null || filas.length === 0} onClick={() => enviarLista('crear')}>Solo crear, sin enviar correo</button>
          </div>
        </div>
      </details>

      {resultados && resultados.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Resultado">
          {resultados.map((r, i) => <li key={i} className={salioBien(r) ? 'text-[#006B6B]' : 'text-[#B0103F]'}>{r.email}: {textoResultado(r)}</li>)}
        </ul>
      )}
    </div>
  )
}
