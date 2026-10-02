-- 27 · 2-oct · La organización puede corregir el perfil de una persona desde el panel (pedido de Lina:
-- "por si piden escalar con nosotros"). Mismas reglas que cuando la persona edita su perfil: etiquetas y
-- franjas válidas, bio de máximo 280 caracteres, sin HTML. El nombre de la empresa es de toda la empresa.
-- Queda auditado. Tipo, prioridad, stand y estado se siguen cambiando con sus botones propios.
create or replace function public.admin_editar_perfil(
  p_user uuid, p_nombre text, p_cargo text, p_ciudad text, p_bio text, p_telefono text, p_categoria text,
  p_busca text[], p_ofrece text[], p_franjas text[], p_empresa text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Esa persona ya no existe.'; end if;
  if char_length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'Escribe el nombre de la persona.'; end if;
  if char_length(coalesce(p_bio, '')) > 280 then raise exception 'La presentación tiene máximo 280 caracteres.'; end if;
  if concat_ws(' ', p_nombre, p_cargo, p_ciudad, p_bio, p_empresa) ~ '[<>]' then raise exception 'Los textos no pueden tener los signos < ni >.'; end if;
  if coalesce(trim(p_telefono), '') <> '' and trim(p_telefono) !~ '^\+\d{1,3} \d{6,15}$' then
    raise exception 'El celular debe quedar así: +57 3001234567 (código de país, espacio y número).';
  end if;
  if p_categoria is not null and p_categoria <> '' and not exists (select 1 from public.categories where slug = p_categoria) then
    raise exception 'Esa categoría no existe.';
  end if;

  update public.profiles set
    nombre = left(trim(p_nombre), 80), cargo = nullif(left(trim(coalesce(p_cargo, '')), 80), ''),
    ciudad = nullif(left(trim(coalesce(p_ciudad, '')), 60), ''), bio = nullif(trim(coalesce(p_bio, '')), ''),
    categoria = nullif(p_categoria, ''),
    busca  = array(select distinct x from unnest(coalesce(p_busca, '{}')) x where x in (select nombre from public.tags where activo)),
    ofrece = array(select distinct x from unnest(coalesce(p_ofrece, '{}')) x where x in (select nombre from public.tags where activo)),
    franjas = array(select distinct x from unnest(coalesce(p_franjas, '{}')) x where x in ('mar-am','mar-pm','mie-am','mie-pm'))
  where id = p_user
  returning company_id into v_company;
  update public.profiles_private set telefono = nullif(trim(coalesce(p_telefono, '')), '') where user_id = p_user;
  if v_company is not null and char_length(trim(coalesce(p_empresa, ''))) >= 2 then
    update public.companies set nombre = left(trim(p_empresa), 80) where id = v_company;
  end if;

  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), 'admin_editar_perfil', p_user, '{}'::jsonb);
end $$;
revoke execute on function public.admin_editar_perfil(uuid, text, text, text, text, text, text, text[], text[], text[], text) from public, anon;
grant execute on function public.admin_editar_perfil(uuid, text, text, text, text, text, text, text[], text[], text[], text) to authenticated;

notify pgrst, 'reload schema';
