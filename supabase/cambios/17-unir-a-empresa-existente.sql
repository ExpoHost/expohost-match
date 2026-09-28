-- 28-sep · Si alguien se registra con un stand de la lista (correo autorizado) y ya existe la empresa
-- expositora de ese stand (por invitación o porque un colega entró antes), se une a ella en vez de
-- crear un duplicado. Igual para empresas sin stand de la lista (por nombre). Máximo 3 por empresa.
create or replace function public.empresa_existente_por_lista(p_solicitud text, p_stand text, p_email text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare s public.stand_list; v uuid;
begin
  if p_solicitud = 'expositor_stand' and coalesce(trim(p_stand), '') <> '' then
    select * into s from public.stand_list where stand = public.normalizar_stand(p_stand) and not sin_stand;
    if s.stand is null or not public.correo_autorizado(p_email, s.correos) then return null; end if;
    select c.id into v from public.companies c
     where c.tipo = 'expositor' and c.stand is not null and public.normalizar_stand(c.stand) = s.stand
       and (select count(*) from public.profiles p where p.company_id = c.id and p.activo) < 3
     order by c.created_at limit 1;
    return v;
  elsif p_solicitud = 'expositor_sin_stand' then
    select * into s from public.stand_list where sin_stand and public.correo_autorizado(p_email, correos) limit 1;
    if s.stand is null then return null; end if;
    select c.id into v from public.companies c
     where c.tipo = 'expositor' and c.stand is null and lower(c.nombre) = lower(s.empresa)
       and (select count(*) from public.profiles p where p.company_id = c.id and p.activo) < 3
     order by c.created_at limit 1;
    return v;
  end if;
  return null;
end $$;
revoke execute on function public.empresa_existente_por_lista(text, text, text) from public, anon, authenticated;

create or replace function public.completar_registro(
  p_nombre text, p_cargo text, p_ciudad text, p_bio text, p_telefono text,
  p_categoria text, p_empresa text, p_solicitud text, p_stand text,
  p_busca text[], p_ofrece text[], p_franjas text[])
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_company uuid; v_tipo tipo_participante; v_stand text; v_email text; inv record; unido boolean := false;
begin
  if me is null then raise exception 'no autenticado'; end if;
  if p_solicitud = 'expositor_stand' and coalesce(trim(p_stand), '') = '' then
    raise exception 'Indica tu número de stand';
  end if;
  select company_id into v_company from public.profiles where id = me;
  select lower(email) into v_email from public.profiles_private where user_id = me;

  -- invitación de representante pendiente para este correo
  select * into inv from public.company_invites where email = v_email;
  if inv.company_id is not null then
    v_company := inv.company_id;
    delete from public.company_invites where email = v_email;
  end if;

  -- empresa expositora ya existente para ese stand / nombre de la lista oficial
  if v_company is null then
    v_company := public.empresa_existente_por_lista(p_solicitud, p_stand, v_email);
    unido := v_company is not null;
  end if;

  if v_company is null then
    insert into public.companies (nombre, categoria, solicitud, stand_declarado)
    values (trim(p_empresa), p_categoria, nullif(p_solicitud, ''), nullif(trim(p_stand), ''))
    returning id into v_company;
  else
    select tipo, stand into v_tipo, v_stand from public.companies where id = v_company;
    update public.companies set
      nombre = case when v_tipo = 'asistente' then trim(p_empresa) else nombre end,
      categoria = coalesce(categoria, p_categoria),
      solicitud = case when v_tipo = 'asistente' then nullif(p_solicitud, '') else solicitud end,
      stand_declarado = case when v_tipo = 'asistente' then nullif(trim(p_stand), '') else stand_declarado end
    where id = v_company;
  end if;

  update public.profiles set
    nombre = trim(p_nombre), cargo = nullif(trim(p_cargo), ''), ciudad = nullif(trim(p_ciudad), ''),
    bio = nullif(trim(p_bio), ''), categoria = p_categoria, company_id = v_company, invitado = false,
    busca  = array(select distinct x from unnest(p_busca) x where x in (select nombre from public.tags where activo)),
    ofrece = array(select distinct x from unnest(p_ofrece) x where x in (select nombre from public.tags where activo)),
    franjas = array(select distinct x from unnest(p_franjas) x where x in ('mar-am','mar-pm','mie-am','mie-pm'))
  where id = me;
  -- etiqueta coherente con la empresa (expositor con stand / proveedor sin stand)
  if v_tipo = 'expositor' or inv.company_id is not null or unido then
    select tipo, stand into v_tipo, v_stand from public.companies where id = v_company;
    if v_tipo = 'expositor' then
      update public.profiles set tipo = (case when v_stand is not null then 'expositor' else 'asistente' end)::tipo_participante,
                                 tier = (case when v_stand is not null then 'expositor' else 'vip' end)::tier_participante
      where id = me;
    end if;
  end if;
  update public.profiles_private set telefono = nullif(trim(p_telefono), '') where user_id = me;
  -- verificación automática contra la lista oficial de stands (empresa nueva)
  perform public.verificar_stand_automatico(v_company, v_email);
end $$;
