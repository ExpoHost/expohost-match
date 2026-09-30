import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { Aviso, Avatar, Chip, Pantalla } from '../components/ui'
import { Codigo } from '../components/Codigo'
import { supabase, urlRegreso } from '../lib/supabase'
import { COMERCIAL_TEXTO, CONSENT_TEXTO, FRANJAS, PAISES, PARTICIPACION, POLITICA_URL, separarTelefono } from '../lib/catalogos'
import { esBorrador, guardarBorrador, guardarPerfil, leerBorrador, useSesion, type Borrador, type Perfil } from '../lib/sesion'
import { mensajeError, redimensionarFoto, useCatalogos } from '../lib/utilidades'

// 'nuevo': sin sesión (pide correo al final) · 'completar': con sesión y perfil incompleto · 'editar': perfil existente
type Modo = 'nuevo' | 'completar' | 'editar'

const sinHtml = (campo: string) => z.string().trim().refine((v) => !/[<>]/.test(v), `${campo}: no uses los signos < o >`)

const esquemaDatos = z.object({
  nombre: sinHtml('Nombre').pipe(z.string().min(2, 'Escribe tu nombre completo').max(80)),
  empresa: sinHtml('Empresa').pipe(z.string().min(2, 'Escribe el nombre de tu empresa').max(80)),
  cargo: sinHtml('Cargo').pipe(z.string().min(2, 'Escribe tu cargo').max(80)),
  ciudad: sinHtml('Ciudad').pipe(z.string().min(2, 'Escribe tu ciudad').max(60)),
  telefono: z.string().trim().refine((v) => /^\+\d{1,3} \d{6,15}$/.test(v), 'Escribe tu número de celular (solo dígitos)'),
  categoria: z.string().min(1, 'Elige la categoría que mejor te describe'),
  solicitud: z.enum(['', 'expositor_stand', 'expositor_sin_stand']),
  stand: sinHtml('Stand').pipe(z.string().max(20)),
  bio: sinHtml('Presentación').pipe(z.string().min(10, 'Preséntate en una frase (mínimo 10 caracteres)').max(280, 'Máximo 280 caracteres')),
}).refine((d) => d.solicitud !== 'expositor_stand' || d.stand.length > 0, { path: ['stand'], message: 'Escribe tu número de stand' })

const esquemaCorreo = z.string().trim().toLowerCase().email('Escribe un correo válido')

function desdePerfil(p: Perfil): Borrador {
  return {
    nombre: p.nombre === 'Nuevo participante' ? '' : p.nombre, empresa: p.empresa?.nombre ?? '', cargo: p.cargo ?? '', ciudad: p.ciudad ?? '',
    telefono: p.telefono ?? '', categoria: p.categoria ?? '', solicitud: p.empresa?.solicitud ?? '', stand: p.empresa?.stand ?? p.empresa?.stand_declarado ?? '',
    bio: p.bio ?? '', foto: null, busca: p.busca, ofrece: p.ofrece, franjas: p.franjas, comercial: false, email: p.email,
  }
}

const vacio: Borrador = { nombre: '', empresa: '', cargo: '', ciudad: '', telefono: '', categoria: '', solicitud: '', stand: '', bio: '', foto: null, busca: [], ofrece: [], franjas: [], comercial: false, email: '' }

