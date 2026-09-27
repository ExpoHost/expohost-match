import type { ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Aviso, Cargando, Pantalla } from './components/ui'
import { perfilCompleto, SesionProvider, useSesion } from './lib/sesion'
import Landing from './pages/Landing'
import Registro from './pages/Registro'
import Entrar from './pages/Entrar'
import Perfil from './pages/Perfil'
import Descubrir from './pages/Descubrir'
import Agenda from './pages/Agenda'
import Agendar from './pages/Agendar'

const INICIO = '/descubrir'

// Pantallas sin sesión: si ya hay sesión, ir al inicio
function SoloVisitante({ children }: { children: ReactNode }) {
  const { session, cargando } = useSesion()
  if (cargando) return <Cargando />
  return session ? <Navigate to={INICIO} replace /> : children
}

// Pantallas con sesión: exige sesión y perfil completo
function ConSesion({ children }: { children: ReactNode }) {
  const { session, perfil, cargando, error } = useSesion()
  const loc = useLocation()
  if (cargando) return <Cargando />
  if (!session) return <Navigate to="/entrar" replace />
  if (error) return <Pantalla><Aviso>{error}</Aviso></Pantalla>
  const completo = perfilCompleto(perfil)
  if (!completo && loc.pathname !== '/completar') return <Navigate to="/completar" replace />
  if (completo && loc.pathname === '/completar') return <Navigate to={INICIO} replace />
  return children
}

export default function App() {
  return (
    <SesionProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<SoloVisitante><Landing /></SoloVisitante>} />
          <Route path="/registro" element={<SoloVisitante><Registro modo="nuevo" /></SoloVisitante>} />
          <Route path="/entrar" element={<SoloVisitante><Entrar /></SoloVisitante>} />
          <Route path="/completar" element={<ConSesion><Registro modo="completar" /></ConSesion>} />
          <Route path="/descubrir" element={<ConSesion><Descubrir /></ConSesion>} />
          <Route path="/agenda" element={<ConSesion><Agenda /></ConSesion>} />
          <Route path="/match/:id" element={<ConSesion><Agendar /></ConSesion>} />
          <Route path="/perfil" element={<ConSesion><Perfil /></ConSesion>} />
          <Route path="/perfil/editar" element={<ConSesion><Registro modo="editar" /></ConSesion>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </SesionProvider>
  )
}
