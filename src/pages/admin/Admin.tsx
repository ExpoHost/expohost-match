import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Aviso, Pantalla } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { mensajeError } from '../../lib/utilidades'
import { esEmpresaExpositora, estadoPersona, type Participante } from './tipos'
import Solicitudes from './Solicitudes'
import Participantes from './Participantes'
import Reuniones from './Reuniones'
import Ajustes from './Ajustes'
import Expositores from './Expositores'
import Stands from './Stands'

const TABS = [
  { to: 'solicitudes', texto: 'Por aprobar' },
  { to: 'participantes', texto: 'Personas' },
  { to: 'expositores', texto: 'Invitar' },
  { to: 'reuniones', texto: 'Reuniones' },
  { to: 'stands', texto: 'Lista de stands' },
  { to: 'ajustes', texto: 'Ajustes' },
]

// Una frase por pestaña: qué se hace ahí
const AYUDA: Record<string, string> = {
  solicitudes: 'Aquí apruebas a las empresas que dicen ser expositoras y que la app no pudo comprobar sola con la lista de stands.',
  participantes: 'Todas las personas: quién ya tiene perfil, quién fue invitado y no ha entrado, y a quién sacaste de la app.',
  expositores: 'Mira qué expositores invitados ya crearon su perfil, reenvía la invitación a los que faltan e invita a más personas.',
  reuniones: 'Las reuniones de cada día por hora y lugar. En la feria: marca quién asistió y reasigna si hace falta.',
  stands: 'La lista oficial de stands. Sirve para aprobar expositores automáticamente al registrarse.',
  ajustes: 'Mesas de la Zona Match, bloques bloqueados, encuesta y etiquetas.',
}

// Lo primero que ve la organización: qué hay por hacer y cómo va el registro
function Resumen({ participantes, pendientes }: { participantes: Participante[]; pendientes: number }) {
  const [reuniones, setReuniones] = useState<{ total: number; d6: number; d7: number } | null>(null)
  useEffect(() => {
    supabase.rpc('admin_reuniones').then(({ data }) => {
      const act = (data ?? []).filter((r: { estado: string }) => r.estado === 'confirmada')
      setReuniones({ total: act.length, d6: act.filter((r: { dia: string }) => r.dia === '2026-10-06').length, d7: act.filter((r: { dia: string }) => r.dia === '2026-10-07').length })
    })
  }, [participantes])
  const dentro = participantes.filter((p) => estadoPersona(p) !== 'fuera')
  const completos = dentro.filter((p) => estadoPersona(p) === 'completo')
  const deEmpresa = dentro.filter(esEmpresaExpositora)
  const deEmpresaListos = deEmpresa.filter((p) => estadoPersona(p) === 'completo')
  const faltan = deEmpresa.length - deEmpresaListos.length
  const asistentes = completos.filter((p) => !esEmpresaExpositora(p)).length
  const pct = deEmpresa.length ? Math.round((deEmpresaListos.length / deEmpresa.length) * 100) : 0
  const matches = Math.round(participantes.reduce((s, p) => s + p.matches, 0) / 2)

  return (
    <section aria-label="Resumen" className="mt-4 space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className={`rounded-2xl p-4 ${pendientes > 0 ? 'bg-rosa/10' : 'bg-white'}`}>
          <p className="text-xs font-bold uppercase tracking-wider text-tinta-suave">Por aprobar</p>
          <p className="text-3xl font-extrabold">{pendientes}</p>
          <p className="text-sm text-tinta-suave">{pendientes > 0 ? 'empresas esperan que las apruebes como expositoras.' : 'Nadie espera aprobación. No tienes que hacer nada.'}</p>
          {pendientes > 0 && <Link to="/admin/solicitudes" className="btn-primario mt-3 min-h-11 w-full text-sm">Revisar y aprobar</Link>}
        </div>
        <div className="rounded-2xl bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-tinta-suave">Expositores invitados</p>
          <p className="text-3xl font-extrabold">{deEmpresaListos.length} <span className="text-base font-bold text-tinta-suave">de {deEmpresa.length}</span></p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-linea" role="img" aria-label={`${pct}% ya creó su perfil`}><div className="h-full rounded-full bg-turquesa" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-sm text-tinta-suave">ya crearon su perfil. {faltan > 0 ? `Faltan ${faltan}.` : 'No falta nadie.'}</p>
          <Link to="/admin/expositores" className="btn-secundario mt-3 min-h-11 w-full text-sm">Ver quién falta</Link>
        </div>
        <div className="rounded-2xl bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-tinta-suave">Personas con perfil</p>
          <p className="text-3xl font-extrabold">{completos.length}</p>
          <p className="text-sm text-tinta-suave">{deEmpresaListos.length} de empresas expositoras y {asistentes} asistentes.</p>
          <Link to="/admin/participantes" className="btn-secundario mt-3 min-h-11 w-full text-sm">Ver personas</Link>
        </div>
      </div>
      <p className="rounded-2xl bg-white px-4 py-2 text-sm text-tinta-suave">
        <strong className="text-tinta">{matches}</strong> matches · <strong className="text-tinta">{reuniones ? reuniones.total : '…'}</strong> reuniones agendadas{reuniones ? ` (martes ${reuniones.d6} · miércoles ${reuniones.d7})` : ''}
      </p>
    </section>
  )
}

// Panel de organización. Solo para admins (app_metadata.role = 'admin'); la base lo vuelve a comprobar en cada función.
export default function Admin() {
  const loc = useLocation()
  const [participantes, setParticipantes] = useState<Participante[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_participantes')
    if (error) setError(mensajeError(error)); else { setParticipantes(data); setError(null) }
  }, [])
  useEffect(() => { recargar() }, [recargar])

  // empresas (no personas) con solicitud pendiente
  const pendientes = new Set(participantes?.filter((p) => p.solicitud && p.empresa_tipo !== 'expositor' && p.company_id).map((p) => p.company_id)).size

  return (
    <Pantalla nav ancho="max-w-3xl" volver="/perfil">
      <h1 className="text-2xl font-extrabold">Panel de organización</h1>
      <p className="mt-1 text-sm text-tinta-suave">Solo lo ve la organización. Para volver a la app, usa la barra de abajo o "Volver".</p>
      {error && <div className="mt-4"><Aviso>{error}</Aviso></div>}
      {participantes && <Resumen participantes={participantes} pendientes={pendientes} />}
      <nav aria-label="Secciones del panel" className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <NavLink key={t.to} to={`/admin/${t.to}`} className={({ isActive }) => `min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${isActive ? 'border-azul bg-azul text-white' : 'border-linea bg-white text-tinta'}`}>
            {t.texto}{t.to === 'solicitudes' ? ` (${pendientes})` : ''}
          </NavLink>
        ))}
      </nav>
      <p className="mt-3 text-sm text-tinta-suave">{AYUDA[loc.pathname.split('/')[2] ?? 'solicitudes'] ?? ''}</p>
      <div className="mt-4">
        <Routes>
          <Route index element={<Navigate to="solicitudes" replace />} />
          <Route path="solicitudes" element={<Solicitudes participantes={participantes} recargar={recargar} />} />
          <Route path="participantes" element={<Participantes participantes={participantes} recargar={recargar} />} />
          <Route path="reuniones" element={<Reuniones />} />
          <Route path="expositores" element={<Expositores participantes={participantes} recargar={recargar} />} />
          <Route path="stands" element={<Stands />} />
          <Route path="ajustes" element={<Ajustes />} />
        </Routes>
      </div>
    </Pantalla>
  )
}
