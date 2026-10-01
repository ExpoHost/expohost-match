export type Participante = {
  id: string; nombre: string; cargo: string | null; ciudad: string | null; email: string | null; telefono: string | null
  tipo: 'asistente' | 'expositor'; tier: 'general' | 'vip' | 'diamante' | 'expositor'; categoria: string | null
  activo: boolean; invitado: boolean
  company_id: string | null; empresa: string | null; empresa_tipo: 'asistente' | 'expositor' | null
  stand: string | null; solicitud: string | null; stand_declarado: string | null
  busca: string[]; ofrece: string[]; franjas: string[]; foto_path: string | null; created_at: string
  matches: number; reuniones: number
  entro: boolean; sacado: boolean; es_admin: boolean; recordatorio_at: string | null
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

// En qué va cada persona, en palabras claras para el panel
export type Estado = 'completo' | 'invitado' | 'sin_terminar' | 'fuera'
export function estadoPersona(p: Pick<Participante, 'activo' | 'sacado' | 'invitado' | 'entro' | 'busca' | 'ofrece'>): Estado {
  if (p.sacado || !p.activo) return 'fuera'
  if (p.busca.length + p.ofrece.length > 0) return 'completo'
  if (p.invitado && !p.entro) return 'invitado'
  return 'sin_terminar'
}
export const ESTADOS: Record<Estado, { texto: string; clase: string }> = {
  completo: { texto: 'Perfil completo', clase: 'bg-turquesa/20 text-[#006B6B]' },
  invitado: { texto: 'Invitado · no ha entrado', clase: 'bg-naranja/20 text-[#8A4500]' },
  sin_terminar: { texto: 'Empezó, pero no terminó su perfil', clase: 'bg-linea text-tinta-suave' },
  fuera: { texto: 'Fuera de la app', clase: 'bg-rosa/15 text-[#B0103F]' },
}
export const esEmpresaExpositora = (p: Pick<Participante, 'empresa_tipo'>) => p.empresa_tipo === 'expositor'
