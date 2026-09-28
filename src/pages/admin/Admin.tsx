import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Aviso, Pantalla } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { mensajeError } from '../../lib/utilidades'
import type { Participante } from './tipos'
import Solicitudes from './Solicitudes'
import Participantes from './Participantes'
import Reuniones from './Reuniones'
import Ajustes from './Ajustes'
import Expositores from './Expositores'
import Stands from './Stands'

const TABS = [
  { to: 'solicitudes', texto: 'Aprobar expositores' },
  { to: 'participantes', texto: 'Personas' },
  { to: 'reuniones', texto: 'Reuniones' },
  { to: 'expositores', texto: 'Invitar expositores' },
  { to: 'stands', texto: 'Lista de stands' },
  { to: 'ajustes', texto: 'Ajustes' },
]

// Una frase por pestaña: qué se hace ahí
const AYUDA: Record<string, string> = {
  solicitudes: 'Empresas que dicen ser expositoras y esperan tu aprobación. Con stand = Expositor; sin stand = Proveedor / servicio.',
  participantes: 'Todas las personas registradas. Busca por nombre o empresa, cambia su prioridad o escóndelas de la app.',
  reuniones: 'Las reuniones de cada día por hora y lugar. En la feria: marca quién asistió y reasigna si hace falta.',
  expositores: 'Crea e invita expositores por correo desde una lista. Úsalo el 1 y 2 de octubre.',
  stands: 'La lista oficial de stands. Sirve para aprobar expositores automáticamente al registrarse.',
  ajustes: 'Mesas de la Zona Match, bloques bloqueados, encuesta y etiquetas.',
}

// Cifras rápidas para reportar: registrados, expositores, proveedores, matches y reuniones
function Resumen({ participantes }: { participantes: Participante[] }) {
  const [reuniones, setReuniones] = useState<{ total: number; d6: number; d7: number } | null>(null)
  useEffect(() => {
    supabase.rpc('admin_reuniones').then(({ data }) => {
      const act = (data ?? []).filter((r: { estado: string }) => r.estado === 'confirmada')
      setReuniones({ total: act.length, d6: act.filter((r: { dia: string }) => r.dia === '2026-10-06').length, d7: act.filter((r: { dia: string }) => r.dia === '2026-10-07').length })
    })
  }, [participantes])
  const reales = participantes.filter((p) => !p.nombre.startsWith('Demo ·'))
  const completos = reales.filter((p) => p.busca.length + p.ofrece.length > 0)
  const cifras = [
    ['Registrados', reales.length], ['Con perfil completo', completos.length],
    ['Expositores', reales.filter((p) => p.tipo === 'expositor').length], ['Proveedores', reales.filter((p) => p.tipo !== 'expositor' && p.empresa_tipo === 'expositor').length],
    ['Matches', Math.round(reales.reduce((s, p) => s + p.matches, 0) / 2)], ['Reuniones', reuniones ? `${reuniones.total} (mar ${reuniones.d6} · mié ${reuniones.d7})` : '…'],
  ]
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cifras.map(([k, v]) => <div key={String(k)} className="rounded-2xl bg-white px-3 py-2"><dt className="text-xs text-tinta-suave">{k}</dt><dd className="text-lg font-extrabold">{v}</dd></div>)}
    </dl>
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

  const pendientes = participantes?.filter((p) => p.solicitud && p.empresa_tipo !== 'expositor').length ?? 0

  return (
    <Pantalla nav ancho="max-w-3xl" volver="/perfil">
      <h1 className="text-2xl font-extrabold">Panel de organización</h1>
      <p className="mt-1 text-sm text-tinta-suave">Solo lo ve la organización. Para volver a la app, usa la barra de abajo o "Volver".</p>
      <nav aria-label="Secciones del panel" className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <NavLink key={t.to} to={`/admin/${t.to}`} className={({ isActive }) => `min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${isActive ? 'border-azul bg-azul text-white' : 'border-linea bg-white text-tinta'}`}>
            {t.texto}{t.to === 'solicitudes' && pendientes > 0 ? ` (${pendientes})` : ''}
          </NavLink>
        ))}
      </nav>
      {error && <div className="mt-4"><Aviso>{error}</Aviso></div>}
      {participantes && <Resumen participantes={participantes} />}
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
