-- 26-sep · (a) Deshacer un match: quita mi ♥ y el match (y cancela la reunión si la había).
-- La otra persona conserva su ♥: si vuelvo a dar ♥, el match se rehace al instante.
-- (b) deshacer_ultimo_swipe también deshace un ♥ (antes solo un ✕).
-- (c) Admins: los correos de la lista reciben app_metadata.role = 'admin' al crearse.

create or replace function public.deshacer_match(p_match uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.matches; otro uuid; mt uuid;
begin
  if me is null then raise exception 'no autenticado'; end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or (me <> m.user_a and me <> m.user_b) then raise exception 'match no encontrado'; end if;
  otro := case when me = m.user_a then m.user_b else m.user_a end;
  select id into mt from public.meetings where match_id = p_match and estado = 'confirmada';
  if mt is not null then perform public.cancelar_reunion(mt); end if;
  delete from public.matches where id = p_match;
  delete from public.swipes where from_user = me and to_user = otro;
  insert into public.audit_events (actor_id, accion, objetivo) values (me, 'deshacer_match', otro);
  return mt;  -- reunión cancelada (para avisar por correo) o null
end $$;

drop function if exists public.deshacer_ultimo_swipe();  -- antes devolvía void
create function public.deshacer_ultimo_swipe()
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ult record; m uuid; mt uuid;
begin
  if me is null then raise exception 'no autenticado'; end if;
  select * into ult from public.swipes where from_user = me order by created_at desc limit 1;
  if ult.to_user is null then return null; end if;
  if ult.liked then
    select id into m from public.matches where user_a = least(me, ult.to_user) and user_b = greatest(me, ult.to_user);
    if m is not null then mt := public.deshacer_match(m); end if;
  end if;
  delete from public.swipes where from_user = me and to_user = ult.to_user;
  return mt;
end $$;

revoke execute on function public.deshacer_match(uuid), public.deshacer_ultimo_swipe() from public, anon;
grant execute on function public.deshacer_match(uuid), public.deshacer_ultimo_swipe() to authenticated;

-- Admins por correo (editar esta lista y volver a ejecutar si cambia)
create or replace function public.marcar_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) in ('lm.roa@aheadhosting.com.co', 'management@expohost.travel') then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_admin on auth.users;
create trigger on_auth_user_admin before insert on auth.users
  for each row execute function public.marcar_admin();
-- aplicar a los que ya existan
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
 where lower(email) in ('lm.roa@aheadhosting.com.co', 'management@expohost.travel');
