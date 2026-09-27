-- 26-sep · Fase 4/5: rellenado desde la lista de stands, reasignar reuniones, lista de espera, encuesta T+1.

-- (a) Rellenado rápido en el registro: por un stand de la lista se devuelve solo empresa y categoría
--     (nunca los correos). Accesible sin sesión porque el registro ocurre antes de confirmar el correo.
create or replace function public.empresa_por_stand(p_stand text)
returns table (empresa text, categoria text) language sql stable security definer set search_path = public as $$
  select s.empresa, s.categoria from public.stand_list s where s.stand = public.normalizar_stand(p_stand) limit 1;
$$;
revoke execute on function public.empresa_por_stand(text) from public;
grant execute on function public.empresa_por_stand(text) to anon, authenticated;

-- (b) Reasignar una reunión (admin): otro bloque y/o lugar. Respeta las mismas reglas de integridad.
create or replace function public.admin_reasignar(p_meeting uuid, p_block int, p_lugar lugar_reunion, p_mesa int default null, p_stand text default null)
returns void language plpgsql security definer set search_path = public as $$
declare mt public.meetings; m public.matches;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  select * into mt from public.meetings where id = p_meeting and estado = 'confirmada';
  if mt.id is null then raise exception 'reunión no encontrada o cancelada'; end if;
  select * into m from public.matches where id = mt.match_id;
  if p_lugar = 'mesa' and p_mesa is null then raise exception 'Indica la mesa'; end if;
  if p_lugar = 'stand' and coalesce(trim(p_stand), '') = '' then raise exception 'Indica el stand'; end if;
  if exists (select 1 from public.blocks where id = p_block and bloqueado) then raise exception 'Ese bloque está bloqueado'; end if;
  -- ¿alguno de los dos ya tiene otra reunión en ese bloque?
  if exists (select 1 from public.meeting_participants mp where mp.block_id = p_block and mp.meeting_id <> p_meeting and mp.user_id in (m.user_a, m.user_b)) then
    raise exception 'Una de las dos personas ya tiene reunión en ese bloque';
  end if;
  update public.meeting_participants set block_id = p_block where meeting_id = p_meeting;
  update public.meetings set block_id = p_block, lugar = p_lugar,
    mesa = case when p_lugar = 'mesa' then p_mesa else null end,
    stand = case when p_lugar = 'stand' then trim(p_stand) else null end,
    confirmo_a = false, confirmo_b = false, correo_confirmacion_at = null
  where id = p_meeting;
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), 'reasignar', p_meeting, jsonb_build_object('block', p_block, 'lugar', p_lugar, 'mesa', p_mesa, 'stand', p_stand));
exception when unique_violation then
  raise exception 'Esa mesa ya está ocupada en ese bloque';
end $$;

-- (c) Lista de espera: si no hay horario libre para un match, la persona se anota en los bloques
--     de sus franjas en común; el panel muestra cuántos esperan por bloque.
create or replace function public.lista_de_espera(p_match uuid)
returns int language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.matches; pa public.profiles; pb public.profiles; n int;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or (me <> m.user_a and me <> m.user_b) then raise exception 'match no encontrado'; end if;
  select * into pa from public.profiles where id = m.user_a;
  select * into pb from public.profiles where id = m.user_b;
  insert into public.waitlist (user_id, block_id)
  select me, b.id from public.blocks b
  where not b.bloqueado
    and public.franja_de(b.dia, b.inicio) = any(pa.franjas) and public.franja_de(b.dia, b.inicio) = any(pb.franjas)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_lista_espera()
returns table (block_id int, dia date, inicio time, personas int, nombres text)
language sql stable security definer set search_path = public as $$
  select b.id, b.dia, b.inicio, count(*)::int, string_agg(p.nombre, ', ' order by w.created_at)
  from public.waitlist w join public.blocks b on b.id = w.block_id join public.profiles p on p.id = w.user_id
  where public.is_admin()
  group by b.id, b.dia, b.inicio order by b.dia, b.inicio;
$$;

-- (d) Encuesta T+1 (8 de octubre): función de servicio para el correo y registro de la respuesta
create or replace function public.reuniones_para_encuesta()
returns table (meeting_id uuid, user_id uuid, nombre text, email text, otro_nombre text, dia date, inicio time)
language sql stable security definer set search_path = public as $$
  select mt.id, p.id, p.nombre, pp.email, o.nombre, b.dia, b.inicio
  from public.meetings mt
  join public.matches m on m.id = mt.match_id
  join public.blocks b on b.id = mt.block_id
  join public.profiles p on p.id in (m.user_a, m.user_b)
  join public.profiles o on o.id = case when p.id = m.user_a then m.user_b else m.user_a end
  join public.profiles_private pp on pp.user_id = p.id
  where mt.estado = 'confirmada' and pp.email not like '%@expohost.invalid'
    and not exists (select 1 from public.surveys s where s.meeting_id = mt.id and s.user_id = p.id)
  order by pp.email, b.dia, b.inicio;
$$;
revoke execute on function public.reuniones_para_encuesta() from public, anon, authenticated;

create or replace function public.responder_encuesta_servicio(p_meeting uuid, p_user uuid, p_util boolean)
returns void language sql security definer set search_path = public as $$
  insert into public.surveys (meeting_id, user_id, util) values (p_meeting, p_user, p_util)
  on conflict (meeting_id, user_id) do update set util = excluded.util, created_at = now();
$$;
revoke execute on function public.responder_encuesta_servicio(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.admin_encuesta()
returns table (respuestas int, utiles int, reuniones int)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.surveys), (select count(*)::int from public.surveys where util),
         (select count(*)::int from public.meetings where estado = 'confirmada')
  where public.is_admin();
$$;

create or replace function public.disparar_correo_encuesta()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value->>0 into v_url from public.secretos where key = 'url_correo_encuesta';
  select value->>0 into v_secret from public.secretos where key = 'cron_secret';
  if v_url is null or v_secret is null then raise notice 'correo-encuesta sin configurar'; return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), body := '{}'::jsonb);
end $$;
insert into public.secretos (key, value) values ('url_correo_encuesta', to_jsonb('https://ujfhvhoutlqphbpwrgfq.supabase.co/functions/v1/correo-encuesta'::text))
on conflict (key) do update set value = excluded.value;
select cron.unschedule(jobid) from cron.job where jobname = 'encuesta-8-oct';
select cron.schedule('encuesta-8-oct', '0 14 8 10 *', $$select public.disparar_correo_encuesta()$$);  -- 9:00 Bogotá

revoke execute on function public.admin_reasignar(uuid, int, lugar_reunion, int, text), public.lista_de_espera(uuid),
  public.admin_lista_espera(), public.admin_encuesta() from public, anon;
grant execute on function public.admin_reasignar(uuid, int, lugar_reunion, int, text), public.lista_de_espera(uuid),
  public.admin_lista_espera(), public.admin_encuesta() to authenticated;
