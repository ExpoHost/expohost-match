-- 23 · 1-oct · "Sacar de la app" a una persona desde el panel (pedido de Lina) y volver a admitirla.
-- Antes "Ocultar de la app" solo escondía el perfil: la persona seguía entrando y viendo perfiles.
-- Ahora sacar a alguien hace todo de una vez:
--   1. cancela sus reuniones confirmadas (devuelve sus ids para que la app avise por correo a la otra persona),
--   2. oculta su perfil (activo = false: no aparece en Perfiles, ni en matches, ni en "Les interesas"),
--   3. bloquea su acceso (auth.users.banned_until) y cierra sus sesiones abiertas.
-- Volver a admitir deshace 2 y 3 (las reuniones canceladas no se recuperan: se vuelven a agendar).
create or replace function public.admin_sacar(p_user uuid, p_sacar boolean)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare canceladas uuid[] := '{}';
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  if p_user = auth.uid() then raise exception 'No puedes sacarte a ti de la app.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Esa persona ya no existe.'; end if;
  if p_sacar and exists (select 1 from auth.users where id = p_user and raw_app_meta_data->>'role' = 'admin') then
    raise exception 'Esa persona es de la organización y no se puede sacar desde aquí.';
  end if;

  if p_sacar then
    with c as (
      update public.meetings mt set estado = 'cancelada', cancelada_por = auth.uid()
       where mt.estado = 'confirmada'
         and mt.id in (select mp.meeting_id from public.meeting_participants mp where mp.user_id = p_user)
      returning mt.id
    )
    select coalesce(array_agg(c.id), '{}') into canceladas from c;
    delete from public.meeting_participants where meeting_id = any(canceladas);
    delete from public.waitlist where user_id = p_user;
    update public.profiles set activo = false where id = p_user;
    update auth.users set banned_until = '2100-01-01 00:00:00+00' where id = p_user;
    delete from auth.sessions where user_id = p_user;
  else
    update public.profiles set activo = true where id = p_user;
    update auth.users set banned_until = null where id = p_user;
  end if;

  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), case when p_sacar then 'sacar_de_la_app' else 'volver_a_admitir' end, p_user,
          jsonb_build_object('reuniones_canceladas', coalesce(array_length(canceladas, 1), 0)));
  return canceladas;
end $$;
revoke execute on function public.admin_sacar(uuid, boolean) from public, anon;
grant execute on function public.admin_sacar(uuid, boolean) to authenticated;

-- El panel necesita saber si la persona ya entró alguna vez (para distinguir "invitado que no ha abierto
-- el correo" de "entró pero no terminó el perfil") y si está sacada de la app.
drop function if exists public.admin_participantes();
create or replace function public.admin_participantes()
returns table (
  id uuid, nombre text, cargo text, ciudad text, email text, telefono text,
  tipo tipo_participante, tier tier_participante, categoria text, activo boolean, invitado boolean,
  company_id uuid, empresa text, empresa_tipo tipo_participante, stand text, solicitud text, stand_declarado text,
  busca text[], ofrece text[], franjas text[], foto_path text, created_at timestamptz,
  matches int, reuniones int, entro boolean, sacado boolean, es_admin boolean
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
         coalesce(u.raw_app_meta_data->>'role' = 'admin', false)
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
