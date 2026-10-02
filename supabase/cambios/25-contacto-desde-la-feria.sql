-- 25 · 2-oct · El WhatsApp y el correo de los matches solo se ven desde el día de la feria (decisión de Lina).
-- Las personas hacen match y agendan desde ya, pero el contacto se habilita el martes 6 de octubre a las 6:00 a.m.
-- (Bogotá). Así nadie cuadra por fuera y la reunión ocurre en la feria. La organización (admin) siempre lo ve.
-- La fecha vive en settings (`contacto_desde`) para poder moverla sin publicar código; la app la lee de ahí.

insert into public.settings (key, value) values ('contacto_desde', to_jsonb('2026-10-06T06:00:00-05:00'::text))
on conflict (key) do update set value = excluded.value;

create or replace function public.contacto_abierto()
returns boolean language sql stable security definer set search_path = public as $$
  select now() >= coalesce(
    (select (value #>> '{}')::timestamptz from public.settings where key = 'contacto_desde'),
    '2026-10-06 06:00:00-05'::timestamptz);
$$;
revoke execute on function public.contacto_abierto() from public, anon;
grant execute on function public.contacto_abierto() to authenticated;

-- contacto de otra persona: solo con match, solo desde el día de la feria (salvo admin); queda auditado
create or replace function public.contacto_de(p_user uuid)
returns table (email text, telefono text)
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'no autenticado'; end if;
  if me <> p_user and not public.is_admin() and not public.hay_match(me, p_user) then
    raise exception 'Solo puedes ver el contacto de tus matches';
  end if;
  if me <> p_user and not public.is_admin() and not public.contacto_abierto() then
    raise exception 'El WhatsApp y el correo de tus matches aparecen el martes 6 de octubre a las 6:00 a.m., el día de la feria.';
  end if;
  insert into public.audit_events (actor_id, accion, objetivo) values (me, 'ver_contacto', p_user);
  return query select pp.email, pp.telefono from public.profiles_private pp where pp.user_id = p_user;
end $$;
revoke execute on function public.contacto_de(uuid) from public, anon;
grant execute on function public.contacto_de(uuid) to authenticated;

notify pgrst, 'reload schema';
