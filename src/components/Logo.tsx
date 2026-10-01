// Arcos del logo oficial de ExpoHost: se usa la imagen original (recortada del logo que entregó
// ExpoHost, con fondo transparente), no un redibujo. La misma imagen va en los correos
// (public/correo/arcos.png) y en el ícono de la pestaña (public/favicon.png).
import arcos from '../assets/arcos.png'

export function Arcos({ className = 'h-7 w-auto' }: { className?: string }) {
  return <img src={arcos} alt="" width={592} height={192} className={className} aria-hidden="true" draggable={false} />
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="Expohost Match">
      <Arcos />
      <span className="text-sm font-extrabold tracking-wide text-tinta">
        EXPOHOST <span className="text-azul">MATCH</span>
      </span>
    </span>
  )
}
