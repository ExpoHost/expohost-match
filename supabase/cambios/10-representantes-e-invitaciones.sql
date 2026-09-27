-- 26-sep · Fase 3: representantes por empresa (hasta 3) e invitaciones de expositores.

-- Invitaciones a representantes: cuando ese correo complete su registro, queda en la empresa.
create table if not exists public.company_invites (
  email       text primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  invited_by  uuid,
  created_at  timestamptz not null default now()
);
alter table public.company_invites enable row level security;
-- sin políticas: solo por RPC

-- Mi empresa: integrantes e invitaciones pendientes (para el perfil de expositor)
create or replace function public.mi_empresa()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_company uuid; r jsonb;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then return null; end if;
  select jsonb_build_object(
    'id', c.id, 'nombre', c.nombre, 'tipo', c.tipo, 'stand', c.stand, 'prefiere_zona_match', c.prefiere_zona_match,
    'integrantes', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'cargo', p.cargo, 'invitado', p.invitado) order by p.created_at), '[]'::jsonb)
                    from public.profiles p where p.company_id = c.id and p.activo),
    'invitaciones', (select coalesce(jsonb_agg(jsonb_build_object('email', i.email, 'created_at', i.created_at) order by i.created_at), '[]'::jsonb)
                     from public.company_invites i where i.company_id = c.id)
  ) into r from public.companies c where c.id = v_company;
  return r;
end $$;

-- Un integrante de una empresa expositora/proveedora agrega un representante por correo (máximo 3 personas)
create or replace function public.invitar_representante(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_company uuid; v_email text := lower(trim(p_email)); n int;
begin
  if me is null then raise exception 'no autenticado'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo válido'; end if;
  select p.company_id into v_company from public.profiles p join public.companies c on c.id = p.company_id
   where p.id = me and c.tipo = 'expositor';
  if v_company is null then raise exception 'Solo las empresas expositoras pueden agregar representantes'; end if;
  if exists (select 1 from public.profiles_private where lower(email) = v_email) then
    raise exception 'Esa persona ya tiene perfil. Pídele que escriba a la organización para unirse a tu empresa.';
  end if;
  select (select count(*) from public.profiles where company_id = v_company and activo)
       + (select count(*) from public.company_invites where company_id = v_company) into n;
  if n >= 3 then raise exception 'Una empresa puede tener máximo 3 representantes'; end if;
  insert into public.company_invites (email, company_id, invited_by) values (v_email, v_company, me)
  on conflict (email) do update set company_id = excluded.company_id, invited_by = excluded.invited_by, created_at = now();
end $$;

create or replace function public.retirar_invitacion(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_company uuid;
begin
  select company_id into v_company from public.profiles where id = me;
  delete from public.company_invites where email = lower(trim(p_email)) and (company_id = v_company or public.is_admin());
end $$;

-- completar_registro: si el correo fue invitado por una empresa, entra a esa empresa;
-- si el perfil venía de una invitación por CSV (invitado = true), conserva su empresa y pasa a visible.
create or replace function public.completar_registro(
  p_nombre text, p_cargo text, p_ciudad text, p_bio text, p_telefono text,
  p_categoria text, p_empresa text, p_solicitud text, p_stand text,
  p_busca text[], p_ofrece text[], p_franjas text[])
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_company uuid; v_tipo tipo_participante; v_stand text; v_email text; inv record;
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
  if v_tipo = 'expositor' or inv.company_id is not null then
    select tipo, stand into v_tipo, v_stand from public.companies where id = v_company;
    if v_tipo = 'expositor' then
      update public.profiles set tipo = (case when v_stand is not null then 'expositor' else 'asistente' end)::tipo_participante,
                                 tier = (case when v_stand is not null then 'expositor' else 'vip' end)::tier_participante
      where id = me;
    end if;
  end if;
  update public.profiles_private set telefono = nullif(trim(p_telefono), '') where user_id = me;
end $$;

-- Invitaciones por CSV (la Edge Function invitar-expositores hace el alta con service role):
-- la lista de invitados que aún no entran sale de admin_participantes (invitado = true).

revoke execute on function public.mi_empresa(), public.invitar_representante(text), public.retirar_invitacion(text) from public, anon;
grant execute on function public.mi_empresa(), public.invitar_representante(text), public.retirar_invitacion(text) to authenticated;
