import { Pantalla } from '../components/ui'
import { COMERCIAL_TEXTO, CONSENT_TEXTO, CONSENT_VERSION, POLITICA_URL } from '../lib/catalogos'

export default function Legal() {
  return (
    <Pantalla volver="/">
      <article className="space-y-5 text-sm leading-relaxed">
        <h1 className="text-2xl font-extrabold">Privacidad y datos personales</h1>
        <section className="space-y-2">
          <h2 className="font-bold">Responsable del tratamiento</h2>
          <p>Expohost SAS, NIT 901702368-6. Contacto para datos personales: <span className="font-semibold">management@expohost.travel</span>.</p>
          <p><a href={POLITICA_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-azul underline">Política de Tratamiento de Datos de ExpoHost</a></p>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold">Qué datos usa Expohost Match y para qué</h2>
          <p>Nombre, empresa, cargo, ciudad, correo, celular, foto e intereses comerciales, con el único fin de gestionar tu participación en ExpoHost Bogotá 2026 y Expohost Match: mostrar tu perfil profesional a otros participantes registrados, compartir tu correo y celular solo con quienes aceptes un match, y enviarte confirmaciones y recordatorios de tus reuniones por correo.</p>
          <p>Tu correo y tu celular nunca aparecen en las tarjetas. Solo los ve la persona con quien hiciste match, y cada consulta queda registrada.</p>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold">Autorización que aceptaste al registrarte (versión {CONSENT_VERSION})</h2>
          <p className="rounded-2xl bg-white p-4 text-xs">{CONSENT_TEXTO}</p>
          <p className="text-xs text-tinta-suave">Opcional: {COMERCIAL_TEXTO}</p>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold">Tus derechos</h2>
          <p>Puedes conocer, actualizar, rectificar y suprimir tus datos y revocar la autorización en cualquier momento. Desde la app: edita tu perfil o usa "Eliminar mi cuenta" en tu perfil. También puedes escribir a management@expohost.travel, conforme a la Ley 1581 de 2012.</p>
          <p>Al eliminar tu cuenta se cancelan tus reuniones, se borran tus matches y tu perfil se anonimiza. Conservamos únicamente registros técnicos sin datos personales.</p>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold">Dónde se guardan los datos</h2>
          <p>En Supabase (base de datos y archivos, Estados Unidos) y Resend (envío de correos). La app se publica en GitHub Pages. Solo el personal de la organización de ExpoHost tiene acceso administrativo.</p>
        </section>
      </article>
    </Pantalla>
  )
}
