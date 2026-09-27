export type Participante = {
  id: string; nombre: string; cargo: string | null; ciudad: string | null; email: string | null; telefono: string | null
  tipo: 'asistente' | 'expositor'; tier: 'general' | 'vip' | 'diamante' | 'expositor'; categoria: string | null
  activo: boolean; invitado: boolean
  company_id: string | null; empresa: string | null; empresa_tipo: 'asistente' | 'expositor' | null
  stand: string | null; solicitud: string | null; stand_declarado: string | null
  busca: string[]; ofrece: string[]; franjas: string[]; foto_path: string | null; created_at: string
  matches: number; reuniones: number
}

export type ReunionAdmin = {
  id: string; estado: 'confirmada' | 'cancelada'; block_id: number; dia: string; inicio: string; fin: string
  lugar: 'stand' | 'mesa'; mesa: number | null; stand: string | null
  a_id: string; a_nombre: string; a_empresa: string | null; asistencia_a: Asistencia; confirmo_a: boolean
  b_id: string; b_nombre: string; b_empresa: string | null; asistencia_b: Asistencia; confirmo_b: boolean
  created_at: string
}

export type Asistencia = 'pendiente' | 'asistio' | 'no_vino'

export const ASISTENCIA: Record<Asistencia, string> = { pendiente: 'Pendiente', asistio: 'Asistió', no_vino: 'No vino' }
export const TIERS = ['general', 'vip', 'diamante'] as const

// Etiqueta de participación según la regla de Lina: solo el expositor con stand es "Expositor"
export function etiquetaParticipacion(p: Pick<Participante, 'tipo' | 'stand' | 'empresa_tipo'>) {
  if (p.tipo === 'expositor' && p.stand) return `Expositor · Stand ${p.stand}`
  if (p.empresa_tipo === 'expositor') return 'Proveedor / servicio'
  return 'Asistente'
}
