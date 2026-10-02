-- 26 · 2-oct · "Ver perfil" en Personas del panel (pedido de Lina): el panel recibe también la descripción
-- del perfil, la última vez que la persona entró y si aceptó información comercial.
drop function if exists public.admin_participantes();
create or replace function public.admin_participantes()
returns table (
  id uuid, nombre text, cargo text, ciudad text, email text, telefono text,
  tipo tipo_participante, tier tier_participante, categoria text, activo boolean, invitado boolean,
  company_id uuid, empresa text, empresa_tipo tipo_participante, stand text, solicitud text, stand_declarado text,
  busca text[], ofrece text[], franjas text[], foto_path text, created_at timestamptz,
  matches int, reuniones int, entro boolean, sacado boolean, es_admin boolean, recordatorio_at timestamptz,
  bio text, ultima_entrada timestamptz, acepta_comercial boolean
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.ciudad, pp.email, pp.telefono,
         p.tipo, p.tier, p.categoria, p.activo, p.invitado,
         c.id, c.nombre, c.tipo, c.stand, c.solicitud, c.stand_declarado,
         p.busca, p.ofrece, p.franjas, p.foto_path, p.created_at,
         (select count(*)::int from public.matches m where p.id in (m.user_a, m.user_b)),
         (select count(*)::int from public.meeting_participants mp join public.meetings mt on mt.id = mp.meeting_id
           where mp.user_id = p.id and mt.estado = 'confirmada'),
         u.last_sign_in_at is not null,
         coalesce(u.banned_until > now(), false),
         coalesce(u.raw_app_meta_data->>'role' = 'admin', false),
         p.recordatorio_at,
         p.bio, u.last_sign_in_at, coalesce(pp.acepta_comercial, false)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profiles_private pp on pp.user_id = p.id
  left join public.companies c on c.id = p.company_id
  where public.is_admin()
  order by p.created_at desc;
$$;
revoke execute on function public.admin_participantes() from public, anon;
grant execute on function public.admin_participantes() to authenticated;

notify pgrst, 'reload schema';
