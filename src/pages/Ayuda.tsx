import { Link } from 'react-router-dom'
import { Pantalla } from '../components/ui'
import { useSesion } from '../lib/sesion'

const PREGUNTAS: { q: string; a: string }[] = [
  { q: '¿Qué es Expohost Match?', a: 'Una herramienta para agendar reuniones de 25 minutos en ExpoHost Bogotá (6 y 7 de octubre). Ves perfiles de otras personas; si te interesa reunirte con alguien tocas ♥ y, cuando la otra persona también toca ♥, eligen la hora entre tres opciones.' },
  { q: 'No me llega el código para entrar', a: 'Revisa la carpeta de spam o promociones. Espera un minuto y toca "Reenviar código". Si usas un correo de empresa con Outlook, a veces tarda unos minutos. Si sigue sin llegar, escríbenos a management@expohost.travel.' },
  { q: '¿Tengo que entrar cada vez con un código?', a: 'No. La app te recuerda en tu celular durante la feria. Solo te pedirá código si tocas "Cerrar sesión", si entras desde otro celular o navegador, o pasados 14 días.' },
  { q: '¿Dónde y a qué hora es mi reunión?', a: 'En "Mi agenda" ves cada reunión con el día, la hora y el lugar: el stand del expositor o una mesa numerada de la Zona Match. Te llega también por correo, y la noche anterior recibes un recordatorio con un botón "Confirmo".' },
  { q: '¿Qué hago si no puedo ir a una reunión?', a: 'En "Mi agenda", toca "Cambiar la hora" para pasarla a otro momento en que los dos estén libres, o "Cancelar reunión" si ya no se van a ver. En los dos casos la otra persona recibe un aviso por correo.' },
  { q: 'Toqué ♥ por error', a: 'En Perfiles, toca el botón ↶ para deshacer la última decisión. Si ya hubo match, en la pantalla del match hay un enlace "Deshacer este match". La otra persona no recibe ninguna notificación.' },
  { q: '¿Cómo agrego a un colega de mi empresa?', a: 'Si tu empresa es expositora, en "Mi perfil" verás tu empresa y un campo para agregar hasta 2 representantes más por correo. Cada uno crea su propio perfil con ese correo y tiene su propia agenda.' },
  { q: 'Soy expositor y no me aparece mi stand', a: 'Al registrarte, elige "Expositor con stand" y escribe tu número de stand. Si tu correo coincide con el registrado por la organización, quedas aprobado al instante; si no, la organización lo revisa en unas horas. Mientras tanto puedes usar la app normalmente.' },
  { q: '¿Quién ve mi correo y mi celular?', a: 'Solo las personas con las que tengas una reunión confirmada, y cada consulta queda registrada. En las tarjetas nunca aparecen. Puedes eliminar tu cuenta cuando quieras desde "Mi perfil".' },
  { q: 'En la feria', a: 'Entra con tus datos móviles (el wifi del recinto puede ser lento). Llega 5 minutos antes al lugar de la reunión. Si necesitas ayuda, busca el match desk de la organización.' },
]

export default function Ayuda() {
  const { session } = useSesion()
  return (
    <Pantalla nav={!!session} volver={session ? '/perfil' : '/'}>
      <h1 className="text-2xl font-extrabold">Ayuda</h1>
      <p className="mt-1 text-sm text-tinta-suave">Respuestas cortas a lo que más nos preguntan. Si no encuentras la tuya, escríbenos a <span className="font-semibold text-tinta">management@expohost.travel</span>.</p>
      <div className="mt-6 space-y-3">
        {PREGUNTAS.map((p) => (
          <details key={p.q} className="tarjeta group p-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-bold">
              {p.q}
              <span aria-hidden="true" className="text-xl text-azul transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-tinta-suave">{p.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-tinta-suave"><Link to="/privacidad" className="inline-flex min-h-11 items-center underline">Privacidad y datos personales</Link></p>
    </Pantalla>
  )
}
