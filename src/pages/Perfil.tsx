import { Link } from 'react-router-dom'
import { Aviso, Avatar, Etiquetas, Pantalla } from '../components/ui'
import { supabase } from '../lib/supabase'
import { FRANJAS } from '../lib/catalogos'
import { useSesion } from '../lib/sesion'
import { useCatalogos } from '../lib/utilidades'

export default function Perfil() {
  const { perfil, session } = useSesion()
  const { categorias } = useCatalogos()
  if (!perfil) return null
  const categoria = categorias.find((c) => c.slug === perfil.categoria)?.nombre
  const solicitudPendiente = perfil.tipo === 'asistente' && perfil.empresa?.solicitud

  return (
    <Pantalla nav>
      <article className="tarjeta p-5">
        <div className="flex items-center gap-4">
          <Avatar path={perfil.foto_path} nombre={perfil.nombre} tam="h-20 w-20 text-2xl" />
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold leading-tight">{perfil.nombre}</h1>
            <p className="text-sm text-tinta-suave">{[perfil.cargo, perfil.empresa?.nombre].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-xs font-semibold text-azul">
              {perfil.tipo === 'expositor' && perfil.empresa?.stand ? `Expositor · Stand ${perfil.empresa.stand}`
                : perfil.empresa?.tipo === 'expositor' ? 'Proveedor / servicio' : 'Asistente'}
              {categoria ? ` · ${categoria}` : ''}
            </p>
          </div>
        </div>
        {perfil.bio && <p className="mt-4 text-sm leading-relaxed">{perfil.bio}</p>}
        {perfil.busca.length > 0 && <section className="mt-4"><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#B0103F]">Busco</h2><Etiquetas items={perfil.busca} color="rosa" /></section>}
        {perfil.ofrece.length > 0 && <section className="mt-4"><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-azul">Ofrezco</h2><Etiquetas items={perfil.ofrece} color="azul" /></section>}
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-tinta-suave">Disponible</h2>
          <p className="text-sm">{FRANJAS.filter((f) => perfil.franjas.includes(f.id)).map((f) => `${f.dia}, ${f.hora}`).join(' · ') || 'Sin franjas'}</p>
        </section>
      </article>

      {solicitudPendiente && (
        <div className="mt-4"><Aviso tipo="info">La organización está verificando tu participación como expositor{perfil.empresa?.stand_declarado ? ` (stand ${perfil.empresa.stand_declarado})` : ''}. Mientras tanto usas la app como asistente.</Aviso></div>
      )}

      <section className="tarjeta mt-4 space-y-1 p-5 text-sm">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-tinta-suave">Solo lo ven tus matches</h2>
        <p>{perfil.email}</p>
        <p>{perfil.telefono ?? 'Sin celular registrado'}</p>
      </section>

      <div className="mt-6 space-y-3">
        {session?.user.app_metadata?.role === 'admin' && <Link to="/admin" className="btn w-full bg-tinta text-white">Panel de organización</Link>}
        <Link to="/perfil/editar" className="btn-primario w-full">Editar mi perfil</Link>
        <button className="btn-secundario w-full" onClick={() => supabase.auth.signOut({ scope: 'local' })}>Cerrar sesión</button>
      </div>
    </Pantalla>
  )
}
