-- 29-sep · eliminar_mi_cuenta también borra la empresa si quedó sin integrantes (evita huérfanas en el panel).
create or replace function public.eliminar_mi_cuenta()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r record; v_company uuid;
begin
  if me is null then raise exception 'no autenticado'; end if;
  for r in select mp.meeting_id from public.meeting_participants mp where mp.user_id = me loop
    perform public.cancelar_reunion(r.meeting_id);
  end loop;
  delete from public.swipes where from_user = me or to_user = me;
  delete from public.matches where user_a = me or user_b = me;
  delete from public.waitlist where user_id = me;
  delete from public.lead_notes where author_id = me or about_id = me;
  select company_id into v_company from public.profiles where id = me;
  update public.profiles set nombre = 'Participante eliminado', cargo = null, ciudad = null, bio = null,
    foto_path = null, busca = '{}', ofrece = '{}', franjas = '{}', activo = false, company_id = null where id = me;
  update public.profiles_private set email = 'eliminado+' || me::text || '@expohost.invalid', telefono = null where user_id = me;
  if v_company is not null and not exists (select 1 from public.profiles where company_id = v_company) then
    delete from public.companies where id = v_company;
  end if;
  insert into public.audit_events (actor_id, accion) values (me, 'eliminar_cuenta');
  delete from auth.users where id = me;
end $$;
