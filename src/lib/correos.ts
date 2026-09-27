import { supabase } from './supabase'

// Pide a la Edge Function que envíe el correo de confirmación o cancelación a ambas personas.
// No bloquea a la persona: si el correo falla, la reunión ya quedó guardada.
export function avisarReunion(meetingId: string, tipo: 'confirmada' | 'cancelada') {
  supabase.functions.invoke('correo-reunion', { body: { meeting_id: meetingId, tipo } }).catch(() => {})
}
