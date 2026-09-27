import { useState } from 'react'
import { Aviso } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { descargarCsv } from '../../lib/csv'
import { mensajeError } from '../../lib/utilidades'
import { etiquetaParticipacion, TIERS, type Participante } from './tipos'

export default function Participantes({ participantes, recargar }: { participantes: Participante[] | null; recargar: () => Promise<void> }) {
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!participantes) return <p className="text-tinta-suave" role="status">Cargando…</p>

  const q = busqueda.trim().toLowerCase()
  const lista = participantes.filter((p) => !q || [p.nombre, p.empresa, p.email, p.cargo, p.ciudad].some((v) => v?.toLowerCase().includes(q)))
  const completos = participantes.filter((p) => p.busca.length + p.ofrece.length > 0)

  async function cambiar(p: Participante, cambios: { p_tier?: string; p_activo?: boolean }) {
    setError(null)
    const { error } = await supabase.rpc('admin_participante', { p_user: p.id, ...cambios })
    if (error) setError(mensajeError(error)); else await recargar()
  }

  const exportar = () => descargarCsv('participantes', participantes.map((p) => ({
    nombre: p.nombre, empresa: p.empresa, cargo: p.cargo, ciudad: p.ciudad, correo: p.email, celular: p.telefono,
    participacion: etiquetaParticipacion(p), tier: p.tier, categoria: p.categoria, activo: p.activo ? 'sí' : 'no',
    busca: p.busca, ofrece: p.ofrece, franjas: p.franjas, matches: p.matches, reuniones: p.reuniones,
    registro: p.created_at.slice(0, 16).replace('T', ' '),
  })))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-tinta-suave">{participantes.length} registrados · {completos.length} con perfil completo · {participantes.filter((p) => p.tipo === 'expositor').length} expositores</p>
        <button className="btn-secundario ml-auto text-sm" onClick={exportar}>Exportar CSV</button>
      </div>
      <input className="campo" placeholder="Buscar por nombre, empresa, correo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar participante" />
      {error && <Aviso>{error}</Aviso>}
      <ul className="space-y-2">
        {lista.map((p) => (
          <li key={p.id} className={`tarjeta p-4 ${p.activo ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold">{p.nombre} <span className="text-sm font-normal text-tinta-suave">{[p.cargo, p.empresa].filter(Boolean).join(' · ')}</span></p>
                <p className="text-sm text-tinta-suave">{p.email}{p.telefono ? ` · ${p.telefono}` : ''}{p.ciudad ? ` · ${p.ciudad}` : ''}</p>
                <p className="mt-1 text-xs font-semibold text-azul">{etiquetaParticipacion(p)} · {p.busca.length + p.ofrece.length > 0 ? `${p.matches} matches · ${p.reuniones} reuniones` : 'perfil sin completar'}</p>
              </div>
              <div className="flex items-center gap-2">
                {p.tipo === 'expositor' ? (
                  <span className="text-xs font-semibold text-tinta-suave">tier expositor</span>
                ) : (
                  <label className="text-xs font-semibold text-tinta-suave">Tier{' '}
                    <select className="campo mt-0 inline-block w-auto min-h-9 py-1 text-sm" value={p.tier} onChange={(e) => cambiar(p, { p_tier: e.target.value })} aria-label={`Tier de ${p.nombre}`}>
                      {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                )}
                <button className="btn-secundario min-h-9 px-3 text-xs" onClick={() => cambiar(p, { p_activo: !p.activo })}>{p.activo ? 'Desactivar' : 'Activar'}</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
