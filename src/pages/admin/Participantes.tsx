import { useState } from 'react'
import { Avatar, Aviso, Etiquetas } from '../../components/ui'
import { FRANJAS } from '../../lib/catalogos'
import { diaTexto, hora, lugarTexto } from '../../lib/reuniones'
import { supabase } from '../../lib/supabase'
import { descargarCsv } from '../../lib/csv'
import { avisarReunion } from '../../lib/correos'
import { mensajeError, useCatalogos } from '../../lib/utilidades'
import { ASISTENCIA, ESTADOS, estadoPersona, etiquetaParticipacion, TIERS, type Estado, type Participante, type ReunionAdmin } from './tipos'

type Filtro = Estado | 'todos'
const FILTROS: { id: Filtro; texto: string; ayuda: string }[] = [
  { id: 'completo', texto: 'Ya tienen perfil', ayuda: 'Personas que terminaron su registro. Ya aparecen en la app y pueden agendar reuniones.' },
  { id: 'invitado', texto: 'Invitados sin entrar', ayuda: 'Les llegó la invitación por correo pero todavía no han entrado. Nadie los ve en la app.' },
  { id: 'sin_terminar', texto: 'Sin terminar', ayuda: 'Empezaron su registro pero no terminaron el perfil. Nadie los ve en la app hasta que lo terminen. A los 45 minutos les llega solo un correo para que lo retomen; también se lo puedes enviar tú.' },
  { id: 'fuera', texto: 'Fuera de la app', ayuda: 'Personas que la organización sacó. No pueden entrar y nadie las ve. Sus datos se conservan y se pueden volver a admitir.' },
  { id: 'todos', texto: 'Todos', ayuda: 'Todas las personas, en cualquier estado.' },
]
// Qué es cada persona dentro de la app (misma regla que las etiquetas: solo la empresa con stand es "Expositor")
type Tipo = 'expositor' | 'proveedor' | 'asistente' | 'pide'
const TIPOS: { id: Tipo; texto: string }[] = [
  { id: 'expositor', texto: 'Expositores (con stand)' },
  { id: 'proveedor', texto: 'Proveedores / servicio (sin stand)' },
  { id: 'asistente', texto: 'Asistentes' },
  { id: 'pide', texto: 'Pidieron ser expositores (por aprobar)' },
]
const tipoDe = (p: Participante): Tipo[] => {
  const t: Tipo[] = [p.tipo === 'expositor' && p.stand ? 'expositor' : p.empresa_tipo === 'expositor' ? 'proveedor' : 'asistente']
  if (p.solicitud && p.empresa_tipo !== 'expositor') t.push('pide')
  return t
}
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' })