export default function Registro({ modo }: { modo: Modo }) {
  const { perfil, recargar } = useSesion()
  const navigate = useNavigate()
  const { tags, categorias } = useCatalogos()
  const [prellenado] = useState<Borrador | null>(() => {
    if (modo !== 'completar') return null
    try { const x = JSON.parse(sessionStorage.getItem('expohost-prellenado') ?? 'null'); return esBorrador(x) ? x : null } catch { return null }
  })
  const [b, setB] = useState<Borrador>(() => (prellenado ? { ...prellenado, email: perfil?.email ?? prellenado.email } : perfil ? desdePerfil(perfil) : modo === 'nuevo' ? leerBorrador() ?? vacio : vacio))
  const [params, setParams] = useSearchParams()
  const paso = Math.min(3, Math.max(1, Number(params.get('paso')) || 1))
  const [acepta, setAcepta] = useState(modo === 'editar')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [codigoEnviado, setCodigoEnviado] = useState(false)

  const expositorAprobado = perfil?.empresa?.tipo === 'expositor'
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((x) => ({ ...x, [k]: v }))
  const alternar = (k: 'busca' | 'ofrece' | 'franjas', v: string) =>
    setB((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }))
  // Cambiar de paso guarda el borrador (por si se recarga o el navegador descarta la página) y deja
  // una entrada en el historial, para que "atrás" del celular vuelva al paso anterior y no a la landing.
  const irA = (n: number, datos: Borrador = b) => {
    if (modo === 'nuevo') guardarBorrador(datos)
    setError(null)
    setParams({ paso: String(n) })
    window.scrollTo(0, 0)
  }

  // Lee los valores directamente del formulario: el autocompletado del navegador o de un
  // gestor de contraseñas puede llenar campos sin avisarle a React.
  function validarPaso1(form: HTMLFormElement) {
    const fd = new FormData(form)
    const leer = (k: keyof Borrador, actual: string) => { const v = fd.get(k); return typeof v === 'string' ? v : actual }
    const datos: Borrador = { ...b, nombre: leer('nombre', b.nombre), empresa: leer('empresa', b.empresa), cargo: leer('cargo', b.cargo),
      ciudad: leer('ciudad', b.ciudad), email: leer('email', b.email), stand: leer('stand', b.stand), bio: leer('bio', b.bio),
      // país elegido en la lista + número: se guarda como "+57 3001234567"
      telefono: (() => { const c = PAISES.find(([n]) => n === fd.get('pais'))?.[1] ?? '57'; const n = String(fd.get('numero') ?? '').replace(/\D/g, ''); return n ? `+${c} ${n}` : '' })() }
    setB(datos)
    const r = esquemaDatos.safeParse(datos)
    const errs: Record<string, string> = {}
    if (!r.success) for (const i of r.error.issues) errs[String(i.path[0])] ??= i.message
    if (modo === 'nuevo') {
      const c = esquemaCorreo.safeParse(datos.email)
      if (!c.success) errs.email = c.error.issues[0]!.message
    }
    if (!acepta) errs.acepta = 'Para continuar debes autorizar el tratamiento de tus datos'
    setErrores(errs)
    if (Object.keys(errs).length) { setError('Revisa los campos marcados.'); return }
    if (!r.success) return
    const limpio: Borrador = { ...datos, ...r.data, email: datos.email.trim().toLowerCase() }
    setB(limpio)
    irA(2, limpio)
  }

  async function enviarCodigo(email = b.email) {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, data: { nombre: b.nombre }, emailRedirectTo: urlRegreso() } })
    if (error) throw error
  }

  async function terminar(e: FormEvent) {
    e.preventDefault()
    if (b.franjas.length === 0) { setError('Elige al menos una franja en la que puedas reunirte.'); return }
    setEnviando(true); setError(null)
    try {
      if (modo === 'nuevo') {
        // Los datos se completan al confirmar el correo (ver SesionProvider). Se guardan en el
        // servidor (por si el enlace se abre en otro navegador) y en este navegador (con la foto).
        const { error } = await supabase.rpc('guardar_registro_pendiente', { p_email: b.email, p_datos: b })
        if (error) throw error
        guardarBorrador(b)
        try { localStorage.setItem('expohost-ultimo-correo', b.email) } catch { /* sin almacenamiento */ }
        await enviarCodigo()
        setCodigoEnviado(true)
      } else {
        await guardarPerfil(b, modo === 'completar')
        await recargar()
        try { sessionStorage.removeItem('expohost-prellenado') } catch { /* sin almacenamiento */ }
        navigate(modo === 'editar' ? '/perfil' : '/descubrir', { replace: true })
      }
    } catch (err) { setError(mensajeError(err)) }
    setEnviando(false)
  }

  // Lista oficial de stands: si el stand existe, rellena empresa y categoría (solo si están vacíos)
  async function rellenarPorStand(stand: string, form: HTMLFormElement | null) {
    if (!stand.trim() || !form) return
    const { data } = await supabase.rpc('empresa_por_stand', { p_stand: stand })
    const fila = data?.[0]
    if (!fila) return
    const empresa = form.elements.namedItem('empresa') as HTMLInputElement | null
    if (empresa && !empresa.value.trim()) empresa.value = fila.empresa
    if (fila.categoria && !b.categoria) set('categoria', fila.categoria)
  }

  async function elegirFoto(file: File | undefined) {
    if (!file) return
    try { set('foto', await redimensionarFoto(file)) } catch (err) { setError(mensajeError(err)) }
  }

  if (codigoEnviado) {
    return (
      <Pantalla>
        <Codigo email={b.email} onReenviar={() => enviarCodigo()} onCambiarCorreo={() => { setCodigoEnviado(false); irA(1) }} />
      </Pantalla>
    )
  }

  const titulo = modo === 'editar' ? 'Editar mi perfil' : 'Crea tu perfil'
  const err = (k: string) => errores[k] && <span className="mt-1 block text-sm text-[#B0103F]">{errores[k]}</span>

  return (
    <Pantalla volver={modo === 'editar' ? '/perfil' : paso === 1 ? '/' : undefined}>
      <p className="text-sm font-semibold text-azul">Paso {paso} de 3</p>
      <div className="mt-2 mb-6 flex gap-1.5" aria-hidden="true">
        {[1, 2, 3].map((n) => <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= paso ? 'bg-azul' : 'bg-linea'}`} />)}
      </div>

      {paso === 1 && (
        <form onSubmit={(e) => { e.preventDefault(); validarPaso1(e.currentTarget) }} className="space-y-5" noValidate>
          <h1 className="text-2xl font-extrabold">{titulo}</h1>

          <p className="text-sm text-tinta-suave">{modo === 'editar' ? 'Cambia lo que necesites y toca Guardar al final.' : modo === 'completar' ? (prellenado ? 'Tu correo quedó confirmado. Revisa tus datos, acepta la autorización y toca Continuar: son 3 pasos cortos.' : 'Tu correo quedó confirmado. Para terminar, completa estos datos: son 3 pasos cortos.') : 'Son 3 pasos cortos: tus datos, qué buscas y qué ofreces, y cuándo puedes reunirte. Todo es obligatorio, excepto la foto.'}</p>
          <div>
            <div className="flex items-center gap-4">
              <Avatar src={b.foto} path={b.foto ? null : perfil?.foto_path} nombre={b.nombre || '?'} tam="h-20 w-20 text-2xl" />
              <label className="btn-secundario cursor-pointer text-sm">
                {b.foto || perfil?.foto_path ? 'Cambiar foto' : 'Agregar foto (opcional)'}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => elegirFoto(e.target.files?.[0])} />
              </label>
            </div>
            {err('foto')}
          </div>

          <label className="block"><span className="etiqueta">Nombre y apellido</span>
            <input className="campo" name="nombre" defaultValue={b.nombre} autoComplete="name" maxLength={80} />{err('nombre')}</label>
          <label className="block"><span className="etiqueta">Empresa</span>
            <input className="campo" name="empresa" defaultValue={b.empresa} autoComplete="organization" maxLength={80} disabled={expositorAprobado} />{err('empresa')}</label>
          <label className="block"><span className="etiqueta">Cargo</span>
            <input className="campo" name="cargo" defaultValue={b.cargo} autoComplete="organization-title" maxLength={80} />{err('cargo')}</label>
          <label className="block"><span className="etiqueta">Ciudad</span>
            <input className="campo" name="ciudad" defaultValue={b.ciudad} autoComplete="address-level2" maxLength={60} />{err('ciudad')}</label>
          {modo === 'nuevo' && (
            <label className="block"><span className="etiqueta">Correo</span>
              <input className="campo" name="email" type="email" inputMode="email" defaultValue={b.email} autoComplete="email" />
              <span className="mt-1 block text-sm text-tinta-suave">Te enviaremos un código para entrar. Solo lo verán las personas con quienes acuerdes una reunión.</span>{err('email')}</label>
          )}
          <div>
            <span className="etiqueta" id="et-celular">Celular (WhatsApp)</span>
            <div className="flex gap-2">
              <select className="campo w-2/5 shrink-0 px-3" name="pais" defaultValue={separarTelefono(b.telefono).pais} aria-label="País del celular">
                {PAISES.map(([nombre, codigo]) => <option key={nombre} value={nombre}>{nombre} +{codigo}</option>)}
              </select>
              <input className="campo" name="numero" type="tel" inputMode="numeric" defaultValue={separarTelefono(b.telefono).numero} autoComplete="tel-national" placeholder="300 123 4567" aria-labelledby="et-celular" />
            </div>
            <span className="mt-1 block text-sm text-tinta-suave">Solo lo verán las personas con quienes hagas match.</span>{err('telefono')}
          </div>
          <label className="block"><span className="etiqueta">¿Qué te describe mejor?</span>
            <select className="campo" value={b.categoria} onChange={(e) => set('categoria', e.target.value)}>
              <option value="">Elige una categoría</option>
              {categorias.map((c) => <option key={c.slug} value={c.slug}>{c.nombre}</option>)}
            </select>{err('categoria')}</label>

          <fieldset>
            <legend className="etiqueta">¿Cómo participas en la feria?</legend>
            {expositorAprobado ? (
              <p className="mt-2 text-sm text-tinta-suave">Expositor{perfil?.empresa?.stand ? ` · Stand ${perfil.empresa.stand}` : ''}. Para cambiarlo escribe a la organización.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {PARTICIPACION.map((o) => (
                  <label key={o.id} className={`flex min-h-12 cursor-pointer gap-3 rounded-2xl border bg-white p-3 ${b.solicitud === o.id ? 'border-azul ring-2 ring-azul/20' : 'border-linea'}`}>
                    <input type="radio" name="solicitud" className="mt-1 h-5 w-5 accent-azul" checked={b.solicitud === o.id} onChange={() => set('solicitud', o.id)} />
                    <span><span className="block font-semibold">{o.nombre}</span><span className="text-sm text-tinta-suave">{o.detalle}</span></span>
                  </label>
                ))}
                {b.solicitud === 'expositor_stand' && (
                  <label className="block"><span className="etiqueta">Número de stand <span className="text-[#B0103F]">(obligatorio)</span></span>
                    <input className="campo" name="stand" defaultValue={b.stand} maxLength={20} placeholder="Por ejemplo D04" onBlur={(ev) => rellenarPorStand(ev.target.value, ev.target.form)} />
                    <span className="mt-1 block text-sm text-tinta-suave">Escribe el número tal como aparece en tu contrato de expositor. La organización lo usará para verificar tu participación.</span>{err('stand')}</label>
                )}
              </div>
            )}
          </fieldset>

          <label className="block"><span className="etiqueta">Preséntate en una frase</span>
            <textarea className="campo min-h-24 py-3" name="bio" defaultValue={b.bio} onChange={(e) => set('bio', e.target.value)} maxLength={280} placeholder="Qué haces y qué te gustaría lograr en la feria" />
            <span className="mt-1 block text-right text-sm text-tinta-suave">{b.bio.length}/280</span>{err('bio')}</label>

          {modo !== 'editar' && (
            <div className="space-y-3 rounded-[22px] bg-white p-4">
              <p className="text-sm font-semibold">Aviso de privacidad</p>
              <p className="text-sm leading-relaxed text-tinta-suave">
                Expohost SAS (NIT 901702368-6) es responsable del tratamiento de tus datos. Consulta la{' '}
                <a href={POLITICA_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-azul underline">Política de Tratamiento de Datos</a>.
              </p>
              <label className="flex gap-3">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-azul" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
                <span className="text-sm leading-relaxed">{CONSENT_TEXTO}</span>
              </label>
              {err('acepta')}
              <label className="flex gap-3">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-azul" checked={b.comercial} onChange={(e) => set('comercial', e.target.checked)} />
                <span className="text-sm leading-relaxed">{COMERCIAL_TEXTO}</span>
              </label>
            </div>
          )}

          {error && <Aviso>{error}</Aviso>}
          <button className="btn-primario w-full">Continuar</button>
          {modo === 'nuevo' && <p className="text-center text-sm text-tinta-suave">¿Ya tienes perfil? <Link to="/entrar" className="inline-flex min-h-11 items-center px-2 font-semibold text-azul">Entrar</Link></p>}
        </form>
      )}

      {paso === 2 && (
        <form onSubmit={(e) => { e.preventDefault(); if (b.busca.length + b.ofrece.length === 0) { setError('Elige al menos una opción en Busco u Ofrezco.'); return } irA(3) }} className="space-y-6">
          <div>
            <h1 className="text-2xl font-extrabold">¿Qué buscas y qué ofreces?</h1>
            <p className="mt-2 text-tinta-suave">Toca las opciones que te describan; puedes marcar varias. Con esto te mostramos primero a las personas que más te convienen.</p>
          </div>
          <section>
            <h2 className="mb-3 text-lg font-bold text-[#D81B55]">Busco</h2>
            <div className="flex flex-wrap gap-2">{tags.map((t) => <Chip key={t} color="rosa" activo={b.busca.includes(t)} onClick={() => alternar('busca', t)}>{t}</Chip>)}</div>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-bold text-azul">Ofrezco</h2>
            <div className="flex flex-wrap gap-2">{tags.map((t) => <Chip key={t} activo={b.ofrece.includes(t)} onClick={() => alternar('ofrece', t)}>{t}</Chip>)}</div>
          </section>
          {error && <Aviso>{error}</Aviso>}
          <div className="flex gap-3">
            <button type="button" className="btn-secundario" onClick={() => irA(1)}>Atrás</button>
            <button className="btn-primario flex-1">Continuar</button>
          </div>
        </form>
      )}

      {paso === 3 && (
        <form onSubmit={terminar} className="space-y-6">
          <div>
            <h1 className="text-2xl font-extrabold">¿Cuándo puedes reunirte?</h1>
            <p className="mt-2 text-tinta-suave">Toca los momentos en que estarás en la feria (puedes marcar todos). Las reuniones duran 25 minutos y se agendan dentro de esos horarios.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {FRANJAS.map((f) => (
              <button type="button" key={f.id} aria-pressed={b.franjas.includes(f.id)} onClick={() => alternar('franjas', f.id)}
                className={`min-h-20 rounded-[22px] border p-4 text-left transition ${b.franjas.includes(f.id) ? 'border-azul bg-azul text-white' : 'border-linea bg-white'}`}>
                <span className="block font-bold">{f.dia}</span>
                <span className="text-sm">{f.hora}</span>
              </button>
            ))}
          </div>
          {error && <Aviso>{error}</Aviso>}
          <div className="flex gap-3">
            <button type="button" className="btn-secundario" onClick={() => irA(2)}>Atrás</button>
            <button className="btn-primario flex-1" disabled={enviando}>
              {enviando ? 'Guardando…' : modo === 'nuevo' ? 'Recibir mi código' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </Pantalla>
  )
}
