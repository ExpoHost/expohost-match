-- 26-sep · El admin decide al aprobar: con stand (Expositor) o sin stand (Proveedor / servicio),
-- sin importar qué haya pedido la empresa.
drop function if exists public.aprobar_expositor(uuid, text);
create function public.aprobar_expositor(p_company uuid, p_stand text default null, p_como_proveedor boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare c public.companies; v_stand text;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  select * into c from public.companies where id = p_company;
  if c.id is null then raise exception 'empresa no encontrada'; end if;
  v_stand := case when p_como_proveedor then null else coalesce(nullif(trim(p_stand), ''), c.stand_declarado) end;
  if not p_como_proveedor and v_stand is null then raise exception 'Indica el número de stand o apruébala como proveedor'; end if;
  update public.companies set tipo = 'expositor', stand = v_stand, solicitud = null where id = p_company;
  if v_stand is not null then
    update public.profiles set tipo = 'expositor', tier = 'expositor' where company_id = p_company;
  else
    update public.profiles set tipo = 'asistente', tier = 'vip' where company_id = p_company;
  end if;
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), 'aprobar_expositor', p_company, jsonb_build_object('stand', v_stand));
end $$;
revoke execute on function public.aprobar_expositor(uuid, text, boolean) from public, anon;
grant execute on function public.aprobar_expositor(uuid, text, boolean) to authenticated;