// Ficha completa de una persona (solo la ve la organización)
function FichaPerfil({ p, categoria, reuniones }: { p: Participante; categoria: string; reuniones: ReunionAdmin[] | null }) {
  const suyas = (reuniones ?? []).filter((r) => r.a_id === p.id || r.b_id === p.id)
    .sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'confirmada' ? -1 : 1) || (a.dia + a.inicio).localeCompare(b.dia + b.inicio))
  const Dato = ({ t, children }: { t: string; children: React.ReactNode }) => (
    <div className="grid gap-1 border-t border-linea py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-bold uppercase tracking-wider text-tinta-suave">{t}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  )
  const nada = <span className="text-tinta-suave">Sin dato</span>
  return (
    <div className="mt-4 rounded-2xl bg-hueso p-4">
      <div className="flex items-center gap-4">
        <Avatar path={p.foto_path} nombre={p.nombre} tam="h-20 w-20 text-2xl" />
        <div className="min-w-0">
          <p className="text-lg font-extrabold leading-tight">{p.nombre}</p>
          <p className="text-sm text-tinta-suave">{[p.cargo, p.empresa].filter(Boolean).join(' · ') || 'Sin cargo ni empresa todavía'}</p>
          <p className="mt-1 text-xs font-bold text-azul">{etiquetaParticipacion(p)}</p>
        </div>
      </div>
      <dl className="mt-3">
        <Dato t="Sobre esta persona">{p.bio ? <span className="whitespace-pre-line">{p.bio}</span> : nada}</Dato>
        <Dato t="Categoría">{categoria || nada}</Dato>
        <Dato t="Ciudad">{p.ciudad || nada}</Dato>
        <Dato t="Busca">{p.busca.length ? <Etiquetas items={p.busca} color="rosa" /> : nada}</Dato>
        <Dato t="Ofrece">{p.ofrece.length ? <Etiquetas items={p.ofrece} color="azul" /> : nada}</Dato>
        <Dato t="Disponible">{p.franjas.length ? FRANJAS.filter((f) => p.franjas.includes(f.id)).map((f) => <span key={f.id} className="block">{f.dia}, {f.hora}</span>) : nada}</Dato>
        <Dato t="Correo">{p.email || nada}</Dato>
        <Dato t="Celular">{p.telefono || nada}</Dato>
        <Dato t="Empresa y stand">{p.empresa ? `${p.empresa}${p.stand ? ` · Stand ${p.stand}` : ''}${p.solicitud && p.empresa_tipo !== 'expositor' ? ` · pidió ser expositor${p.stand_declarado ? ` (declaró stand ${p.stand_declarado})` : ''}` : ''}` : nada}</Dato>
        <Dato t="Prioridad">{p.tier}</Dato>
        <Dato t="Información comercial">{p.acepta_comercial ? 'Aceptó recibirla' : 'No la aceptó'}</Dato>
        <Dato t="Registro">{`${p.invitado ? 'Invitado' : 'Se registró'} el ${fechaHora(p.created_at)}${p.ultima_entrada ? ` · última entrada: ${fechaHora(p.ultima_entrada)}` : ' · todavía no ha entrado'}`}</Dato>
        <Dato t="Actividad">{`${p.matches} matches · ${p.reuniones} reuniones confirmadas`}</Dato>
      </dl>
      <div className="border-t border-linea pt-3">
        <p className="text-xs font-bold uppercase tracking-wider text-tinta-suave">Sus reuniones</p>
        {reuniones === null ? <p className="mt-2 text-sm text-tinta-suave" role="status">Cargando reuniones…</p>
          : suyas.length === 0 ? <p className="mt-2 text-sm text-tinta-suave">Todavía no tiene reuniones.</p>
          : (
            <ul className="mt-2 space-y-2">
              {suyas.map((r) => {
                const yoA = r.a_id === p.id
                return (
                  <li key={r.id} className={`rounded-2xl bg-white px-3 py-2 text-sm ${r.estado === 'cancelada' ? 'opacity-60' : ''}`}>
                    <strong>{diaTexto(r.dia)}, {hora(r.inicio)}</strong> · {lugarTexto(r)}
                    <br />con {yoA ? r.b_nombre : r.a_nombre}{(yoA ? r.b_empresa : r.a_empresa) ? ` (${yoA ? r.b_empresa : r.a_empresa})` : ''}
                    <span className="text-tinta-suave"> · {r.estado === 'cancelada' ? 'cancelada' : `${(yoA ? r.confirmo_a : r.confirmo_b) ? 'confirmó' : 'sin confirmar'} · ${ASISTENCIA[yoA ? r.asistencia_a : r.asistencia_b]}`}</span>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </div>
  )
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' })

export default function Participantes({ participantes, recargar }: { participantes: Participante[] | null; recargar: () => Promise<void> }) {
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('completo')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [tipo, setTipo] = useState<Tipo | ''>('')
  const [busca, setBusca] = useState('')
  const [ofrece, setOfrece] = useState('')
  const [categoria, setCategoria] = useState('')
  const { categorias } = useCatalogos()
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set())
  const [reuniones, setReuniones] = useState<ReunionAdmin[] | null>(null)
  // abre o cierra la ficha; las reuniones se cargan la primera vez que se abre una
  function alternarFicha(id: string) {
    setAbiertos((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
    if (reuniones === null) supabase.rpc('admin_reuniones').then(({ data }) => setReuniones((data ?? []) as ReunionAdmin[]))
  }
  if (!participantes) return <p className="text-tinta-suave" role="status">Cargando…</p>

  const cuenta = (f: Filtro) => (f === 'todos' ? participantes.length : participantes.filter((p) => estadoPersona(p) === f).length)
  const q = busqueda.trim().toLowerCase()
  // al buscar por nombre se busca en todos los estados; los demás filtros se suman entre sí
  const base = participantes.filter((p) => (q ? [p.nombre, p.empresa, p.email, p.cargo, p.ciudad].some((v) => v?.toLowerCase().includes(q)) : filtro === 'todos' || estadoPersona(p) === filtro))
  const lista = base.filter((p) => (!tipo || tipoDe(p).includes(tipo)) && (!busca || p.busca.includes(busca)) && (!ofrece || p.ofrece.includes(ofrece)) && (!categoria || p.categoria === categoria))
  const hayFiltros = !!(tipo || busca || ofrece || categoria)
  const quitarFiltros = () => { setTipo(''); setBusca(''); setOfrece(''); setCategoria('') }
  // opciones con su conteo dentro del estado elegido; solo las que alguien tiene (más la elegida)
  const contar = (valores: string[]) => { const m = new Map<string, number>(); for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1); return m }
  const nBusca = contar(base.flatMap((p) => p.busca)), nOfrece = contar(base.flatMap((p) => p.ofrece)), nCat = contar(base.map((p) => p.categoria ?? '').filter(Boolean))
  const opciones = (m: Map<string, number>, elegido: string) => [...new Set([...m.keys(), ...(elegido ? [elegido] : [])])].sort((a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0) || a.localeCompare(b, 'es'))
  const nombreCategoria = (slug: string) => categorias.find((c) => c.slug === slug)?.nombre ?? slug

  async function cambiarPrioridad(p: Participante, tier: string) {
    setError(null); setAviso(null)
    const { error } = await supabase.rpc('admin_participante', { p_user: p.id, p_tier: tier })
    if (error) setError(mensajeError(error)); else await recargar()
  }

  async function sacar(p: Participante) {
    const reuniones = p.reuniones > 0 ? ` Se cancelarán sus ${p.reuniones} reunión(es) y se avisará por correo a las otras personas.` : ''
    if (!window.confirm(`¿Sacar a ${p.nombre} de la app?\n\nNo podrá entrar y nadie verá su perfil.${reuniones}\n\nSus datos NO se borran: quedan guardados y puedes volver a admitirla cuando quieras.`)) return
    setOcupado(p.id); setError(null); setAviso(null)
    const { data, error } = await supabase.rpc('admin_sacar', { p_user: p.id, p_sacar: true })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    for (const id of (data as string[] | null) ?? []) avisarReunion(id, 'cancelada')
    setAviso(`${p.nombre} quedó fuera de la app. La encuentras en "Fuera de la app" si quieres volver a admitirla.`)
    await recargar()
  }

  async function admitir(p: Participante) {
    setOcupado(p.id); setError(null); setAviso(null)
    const { error } = await supabase.rpc('admin_sacar', { p_user: p.id, p_sacar: false })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    setAviso(`${p.nombre} puede volver a entrar a la app con su correo.`)
    await recargar()
  }

  async function recordar(p: Participante) {
    setOcupado(p.id); setError(null); setAviso(null)
    const { data, error } = await supabase.functions.invoke('correo-recordatorio', { body: { user_id: p.id } })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    if (data?.enviado && data.personas > 0) { setAviso(`Le enviamos el recordatorio a ${p.email}.`); await recargar() }
    else setError(`No se envió el recordatorio a ${p.email}${data?.motivo ? `: ${data.motivo}` : '.'}`)
  }

  async function reenviar(p: Participante) {
    if (!p.email) return
    setOcupado(p.id); setError(null); setAviso(null)
    const { data, error } = await supabase.functions.invoke('invitar-expositores', { body: { reenviar: [p.email] } })
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    const r = data?.resultados?.[0] as { estado: string; detalle?: string } | undefined
    if (r?.estado === 'invitación reenviada') setAviso(`Le reenviamos la invitación a ${p.email}.`)
    else setError(`${p.email}: ${r?.estado ?? 'no se pudo reenviar'}${r?.detalle ? ` · ${r.detalle}` : ''}`)
  }

  // descarga exactamente lo que se ve en pantalla (con los filtros aplicados)
  const exportar = () => descargarCsv('participantes', lista.map((p) => ({
    nombre: p.nombre, empresa: p.empresa, cargo: p.cargo, ciudad: p.ciudad, correo: p.email, celular: p.telefono,
    estado: ESTADOS[estadoPersona(p)].texto, participacion: etiquetaParticipacion(p), tier: p.tier, categoria: p.categoria ? nombreCategoria(p.categoria) : '',
    busca: p.busca, ofrece: p.ofrece, franjas: p.franjas, matches: p.matches, reuniones: p.reuniones,
    registro: p.created_at.slice(0, 16).replace('T', ' '),
  })))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar personas">
        {FILTROS.map((f) => (
          <button key={f.id} onClick={() => { setFiltro(f.id); setBusqueda('') }} aria-pressed={filtro === f.id && !q}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${filtro === f.id && !q ? 'border-tinta bg-tinta text-white' : 'border-linea bg-white text-tinta'}`}>
            {f.texto} ({cuenta(f.id)})
          </button>
        ))}
      </div>
      <p className="text-sm text-tinta-suave">{q ? `Buscando "${busqueda.trim()}" entre todas las personas.` : FILTROS.find((f) => f.id === filtro)!.ayuda}</p>
      <input className="campo mt-0" placeholder="Buscar por nombre, empresa, correo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar persona" id="buscar-persona" />
      <fieldset className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-2">
        <legend className="sr-only">Filtrar por tipo, categoría e intereses</legend>
        <label className="block text-sm font-semibold" htmlFor="f-tipo">Tipo de participante
          <select id="f-tipo" className="campo" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.texto} ({base.filter((p) => tipoDe(p).includes(t.id)).length})</option>)}
          </select></label>
        <label className="block text-sm font-semibold" htmlFor="f-categoria">Categoría
          <select id="f-categoria" className="campo" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas las categorías</option>
            {opciones(nCat, categoria).map((c) => <option key={c} value={c}>{nombreCategoria(c)} ({nCat.get(c) ?? 0})</option>)}
          </select></label>
        <label className="block text-sm font-semibold" htmlFor="f-busca">Qué busca
          <select id="f-busca" className="campo" value={busca} onChange={(e) => setBusca(e.target.value)}>
            <option value="">Cualquier cosa</option>
            {opciones(nBusca, busca).map((t) => <option key={t} value={t}>{t} ({nBusca.get(t) ?? 0})</option>)}
          </select></label>
        <label className="block text-sm font-semibold" htmlFor="f-ofrece">Qué ofrece
          <select id="f-ofrece" className="campo" value={ofrece} onChange={(e) => setOfrece(e.target.value)}>
            <option value="">Cualquier cosa</option>
            {opciones(nOfrece, ofrece).map((t) => <option key={t} value={t}>{t} ({nOfrece.get(t) ?? 0})</option>)}
          </select></label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold" role="status">{lista.length === 1 ? 'Se muestra 1 persona' : `Se muestran ${lista.length} personas`}{hayFiltros ? ' con estos filtros' : ''}.</p>
        {hayFiltros && <button className="min-h-11 text-sm font-semibold text-azul" onClick={quitarFiltros}>Quitar filtros</button>}
        <button className="btn-secundario ml-auto text-sm" onClick={exportar} disabled={lista.length === 0}>Descargar en Excel ({lista.length})</button>
      </div>
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {lista.length === 0 && <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-tinta-suave">{q ? 'No encontramos a nadie con ese dato.' : hayFiltros ? 'Nadie cumple estos filtros. Prueba quitando alguno.' : 'No hay nadie en este grupo.'}</p>}
      <ul className="space-y-2">
        {lista.map((p) => {
          const estado = estadoPersona(p)
          return (
            <li key={p.id} className={`tarjeta p-4 ${estado === 'fuera' ? 'opacity-70' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold"><button type="button" className="text-left font-bold hover:text-azul hover:underline" onClick={() => alternarFicha(p.id)} aria-expanded={abiertos.has(p.id)}>{p.nombre === 'Nuevo participante' ? (p.empresa ?? 'Sin nombre todavía') : p.nombre}</button> <span className="text-sm font-normal text-tinta-suave">{p.nombre === 'Nuevo participante' ? '' : [p.cargo, p.empresa].filter(Boolean).join(' · ')}</span></p>
                  <p className="break-words text-sm text-tinta-suave">{p.email}{p.telefono ? ` · ${p.telefono}` : ''}{p.ciudad ? ` · ${p.ciudad}` : ''}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                    <span className={`rounded-full px-2.5 py-1 ${ESTADOS[estado].clase}`}>{ESTADOS[estado].texto}</span>
                    <span className="text-azul">{etiquetaParticipacion(p)}</span>
                    {p.solicitud && p.empresa_tipo !== 'expositor' && <span className="rounded-full bg-rosa/15 px-2.5 py-1 text-[#B0103F]">Pidió ser expositor · está en "Por aprobar"</span>}
                    {p.es_admin && <span className="text-tinta-suave">Organización</span>}
                  </p>
                  <p className="mt-1 text-xs text-tinta-suave">
                    {estado === 'completo' ? `${p.matches} matches · ${p.reuniones} reuniones · ` : ''}{p.invitado ? 'Invitado' : estado === 'sin_terminar' ? 'Empezó' : 'Se registró'} el {fecha(p.created_at)}
                    {estado === 'sin_terminar' && (p.recordatorio_at ? ` · Recordatorio enviado el ${fecha(p.recordatorio_at)}` : ' · Aún sin recordatorio')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-primario min-h-11 px-4 text-sm" onClick={() => alternarFicha(p.id)} aria-expanded={abiertos.has(p.id)}>{abiertos.has(p.id) ? 'Ocultar perfil' : 'Ver perfil'}</button>
                  {estado === 'completo' && p.tipo !== 'expositor' && (
                    <label className="text-xs font-semibold text-tinta-suave">Prioridad{' '}
                      <select className="campo mt-0 inline-block min-h-11 w-auto py-1 text-sm" value={p.tier} onChange={(e) => cambiarPrioridad(p, e.target.value)} aria-label={`Prioridad de ${p.nombre}`}>
                        {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                  )}
                  {estado === 'invitado' && <button className="btn-secundario min-h-11 px-4 text-sm" disabled={ocupado === p.id} onClick={() => reenviar(p)}>{ocupado === p.id ? 'Enviando…' : 'Reenviar invitación'}</button>}
                  {estado === 'sin_terminar' && <button className="btn-secundario min-h-11 px-4 text-sm" disabled={ocupado === p.id} onClick={() => recordar(p)}>{ocupado === p.id ? 'Enviando…' : p.recordatorio_at ? 'Enviar otro recordatorio' : 'Enviar recordatorio'}</button>}
                  {estado === 'fuera'
                    ? <button className="btn-secundario min-h-11 px-4 text-sm" disabled={ocupado === p.id} onClick={() => admitir(p)}>Volver a admitir</button>
                    : !p.es_admin && <button className="btn-secundario min-h-11 px-4 text-sm text-[#B0103F]" disabled={ocupado === p.id} onClick={() => sacar(p)}>Sacar de la app</button>}
                </div>
              </div>
              {abiertos.has(p.id) && <FichaPerfil p={p} categoria={p.categoria ? nombreCategoria(p.categoria) : ''} reuniones={reuniones} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
