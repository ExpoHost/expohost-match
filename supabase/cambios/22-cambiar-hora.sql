-- 22 · 30-sep · "Cambiar la hora" de una reunión confirmada (pedido de Lina).
-- La misma reunión se mueve a otro bloque libre para ambos (no se cancela ni se crea otra):
-- conserva el id (el calendario la actualiza) y se envía un correo de "cambió de hora" a los dos.

-- quién movió la reunión por última vez (para el texto del correo); null = nunca se movió
alter table public.meetings add column if not exists cambiada_por uuid;

-- propuestas con límite: 3 al agendar (como antes) y todas las horas libres al cambiar la hora
drop function if exists public.propuestas(uuid);
create or replace function public.propuestas(p_match uuid, p_limite int default 3)
returns table (block_id int, dia date, inicio time, fin time, lugar lugar_reunion, mesa int, stand text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  m public.matches; me uuid := auth.uid();
  pa public.profiles; pb public.profiles; ca public.companies; cb public.companies;
  expositor_stand text; usar_stand boolean; num_mesas int;
  ahora timestamp := (now() at time zone 'America/Bogota');
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or (me <> m.user_a and me <> m.user_b) then raise exception 'match no encontrado'; end if;
  select * into pa from public.profiles where id = m.user_a;
  select * into pb from public.profiles where id = m.user_b;
  select * into ca from public.companies where id = pa.company_id;
  select * into cb from public.companies where id = pb.company_id;
  num_mesas := coalesce((select (value->>0)::int from public.settings where key = 'num_mesas'), 10);

  if pa.tipo = 'expositor' and ca.stand is not null and not ca.prefiere_zona_match then
    usar_stand := true; expositor_stand := ca.stand;
  elsif pb.tipo = 'expositor' and cb.stand is not null and not cb.prefiere_zona_match then
    usar_stand := true; expositor_stand := cb.stand;
  else
    usar_stand := false;
  end if;

  return query
  with libres as (
    select b.* from public.blocks b
    where not b.bloqueado
      and (b.dia + b.inicio) > ahora + interval '10 minutes'
      and public.franja_de(b.dia, b.inicio) = any(pa.franjas)
      and public.franja_de(b.dia, b.inicio) = any(pb.franjas)
      and not exists (select 1 from public.unavailable_blocks u where u.block_id = b.id and u.user_id in (m.user_a, m.user_b))
      and not exists (select 1 from public.meeting_participants mp where mp.block_id = b.id and mp.user_id in (m.user_a, m.user_b))
  )
  select l.id, l.dia, l.inicio, l.fin,
         case when usar_stand then 'stand'::lugar_reunion else 'mesa'::lugar_reunion end,
         case when usar_stand then null else (
           select n from generate_series(1, num_mesas) n
           where not exists (select 1 from public.meetings mt where mt.block_id = l.id and mt.mesa = n and mt.estado = 'confirmada')
           order by n limit 1) end,
         case when usar_stand then expositor_stand else null end
  from libres l
  where usar_stand or exists (
    select 1 from generate_series(1, num_mesas) n
    where not exists (select 1 from public.meetings mt where mt.block_id = l.id and mt.mesa = n and mt.estado = 'confirmada'))
  order by l.dia, l.inicio
  limit greatest(1, least(coalesce(p_limite, 3), 28));
end $$;
revoke execute on function public.propuestas(uuid, int) from public, anon;
grant execute on function public.propuestas(uuid, int) to authenticated;

-- Un participante mueve su reunión confirmada a otra hora libre para ambos.
-- Máximo 3 cambios por reunión al día (cada cambio envía correo a la otra persona).
create or replace function public.reagendar_reunion(p_meeting uuid, p_block int)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mt public.meetings; prop record;
begin
  select * into mt from public.meetings where id = p_meeting and estado = 'confirmada';
  if mt.id is null or not exists (select 1 from public.meeting_participants where meeting_id = p_meeting and user_id = me) then
    raise exception 'reunión no encontrada';
  end if;
  if mt.asistencia_a = 'asistio' or mt.asistencia_b = 'asistio' then raise exception 'Esta reunión ya se realizó.'; end if;
  if mt.block_id = p_block then raise exception 'La reunión ya está en ese horario.'; end if;
  if (select count(*) from public.audit_events where accion = 'reagendar' and objetivo = p_meeting and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Ya cambiaron esta reunión varias veces hoy. Si necesitan otro horario, pidan ayuda a la organización.';
  end if;
  select * into prop from public.propuestas(mt.match_id, 28) where block_id = p_block;
  if prop.block_id is null then raise exception 'Ese horario ya no está disponible. Elige otro.'; end if;

  update public.meeting_participants set block_id = p_block where meeting_id = p_meeting;
  update public.meetings set block_id = p_block, lugar = prop.lugar, mesa = prop.mesa, stand = prop.stand,
    confirmo_a = false, confirmo_b = false, asistencia_a = 'pendiente', asistencia_b = 'pendiente',
    correo_confirmacion_at = null, cambiada_por = me
  where id = p_meeting;
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (me, 'reagendar', p_meeting, jsonb_build_object('de', mt.block_id, 'a', p_block));
exception when unique_violation then
  raise exception 'Ese horario acaba de ocuparse. Elige otro.';
end $$;
revoke execute on function public.reagendar_reunion(uuid, int) from public, anon;
grant execute on function public.reagendar_reunion(uuid, int) to authenticated;

-- La reasignación del panel también deja registrado quién movió la reunión (el correo dice "La organización cambió…")
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
    confirmo_a = false, confirmo_b = false, correo_confirmacion_at = null, cambiada_por = auth.uid()
  where id = p_meeting;
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), 'reasignar', p_meeting, jsonb_build_object('block', p_block, 'lugar', p_lugar, 'mesa', p_mesa, 'stand', p_stand));
exception when unique_violation then
  raise exception 'Esa mesa ya está ocupada en ese bloque';
end $$;

notify pgrst, 'reload schema';
