// El WhatsApp y el correo de los matches se ven desde el día de la feria (decisión de Lina).
// La fecha real la guarda la base (settings.contacto_desde) y es la que manda; este valor es solo el de respaldo.
export const CONTACTO_DESDE_POR_DEFECTO = '2026-10-06T06:00:00-05:00'
export const textoContactoDesde = 'el martes 6 de octubre a las 6:00 a.m.'

export type Propuesta = { block_id: number; dia: string; inicio: string; fin: string; lugar: 'stand' | 'mesa'; mesa: number | null; stand: string | null }

export type MiMatch = {
  match_id: string; otro_id: string; nombre: string; cargo: string | null; empresa: string | null; foto_path: string | null
  tipo: 'asistente' | 'expositor'; match_at: string
  meeting_id: string | null; block_id: number | null; dia: string | null; inicio: string | null; fin: string | null
  lugar: 'stand' | 'mesa' | null; mesa: number | null; stand: string | null; confirmo: boolean | null
}

const DIAS: Record<string, string> = { '2026-10-06': 'Martes 6 de octubre', '2026-10-07': 'Miércoles 7 de octubre' }
export const diaTexto = (dia: string) => DIAS[dia] ?? dia
export const hora = (t: string) => t.slice(0, 5)
// La reunión dura 25 minutos (5 de cambio)
export const horaFin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  const total = h! * 60 + m! + 25
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
export const lugarTexto = (r: { lugar: 'stand' | 'mesa' | null; mesa: number | null; stand: string | null }) =>
  r.lugar === 'stand' ? `Stand ${r.stand}` : `Zona Match · Mesa ${r.mesa}`

// Archivo .ics para agregar la reunión al calendario (Bogotá = UTC-5, sin horario de verano)
export function descargarIcs(r: { meeting_id: string; dia: string; inicio: string; nombre: string; empresa: string | null } & Parameters<typeof lugarTexto>[0]) {
  const utc = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return `${r.dia.replaceAll('-', '')}T${String(h! + 5).padStart(2, '0')}${String(m).padStart(2, '0')}00Z`
  }
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n')
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Expohost//Match//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${r.meeting_id}@match.expohost.travel`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${utc(r.inicio)}`, `DTEND:${utc(horaFin(r.inicio))}`,
    `SUMMARY:${esc(`Reunión con ${r.nombre}${r.empresa ? ` (${r.empresa})` : ''} · Expohost Match`)}`,
    `LOCATION:${esc(`${lugarTexto(r)} · ExpoHost Bogotá 2026 · Gimnasio Moderno`)}`,
    `DESCRIPTION:${esc('Reunión agendada en Expohost Match. Entra con tus datos móviles.')}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  a.download = 'reunion-expohost.ics'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Google Calendar abre en cualquier navegador (el .ics no siempre funciona en iPhone ni dentro de apps)
export function googleCalendarUrl(r: { dia: string; inicio: string; nombre: string; empresa: string | null } & Parameters<typeof lugarTexto>[0]) {
  const utc = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return `${r.dia.replaceAll('-', '')}T${String(h! + 5).padStart(2, '0')}${String(m).padStart(2, '0')}00Z`
  }
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Reunión con ${r.nombre}${r.empresa ? ` (${r.empresa})` : ''} · Expohost Match`,
    dates: `${utc(r.inicio)}/${utc(horaFin(r.inicio))}`,
    location: `${lugarTexto(r)} · ExpoHost Bogotá 2026 · Gimnasio Moderno`,
    details: 'Reunión agendada en Expohost Match. En la feria entra con tus datos móviles.',
  })
  return `https://calendar.google.com/calendar/render?${p}`
}

// Enlace wa.me: número solo con dígitos; celulares colombianos de 10 dígitos llevan 57
export function whatsappUrl(telefono: string, nombre: string) {
  let n = telefono.replace(/\D/g, '')
  if (n.length === 10 && n.startsWith('3')) n = '57' + n
  const texto = `Hola ${nombre.split(' ')[0]}, hicimos match en Expohost Match.`
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`
}
