import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10 pt-6">
      <Logo />
      <section className="flex flex-1 flex-col justify-center py-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-azul">ExpoHost Bogotá 2026 · 6 y 7 de octubre</p>
        <h1 className="mt-3 text-4xl font-extrabold leading-tight">
          A la expo no se llega a buscar. <span className="text-azul">Se llega con el match hecho.</span>
        </h1>
        <p className="mt-5 text-lg text-tinta-suave">
          Cuéntanos qué buscas o qué ofreces y armamos tu agenda de reuniones antes de que pises Expohost.
        </p>
      </section>
      <div className="space-y-4">
        <Link to="/registro" className="btn-primario w-full text-lg">Crear mi perfil</Link>
        <p className="text-center text-sm text-tinta-suave">
          ¿Ya tienes perfil? <Link to="/entrar" className="font-semibold text-azul underline-offset-2 hover:underline">Entrar</Link>
        </p>
        <p className="rounded-2xl bg-white px-4 py-3 text-center text-sm text-tinta-suave">
          En la feria entra con tus datos móviles.
        </p>
      </div>
    </main>
  )
}
