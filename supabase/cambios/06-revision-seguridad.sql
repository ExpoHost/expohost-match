-- 26-sep · Correcciones de la revisión de código (ver CLAUDE.md, "Revisión del 26-sep").

-- 1. Registro pendiente: solo se aplica a perfiles aún incompletos y dentro de 2 horas;
--    tope de tamaño y de filas para evitar abuso desde anon.
create or replace function public.guardar_registro_pendiente(p_email text, p_datos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'correo no válido'; end if;
  if pg_column_size(p_datos) > 150000 then raise exception 'datos demasiado grandes'; end if;
  delete from public.pending_registrations where created_at < now() - interval '2 hours';
  if (select count(*) from public.pending_registrations) > 2000 then raise exception 'demasiados registros pendientes'; end if;
  insert into public.pending_registrations (email, datos) values (v_email, p_datos)
  on conflict (email) do update set datos = excluded.datos, created_at = now();
end $$;

create or replace function public.tomar_registro_pendiente()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; completo boolean;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  delete from public.pending_registrations where email = lower(auth.email()) returning
    case when created_at > now() - interval '2 hours' then datos end into v;
  select cardinality(busca) + cardinality(ofrece) > 0 into completo from public.profiles where id = auth.uid();
  if coalesce(completo, false) then return null; end if;  -- un perfil completo nunca se sobrescribe por esta vía
  return v;
end $$;

-- 2. propuestas: no ofrecer bloques que ya pasaron (margen de 10 minutos, hora de Bogotá)
create or replace function public.propuestas(p_match uuid)
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
  limit 3;
end $$;

-- 3. Correos de reunión: una sola vez por reunión (la Edge Function marca y comprueba)
alter table public.meetings
  add column if not exists correo_confirmacion_at timestamptz,
  add column if not exists correo_cancelacion_at timestamptz;

-- 4. Nadie edita su correo ni columnas ajenas por tabla: solo teléfono y aceptación comercial
revoke update on public.profiles_private from authenticated;
grant update (telefono, acepta_comercial) on public.profiles_private to authenticated;
-- perfiles: foto_path solo se cambia a una ruta propia; arrays con tope
alter table public.profiles drop constraint if exists profiles_busca_tope;
alter table public.profiles add constraint profiles_busca_tope check (cardinality(busca) <= 30 and cardinality(ofrece) <= 30 and cardinality(franjas) <= 4);
alter table public.companies drop constraint if exists companies_nombre_largo;
alter table public.companies add constraint companies_nombre_largo check (char_length(nombre) between 1 and 80);

create or replace function public.proteger_perfil()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    if new.tipo is distinct from old.tipo or new.tier is distinct from old.tier
       or new.company_id is distinct from old.company_id or new.activo is distinct from old.activo
       or new.invitado is distinct from old.invitado then
      raise exception 'Solo la organización puede cambiar tipo, tier, empresa o estado del perfil';
    end if;
    if new.foto_path is distinct from old.foto_path and new.foto_path is not null
       and new.foto_path !~ ('^' || old.id::text || '/') then
      raise exception 'La foto debe estar en tu propia carpeta';
    end if;
  end if;
  return new;
end $$;

-- 5. Crear usuario nunca falla por un nombre raro en los metadatos
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nombre text := left(coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'), ''), 'Nuevo participante'), 80);
begin
  if char_length(v_nombre) < 2 then v_nombre := 'Nuevo participante'; end if;
  insert into public.profiles (id, nombre, invitado)
  values (new.id, v_nombre, false)
  on conflict (id) do update set invitado = false;
  insert into public.profiles_private (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end $$;

-- 6. Feed: prioridad por tier (expositor, diamante, vip, general) y razón sin promesas falsas
create or replace function public.feed(p_limit int default 20)
returns table (
  id uuid, nombre text, cargo text, ciudad text, bio text, foto_path text,
  tipo tipo_participante, categoria text, busca text[], ofrece text[],
  empresa text, stand text, score numeric, razon text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me public.profiles;
begin
  select * into me from public.profiles p0 where p0.id = auth.uid();
  if me.id is null then raise exception 'no autenticado'; end if;
  return query
  select p.id, p.nombre, p.cargo, p.ciudad, p.bio, p.foto_path, p.tipo, p.categoria,
         p.busca, p.ofrece, c.nombre, c.stand,
         sqrt(greatest(public.score_dir(me, p), 0.0001) * greatest(public.score_dir(p, me), 0.0001)) as score,
         case
           when me.busca && p.ofrece then 'Ofrece lo que buscas'
           when p.busca && me.ofrece then 'Busca lo que ofreces'
           when me.categoria is not null and p.categoria is not null and exists (
             select 1 from public.category_affinity ca
             where (ca.a = me.categoria and ca.b = p.categoria) or (ca.a = p.categoria and ca.b = me.categoria))
             then 'Perfil compatible con tu categoría'
           else 'Perfil sugerido'
         end as razon
  from public.profiles p
  left join public.companies c on c.id = p.company_id
  where p.id <> me.id
    and p.activo and not p.invitado
    and cardinality(p.busca) + cardinality(p.ofrece) > 0
    and (me.company_id is null or p.company_id is distinct from me.company_id)
    and not exists (select 1 from public.swipes s where s.from_user = me.id and s.to_user = p.id)
  order by (case when me.tipo = 'asistente' and p.tipo = 'expositor' then 0 else 1 end),
           (case p.tier when 'expositor' then 0 when 'diamante' then 1 when 'vip' then 2 else 3 end),
           score desc, p.created_at
  limit p_limit;
end $$;
