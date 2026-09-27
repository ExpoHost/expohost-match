import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10 pt-6">
      <Logo />
      <section className="flex flex-1 flex-col justify-center py-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-azul">ExpoHost Bogotá 2026 · 6 y 7 de octubre</p>
        <h1 className="mt-3 text-4xl font-extrabold leading-tight">
          Haz match antes de Expohost. <span className="text-azul">Conecta en persona durante la feria.</span>
        </h1>
        <p className="mt-5 text-lg text-tinta-suave">
          Cuéntanos qué buscas o qué ofreces y te ayudamos a encontrar personas afines para agendar reuniones el 6 y 7 de octubre en Bogotá.
        </p>
      </section>
      <div className="space-y-4">
        <Link to="/registro" className="btn-primario w-full text-lg">Crear mi perfil</Link>
        <p className="text-center text-sm text-tinta-suave">
          ¿Ya tienes perfil? <Link to="/entrar" className="inline-flex min-h-11 items-center px-2 font-semibold text-azul underline-offset-2 hover:underline">Entrar</Link>
        </p>
        <p className="rounded-2xl bg-white px-4 py-3 text-center text-sm text-tinta-suave">
          En la feria entra con tus datos móviles.
        </p>
        <p className="text-center text-xs text-tinta-suave">
          Expohost SAS · <Link to="/privacidad" className="inline-flex min-h-11 items-center underline">Privacidad y datos personales</Link>
        </p>
      </div>
    </main>
  )
}
