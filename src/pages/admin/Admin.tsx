import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Aviso, Pantalla } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { mensajeError } from '../../lib/utilidades'
import type { Participante } from './tipos'
import Solicitudes from './Solicitudes'
import Participantes from './Participantes'
import Reuniones from './Reuniones'
import Ajustes from './Ajustes'
import Expositores from './Expositores'

const TABS = [
  { to: 'solicitudes', texto: 'Solicitudes' },
  { to: 'participantes', texto: 'Participantes' },
  { to: 'reuniones', texto: 'Reuniones' },
  { to: 'expositores', texto: 'Cargar expositores' },
  { to: 'ajustes', texto: 'Ajustes' },
]

// Panel de organización. Solo para admins (app_metadata.role = 'admin'); la base lo vuelve a comprobar en cada función.
export default function Admin() {
  const [participantes, setParticipantes] = useState<Participante[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_participantes')
    if (error) setError(mensajeError(error)); else { setParticipantes(data); setError(null) }
  }, [])
  useEffect(() => { recargar() }, [recargar])

  const pendientes = participantes?.filter((p) => p.solicitud && p.empresa_tipo !== 'expositor').length ?? 0

  return (
    <Pantalla nav ancho="max-w-3xl">
      <h1 className="text-2xl font-extrabold">Panel de organización</h1>
      <nav aria-label="Secciones del panel" className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${isActive ? 'border-azul bg-azul text-white' : 'border-linea bg-white text-tinta'}`}>
            {t.texto}{t.to === 'solicitudes' && pendientes > 0 ? ` (${pendientes})` : ''}
          </NavLink>
        ))}
      </nav>
      {error && <div className="mt-4"><Aviso>{error}</Aviso></div>}
      <div className="mt-6">
        <Routes>
          <Route index element={<Navigate to="solicitudes" replace />} />
          <Route path="solicitudes" element={<Solicitudes participantes={participantes} recargar={recargar} />} />
          <Route path="participantes" element={<Participantes participantes={participantes} recargar={recargar} />} />
          <Route path="reuniones" element={<Reuniones />} />
          <Route path="expositores" element={<Expositores participantes={participantes} recargar={recargar} />} />
          <Route path="ajustes" element={<Ajustes />} />
        </Routes>
      </div>
    </Pantalla>
  )
}
