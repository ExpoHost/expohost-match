// Textos y catálogos fijos de la interfaz. Las etiquetas y categorías vivas salen de la base
// (tablas tags y categories); aquí solo lo que no cambia.

export const FRANJAS = [
  { id: 'mar-am', dia: 'Martes 6', hora: '10:00 – 13:00' },
  { id: 'mar-pm', dia: 'Martes 6', hora: '14:00 – 18:00' },
  { id: 'mie-am', dia: 'Miércoles 7', hora: '10:00 – 13:00' },
  { id: 'mie-pm', dia: 'Miércoles 7', hora: '14:00 – 18:00' },
] as const

export const PARTICIPACION = [
  { id: '', nombre: 'Asistente', detalle: 'Vengo a la feria a conocer y hacer negocios.' },
  { id: 'expositor_stand', nombre: 'Expositor con stand', detalle: 'Mi empresa tiene stand en la feria.' },
  { id: 'expositor_sin_stand', nombre: 'Empresa/servicio sin stand', detalle: 'Ofrezco productos o servicios, pero no tengo stand en la feria.' },
] as const

export const CONSENT_VERSION = '2026-09-24'

export const CONSENT_TEXTO =
  'Autorizo de manera previa, expresa e informada a Expohost SAS (NIT 901702368-6) como Responsable del Tratamiento para recolectar, almacenar y usar mis datos personales (nombre, empresa, cargo, correo, teléfono, foto e intereses comerciales) con el fin de gestionar mi participación en ExpoHost Bogotá 2026 y Expohost Match, mostrar mi perfil profesional a otros participantes registrados, compartir mi correo y teléfono únicamente con los participantes con quienes yo acepte un match y enviarme confirmaciones y recordatorios de mis reuniones por correo. Puedo conocer, actualizar, rectificar y suprimir mis datos y revocar esta autorización escribiendo a management@expohost.travel, conforme a la Ley 1581 de 2012 y a la Política de Tratamiento de Datos de ExpoHost.'

export const COMERCIAL_TEXTO =
  'Acepto recibir información comercial de ExpoHost y sus patrocinadores por correo. Puedo cancelar en cualquier momento.'

export const POLITICA_URL = 'https://www.expohost.travel/tratamientodedatos'

export async function sha256(texto: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
