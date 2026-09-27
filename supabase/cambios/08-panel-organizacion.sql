-- 26-sep · Fase 4 (adelantada): funciones del panel de organización. Todas exigen is_admin().

-- Participantes con empresa y contacto (solo admin)
create or replace function public.admin_participantes()
returns table (
  id uuid, nombre text, cargo text, ciudad text, email text, telefono text,
  tipo tipo_participante, tier tier_participante, categoria text, activo boolean, invitado boolean,
  company_id uuid, empresa text, empresa_tipo tipo_participante, stand text, solicitud text, stand_declarado text,
  busca text[], ofrece text[], franjas text[], foto_path text, created_at timestamptz,
  matches int, reuniones int
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.ciudad, pp.email, pp.telefono,
         p.tipo, p.tier, p.categoria, p.activo, p.invitado,
         c.id, c.nombre, c.tipo, c.stand, c.solicitud, c.stand_declarado,
         p.busca, p.ofrece, p.franjas, p.foto_path, p.created_at,
         (select count(*)::int from public.matches m where p.id in (m.user_a, m.user_b)),
         (select count(*)::int from public.meeting_participants mp join public.meetings mt on mt.id = mp.meeting_id
           where mp.user_id = p.id and mt.estado = 'confirmada')
  from public.profiles p
  left join public.profiles_private pp on pp.user_id = p.id
  left join public.companies c on c.id = p.company_id
  where public.is_admin()
  order by p.created_at desc;
$$;

-- Reuniones con ambas personas (solo admin)
create or replace function public.admin_reuniones()
returns table (
  id uuid, estado estado_reunion, block_id int, dia date, inicio time, fin time,
  lugar lugar_reunion, mesa int, stand text,
  a_id uuid, a_nombre text, a_empresa text, asistencia_a asistencia, confirmo_a boolean,
  b_id uuid, b_nombre text, b_empresa text, asistencia_b asistencia, confirmo_b boolean,
  created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select mt.id, mt.estado, b.id, b.dia, b.inicio, b.fin, mt.lugar, mt.mesa, mt.stand,
         pa.id, pa.nombre, ca.nombre, mt.asistencia_a, mt.confirmo_a,
         pb.id, pb.nombre, cb.nombre, mt.asistencia_b, mt.confirmo_b,
         mt.created_at
  from public.meetings mt
  join public.matches m on m.id = mt.match_id
  join public.blocks b on b.id = mt.block_id
  join public.profiles pa on pa.id = m.user_a left join public.companies ca on ca.id = pa.company_id
  join public.profiles pb on pb.id = m.user_b left join public.companies cb on cb.id = pb.company_id
  where public.is_admin()
  order by b.dia, b.inicio, mt.lugar, mt.mesa, mt.stand;
$$;

-- Marcar asistencia de una de las dos personas
create or replace function public.admin_asistencia(p_meeting uuid, p_user uuid, p_valor asistencia)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  select ma.* into m from public.meetings mt join public.matches ma on ma.id = mt.match_id where mt.id = p_meeting;
  if m.id is null then raise exception 'reunión no encontrada'; end if;
  update public.meetings set
    asistencia_a = case when p_user = m.user_a then p_valor else asistencia_a end,
    asistencia_b = case when p_user = m.user_b then p_valor else asistencia_b end
  where id = p_meeting;
end $$;

-- Rechazar (o retirar) una solicitud de expositor: la empresa sigue como asistente
create or replace function public.rechazar_solicitud(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  update public.companies set solicitud = null, stand_declarado = null where id = p_company;
  insert into public.audit_events (actor_id, accion, objetivo) values (auth.uid(), 'rechazar_solicitud', p_company);
end $$;

-- Cambiar tier o estado de un participante
create or replace function public.admin_participante(p_user uuid, p_tier tier_participante default null, p_activo boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  update public.profiles set tier = coalesce(p_tier, tier), activo = coalesce(p_activo, activo) where id = p_user;
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), 'admin_participante', p_user, jsonb_build_object('tier', p_tier, 'activo', p_activo));
end $$;

-- Quitar la condición de expositor/proveedor a una empresa (vuelve a asistente)
create or replace function public.quitar_expositor(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  update public.companies set tipo = 'asistente', stand = null, solicitud = null where id = p_company;
  update public.profiles set tipo = 'asistente', tier = 'general' where company_id = p_company;
  insert into public.audit_events (actor_id, accion, objetivo) values (auth.uid(), 'quitar_expositor', p_company);
end $$;

revoke execute on function public.admin_participantes(), public.admin_reuniones(),
  public.admin_asistencia(uuid, uuid, asistencia), public.rechazar_solicitud(uuid),
  public.admin_participante(uuid, tier_participante, boolean), public.quitar_expositor(uuid) from public, anon;
grant execute on function public.admin_participantes(), public.admin_reuniones(),
  public.admin_asistencia(uuid, uuid, asistencia), public.rechazar_solicitud(uuid),
  public.admin_participante(uuid, tier_participante, boolean), public.quitar_expositor(uuid) to authenticated;
