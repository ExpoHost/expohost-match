-- =====================================================================
-- Expohost Match · esquema de base de datos (Supabase / Postgres)
-- Versión inicial · 24 de septiembre de 2026
-- Ajustes de seguridad aprobados · 26 de septiembre de 2026 (ver CLAUDE.md)
-- Aplicado en Supabase el 26-sep; pruebas en supabase/pruebas.cjs
--
-- Diseñado para ~300 usuarios. Prioriza claridad y seguridad (RLS) sobre
-- rendimiento. Aplicar con: supabase db push  (o pegar en el SQL Editor).
-- Claude Code puede ajustarlo, pero las reglas de RLS de profiles_private
-- y las restricciones de meeting_participants NO se relajan.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type tipo_participante as enum ('asistente', 'expositor');
create type tier_participante as enum ('general', 'vip', 'diamante', 'expositor');
create type lugar_reunion as enum ('stand', 'mesa');
create type estado_reunion as enum ('confirmada', 'cancelada');
create type asistencia as enum ('pendiente', 'asistio', 'no_vino');

-- ---------------------------------------------------------------------
-- Utilidades de rol
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- ---------------------------------------------------------------------
-- Catálogos y ajustes
-- ---------------------------------------------------------------------
create table public.tags (
  id          serial primary key,
  nombre      text not null unique,
  activo      boolean not null default true,
  orden       int not null default 100
);

create table public.categories (
  slug        text primary key,
  nombre      text not null,
  orden       int not null default 100
);

-- pares de categorías complementarias (simétrico: insertar una sola dirección)
create table public.category_affinity (
  a text references public.categories(slug) on delete cascade,
  b text references public.categories(slug) on delete cascade,
  primary key (a, b)
);

create table public.settings (
  key         text primary key,
  value       jsonb not null
);

-- bloques de 30 min: 10:00–13:00 y 14:00–18:00, 6 y 7 de octubre
create table public.blocks (
  id          serial primary key,
  dia         date not null,
  inicio      time not null,
  fin         time not null,
  bloqueado   boolean not null default false,
  unique (dia, inicio)
);

-- ---------------------------------------------------------------------
-- Empresas y perfiles
-- ---------------------------------------------------------------------
create table public.companies (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  tipo                tipo_participante not null default 'asistente',
  stand               text,                       -- solo expositores
  prefiere_zona_match boolean not null default false,
  categoria           text references public.categories(slug),
  -- solicitud de expositor hecha en el registro; el admin la aprueba
  solicitud           text check (solicitud in ('expositor_stand', 'expositor_sin_stand')),
  stand_declarado     text check (char_length(stand_declarado) <= 20),
  created_at          timestamptz not null default now()
);

-- datos visibles en las tarjetas (nunca contacto)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete set null,
  nombre      text not null check (char_length(nombre) between 2 and 80),
  cargo       text check (char_length(cargo) <= 80),
  ciudad      text check (char_length(ciudad) <= 60),
  bio         text check (char_length(bio) <= 280),
  foto_path   text,                               -- ruta en Storage (bucket privado)
  tipo        tipo_participante not null default 'asistente',
  tier        tier_participante not null default 'general',
  categoria   text references public.categories(slug),
  busca       text[] not null default '{}',
  ofrece      text[] not null default '{}',
  franjas     text[] not null default '{}',       -- 'mar-am','mar-pm','mie-am','mie-pm'
  activo      boolean not null default true,      -- false = anonimizado / invitado sin completar
  invitado    boolean not null default false,     -- cargado por CSV, aún no entra
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- contacto: SOLO dueño, admin o contraparte de un match
create table public.profiles_private (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  email       text not null,
  telefono    text,
  acepta_comercial boolean not null default false
);

create table public.consents (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  version     text not null,
  texto_hash  text not null,
  comercial   boolean not null default false,
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- bloques en los que la persona NO está disponible (excepciones a sus franjas)
create table public.unavailable_blocks (
  user_id     uuid references public.profiles(id) on delete cascade,
  block_id    int references public.blocks(id) on delete cascade,
  primary key (user_id, block_id)
);

-- ---------------------------------------------------------------------
-- Swipes, matches, reuniones
-- ---------------------------------------------------------------------
create table public.swipes (
  from_user   uuid references public.profiles(id) on delete cascade,
  to_user     uuid references public.profiles(id) on delete cascade,
  liked       boolean not null,
  created_at  timestamptz not null default now(),
  primary key (from_user, to_user),
  check (from_user <> to_user)
);
create index swipes_to_liked on public.swipes(to_user) where liked;

create table public.matches (
  id          uuid primary key default gen_random_uuid(),
  user_a      uuid not null references public.profiles(id) on delete cascade,
  user_b      uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table public.meetings (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches(id) on delete cascade,
  block_id      int not null references public.blocks(id),
  lugar         lugar_reunion not null,
  mesa          int,                              -- si lugar = 'mesa'
  stand         text,                             -- si lugar = 'stand'
  estado        estado_reunion not null default 'confirmada',
  asistencia_a  asistencia not null default 'pendiente',
  asistencia_b  asistencia not null default 'pendiente',
  confirmo_a    boolean not null default false,   -- "Confirmo" del correo T-1
  confirmo_b    boolean not null default false,
  created_at    timestamptz not null default now(),
  cancelada_por uuid,
  check ((lugar = 'mesa' and mesa is not null) or (lugar = 'stand' and stand is not null))
);
-- una mesa, un bloque, una reunión activa
create unique index meetings_mesa_bloque on public.meetings(block_id, mesa)
  where estado = 'confirmada' and mesa is not null;
-- una reunión activa por match
create unique index meetings_match_activa on public.meetings(match_id)
  where estado = 'confirmada';

-- participantes por bloque: garantiza que nadie tenga dos reuniones a la vez
create table public.meeting_participants (
  meeting_id  uuid references public.meetings(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  block_id    int references public.blocks(id),
  primary key (meeting_id, user_id),
  unique (user_id, block_id)
);

create table public.lead_notes (
  id          bigserial primary key,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  about_id    uuid not null references public.profiles(id) on delete cascade,
  texto       text not null check (char_length(texto) <= 1000),
  updated_at  timestamptz not null default now(),
  unique (author_id, about_id)
);

create table public.waitlist (
  user_id     uuid references public.profiles(id) on delete cascade,
  block_id    int references public.blocks(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, block_id)
);

create table public.surveys (
  meeting_id  uuid references public.meetings(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  util        boolean not null,
  created_at  timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

create table public.audit_events (
  id          bigserial primary key,
  actor_id    uuid,
  accion      text not null,
  objetivo    uuid,
  detalle     jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Triggers básicos
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- al crear un usuario en Auth, crear perfil mínimo y su fila privada
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nombre, invitado)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', 'Nuevo participante'), false)
  on conflict (id) do update set invitado = false;
  insert into public.profiles_private (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Campos protegidos: un usuario normal (rol 'authenticated' vía la API) no puede
-- cambiar su tipo, tier, empresa ni estado. Las funciones security definer (que
-- corren como 'postgres') y el admin sí pueden.
create or replace function public.proteger_perfil()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and not public.is_admin() and (
       new.tipo is distinct from old.tipo or new.tier is distinct from old.tier
    or new.company_id is distinct from old.company_id or new.activo is distinct from old.activo
    or new.invitado is distinct from old.invitado) then
    raise exception 'Solo la organización puede cambiar tipo, tier, empresa o estado del perfil';
  end if;
  return new;
end $$;
create trigger profiles_proteger before update on public.profiles
  for each row execute function public.proteger_perfil();

-- Empresas: un usuario normal solo crea empresas de asistente y no cambia tipo ni
-- stand. Quien quiere ser expositor lo pide (solicitud + stand_declarado) y el
-- admin lo aprueba con aprobar_expositor().
create or replace function public.proteger_empresa()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    if tg_op = 'INSERT' and (new.tipo <> 'asistente' or new.stand is not null) then
      raise exception 'La organización aprueba a los expositores';
    end if;
    if tg_op = 'UPDATE' and (new.tipo is distinct from old.tipo or new.stand is distinct from old.stand) then
      raise exception 'La organización aprueba a los expositores';
    end if;
  end if;
  return new;
end $$;
create trigger companies_proteger before insert or update on public.companies
  for each row execute function public.proteger_empresa();

-- ---------------------------------------------------------------------
-- Funciones de negocio
-- ---------------------------------------------------------------------

-- ¿el usuario actual participa en la reunión? (security definer: evita recursión de RLS)
create or replace function public.es_participante(p_meeting uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.meeting_participants mp where mp.meeting_id = p_meeting and mp.user_id = auth.uid());
$$;

-- ¿existe match entre dos usuarios?
create or replace function public.hay_match(u1 uuid, u2 uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matches
    where user_a = least(u1, u2) and user_b = greatest(u1, u2)
  );
$$;

-- compatibilidad direccional A→B (0..1)
create or replace function public.score_dir(a public.profiles, b public.profiles)
returns numeric language plpgsql stable as $$
declare
  j1 numeric := 0; j2 numeric := 0; cat numeric := 0; fr numeric := 0;
  inter int; uni int;
begin
  select count(*) into inter from unnest(a.busca) x where x = any(b.ofrece);
  select count(distinct x) into uni from unnest(a.busca || b.ofrece) x;
  if uni > 0 then j1 := inter::numeric / uni; end if;

  select count(*) into inter from unnest(b.busca) x where x = any(a.ofrece);
  select count(distinct x) into uni from unnest(b.busca || a.ofrece) x;
  if uni > 0 then j2 := inter::numeric / uni; end if;

  if a.categoria is not null and b.categoria is not null and exists (
    select 1 from public.category_affinity ca
    where (ca.a = a.categoria and ca.b = b.categoria) or (ca.a = b.categoria and ca.b = a.categoria)
  ) then cat := 1; end if;

  if a.franjas && b.franjas then fr := 1; end if;

  return 0.4*j1 + 0.3*j2 + 0.15*cat + 0.15*fr;
end $$;

-- feed: perfiles no vistos, ordenados por compatibilidad; expositores primero para asistentes
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
           else 'Perfil compatible con tu categoría'
         end as razon
  from public.profiles p
  left join public.companies c on c.id = p.company_id
  where p.id <> me.id
    and p.activo and not p.invitado
    and cardinality(p.busca) + cardinality(p.ofrece) > 0   -- registro completo
    and (me.company_id is null or p.company_id is distinct from me.company_id)
    and not exists (select 1 from public.swipes s where s.from_user = me.id and s.to_user = p.id)
  order by (case when me.tipo = 'asistente' and p.tipo = 'expositor' then 0 else 1 end),
           score desc, p.created_at
  limit p_limit;
end $$;

-- swipe: registra y crea match si es mutuo. Devuelve el match_id o null.
create or replace function public.swipe(p_to uuid, p_liked boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  me_tipo tipo_participante;
  likes_hoy int; tope int;
  m_id uuid;
begin
  if me is null then raise exception 'no autenticado'; end if;
  if me = p_to then raise exception 'no puedes hacer swipe a tu propio perfil'; end if;
  select tipo into me_tipo from public.profiles where id = me;
  tope := case when me_tipo = 'expositor' then 200 else 30 end;
  if p_liked then
    select count(*) into likes_hoy from public.swipes
     where from_user = me and liked
       and (created_at at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date;
    if likes_hoy >= tope then raise exception 'Alcanzaste el tope de ♥ por hoy'; end if;
  end if;

  insert into public.swipes (from_user, to_user, liked) values (me, p_to, p_liked)
  on conflict (from_user, to_user) do update set liked = excluded.liked, created_at = now();

  if p_liked and exists (select 1 from public.swipes where from_user = p_to and to_user = me and liked) then
    insert into public.matches (user_a, user_b) values (least(me, p_to), greatest(me, p_to))
    on conflict (user_a, user_b) do update set created_at = public.matches.created_at
    returning id into m_id;
    insert into public.audit_events (actor_id, accion, objetivo) values (me, 'match', p_to);
  end if;
  return m_id;
end $$;

-- deshacer el último ✕ (solo si no fue ♥)
create or replace function public.deshacer_ultimo_swipe()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ult record;
begin
  select * into ult from public.swipes where from_user = me order by created_at desc limit 1;
  if ult.to_user is not null and not ult.liked then
    delete from public.swipes where from_user = me and to_user = ult.to_user;
  end if;
end $$;

-- propuestas: hasta 3 bloques donde ambos están libres y hay lugar
create or replace function public.propuestas(p_match uuid)
returns table (block_id int, dia date, inicio time, fin time, lugar lugar_reunion, mesa int, stand text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  m public.matches; me uuid := auth.uid();
  pa public.profiles; pb public.profiles; ca public.companies; cb public.companies;
  expositor_stand text; usar_stand boolean; num_mesas int;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or (me <> m.user_a and me <> m.user_b) then raise exception 'match no encontrado'; end if;
  select * into pa from public.profiles where id = m.user_a;
  select * into pb from public.profiles where id = m.user_b;
  select * into ca from public.companies where id = pa.company_id;
  select * into cb from public.companies where id = pb.company_id;
  num_mesas := coalesce((select (value->>0)::int from public.settings where key = 'num_mesas'), 10);

  -- stand por defecto si alguno es expositor y no prefiere Zona Match
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

-- franja ('mar-am', 'mar-pm', 'mie-am', 'mie-pm') de un bloque
create or replace function public.franja_de(p_dia date, p_inicio time)
returns text language sql immutable as $$
  select (case when extract(dow from p_dia) = 2 then 'mar' else 'mie' end)
      || '-' || (case when p_inicio < '13:00' then 'am' else 'pm' end);
$$;

-- reservar: crea la reunión de forma atómica; falla si el bloque o la mesa ya se ocuparon
create or replace function public.reservar_reunion(p_match uuid, p_block int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m public.matches; me uuid := auth.uid(); prop record; mt_id uuid;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or (me <> m.user_a and me <> m.user_b) then raise exception 'match no encontrado'; end if;
  select * into prop from public.propuestas(p_match) where block_id = p_block;
  if prop.block_id is null then raise exception 'Ese horario ya no está disponible'; end if;

  insert into public.meetings (match_id, block_id, lugar, mesa, stand)
  values (p_match, p_block, prop.lugar, prop.mesa, prop.stand)
  returning id into mt_id;
  insert into public.meeting_participants (meeting_id, user_id, block_id)
  values (mt_id, m.user_a, p_block), (mt_id, m.user_b, p_block);
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (me, 'reservar', mt_id, jsonb_build_object('block', p_block));
  return mt_id;
exception when unique_violation then
  raise exception 'Ese horario acaba de ocuparse. Elige otro.';
end $$;

create or replace function public.cancelar_reunion(p_meeting uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ok boolean;
begin
  select exists (select 1 from public.meeting_participants where meeting_id = p_meeting and user_id = me) into ok;
  if not ok and not public.is_admin() then raise exception 'no autorizado'; end if;
  update public.meetings set estado = 'cancelada', cancelada_por = me where id = p_meeting and estado = 'confirmada';
  delete from public.meeting_participants where meeting_id = p_meeting;
  insert into public.audit_events (actor_id, accion, objetivo) values (me, 'cancelar', p_meeting);
end $$;

-- contacto de otra persona: solo con match; queda auditado
create or replace function public.contacto_de(p_user uuid)
returns table (email text, telefono text)
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'no autenticado'; end if;
  if me <> p_user and not public.is_admin() and not public.hay_match(me, p_user) then
    raise exception 'Solo puedes ver el contacto de tus matches';
  end if;
  insert into public.audit_events (actor_id, accion, objetivo) values (me, 'ver_contacto', p_user);
  return query select pp.email, pp.telefono from public.profiles_private pp where pp.user_id = p_user;
end $$;

-- IP y user agent: si el cliente no los envía, se toman de las cabeceras de la petición
create or replace function public.registrar_consentimiento(p_version text, p_hash text, p_comercial boolean, p_ip text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
declare h json := nullif(current_setting('request.headers', true), '')::json; v_ip text;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  v_ip := coalesce(nullif(p_ip, ''), split_part(h->>'x-forwarded-for', ',', 1));
  insert into public.consents (user_id, version, texto_hash, comercial, ip, user_agent)
  values (auth.uid(), p_version, p_hash, p_comercial,
          case when v_ip ~ '^[0-9a-fA-F:.]+$' then trim(v_ip)::inet end,
          left(coalesce(nullif(p_ua, ''), h->>'user-agent'), 300));
  update public.profiles_private set acepta_comercial = p_comercial where user_id = auth.uid();
end $$;

-- registro: guarda perfil, empresa (o solicitud de expositor) y teléfono en un solo paso
create or replace function public.completar_registro(
  p_nombre text, p_cargo text, p_ciudad text, p_bio text, p_telefono text,
  p_categoria text, p_empresa text, p_solicitud text, p_stand text,
  p_busca text[], p_ofrece text[], p_franjas text[])
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_company uuid; v_tipo tipo_participante;
begin
  if me is null then raise exception 'no autenticado'; end if;
  if p_solicitud = 'expositor_stand' and coalesce(trim(p_stand), '') = '' then
    raise exception 'Indica tu número de stand';
  end if;
  select company_id into v_company from public.profiles where id = me;
  if v_company is null then
    insert into public.companies (nombre, categoria, solicitud, stand_declarado)
    values (trim(p_empresa), p_categoria, nullif(p_solicitud, ''), nullif(trim(p_stand), ''))
    returning id into v_company;
  else
    select tipo into v_tipo from public.companies where id = v_company;
    update public.companies set nombre = trim(p_empresa), categoria = p_categoria,
      solicitud = case when v_tipo = 'asistente' then nullif(p_solicitud, '') else solicitud end,
      stand_declarado = case when v_tipo = 'asistente' then nullif(trim(p_stand), '') else stand_declarado end
    where id = v_company;
  end if;
  update public.profiles set
    nombre = trim(p_nombre), cargo = nullif(trim(p_cargo), ''), ciudad = nullif(trim(p_ciudad), ''),
    bio = nullif(trim(p_bio), ''), categoria = p_categoria, company_id = v_company,
    busca  = array(select distinct x from unnest(p_busca) x where x in (select nombre from public.tags where activo)),
    ofrece = array(select distinct x from unnest(p_ofrece) x where x in (select nombre from public.tags where activo)),
    franjas = array(select distinct x from unnest(p_franjas) x where x in ('mar-am','mar-pm','mie-am','mie-pm'))
  where id = me;
  update public.profiles_private set telefono = nullif(trim(p_telefono), '') where user_id = me;
end $$;

-- admin: aprueba una solicitud de expositor (con o sin stand)
create or replace function public.aprobar_expositor(p_company uuid, p_stand text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.companies;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  select * into c from public.companies where id = p_company;
  if c.id is null then raise exception 'empresa no encontrada'; end if;
  update public.companies set tipo = 'expositor',
    stand = case when c.solicitud = 'expositor_sin_stand' then null else coalesce(nullif(trim(p_stand), ''), c.stand_declarado) end
  where id = p_company;
  update public.profiles set tipo = 'expositor', tier = 'expositor' where company_id = p_company;
  insert into public.audit_events (actor_id, accion, objetivo) values (auth.uid(), 'aprobar_expositor', p_company);
end $$;

-- "Confirmo" de la agenda del día siguiente: solo marca la confirmación de quien llama
create or replace function public.confirmar_reunion(p_meeting uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m public.matches;
begin
  select ma.* into m from public.meetings mt join public.matches ma on ma.id = mt.match_id
   where mt.id = p_meeting and mt.estado = 'confirmada';
  if m.id is null or (me <> m.user_a and me <> m.user_b) then raise exception 'reunión no encontrada'; end if;
  update public.meetings set
    confirmo_a = confirmo_a or me = m.user_a,
    confirmo_b = confirmo_b or me = m.user_b
  where id = p_meeting;
end $$;

-- eliminar cuenta: cancela reuniones, borra swipes/matches y elimina el usuario
-- (auth.users → cascade a profiles y profiles_private). audit_events conserva solo el id.
create or replace function public.eliminar_mi_cuenta()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r record;
begin
  for r in select mp.meeting_id from public.meeting_participants mp where mp.user_id = me loop
    perform public.cancelar_reunion(r.meeting_id);
  end loop;
  delete from public.swipes where from_user = me or to_user = me;
  delete from public.matches where user_a = me or user_b = me;
  update public.profiles set nombre = 'Participante eliminado', cargo = null, ciudad = null, bio = null,
    foto_path = null, busca = '{}', ofrece = '{}', franjas = '{}', activo = false, company_id = null where id = me;
  update public.profiles_private set email = 'eliminado+' || me::text || '@expohost.invalid', telefono = null where user_id = me;
  insert into public.audit_events (actor_id, accion) values (me, 'eliminar_cuenta');
  delete from auth.users where id = me;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.tags               enable row level security;
alter table public.categories         enable row level security;
alter table public.category_affinity  enable row level security;
alter table public.settings           enable row level security;
alter table public.blocks             enable row level security;
alter table public.companies          enable row level security;
alter table public.profiles           enable row level security;
alter table public.profiles_private   enable row level security;
alter table public.consents           enable row level security;
alter table public.unavailable_blocks enable row level security;
alter table public.swipes             enable row level security;
alter table public.matches            enable row level security;
alter table public.meetings           enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.lead_notes         enable row level security;
alter table public.waitlist           enable row level security;
alter table public.surveys            enable row level security;
alter table public.audit_events       enable row level security;

-- catálogos: lectura para autenticados, escritura admin
-- etiquetas y categorías también sin sesión: el registro las muestra antes de confirmar el correo
create policy "leer catalogos" on public.tags for select to anon, authenticated using (true);
create policy "admin tags" on public.tags for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leer categorias" on public.categories for select to anon, authenticated using (true);
create policy "admin categorias" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leer afinidad" on public.category_affinity for select to authenticated using (true);
create policy "admin afinidad" on public.category_affinity for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leer settings" on public.settings for select to authenticated using (true);
create policy "admin settings" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "leer bloques" on public.blocks for select to authenticated using (true);
create policy "admin bloques" on public.blocks for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- empresas: lectura para todos los autenticados; editar la propia (representantes) o admin
create policy "leer empresas" on public.companies for select to authenticated using (true);
create policy "editar mi empresa" on public.companies for update to authenticated
  using (id = (select company_id from public.profiles where id = auth.uid()) or public.is_admin())
  with check (id = (select company_id from public.profiles where id = auth.uid()) or public.is_admin());
create policy "crear empresa" on public.companies for insert to authenticated with check (true);
create policy "admin borra empresas" on public.companies for delete to authenticated using (public.is_admin());

-- perfiles públicos: lectura general (sin contacto), edición propia
create policy "leer perfiles" on public.profiles for select to authenticated using (activo or id = auth.uid() or public.is_admin());
create policy "editar mi perfil" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "admin inserta perfiles" on public.profiles for insert to authenticated with check (public.is_admin());

-- contacto: SOLO dueño o admin por tabla; la contraparte lo obtiene vía contacto_de()
create policy "mi contacto" on public.profiles_private for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "editar mi contacto" on public.profiles_private for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy "mis consentimientos" on public.consents for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy "mi disponibilidad" on public.unavailable_blocks for all to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

-- swipes: solo los propios (se escriben vía swipe())
create policy "mis swipes" on public.swipes for select to authenticated using (from_user = auth.uid() or public.is_admin());

create policy "mis matches" on public.matches for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid() or public.is_admin());

create policy "mis reuniones" on public.meetings for select to authenticated
  using (public.is_admin() or public.es_participante(id));
create policy "admin edita reuniones" on public.meetings for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- los participantes confirman solo vía confirmar_reunion()

create policy "mis participaciones" on public.meeting_participants for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.es_participante(meeting_id));

create policy "mis notas" on public.lead_notes for all to authenticated
  using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());

create policy "mi lista de espera" on public.waitlist for all to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy "mi encuesta" on public.surveys for all to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy "admin lee auditoria" on public.audit_events for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Permisos de funciones: nadie sin sesión ejecuta funciones; las internas
-- solo se usan desde otras funciones.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
revoke execute on function public.hay_match(uuid, uuid), public.score_dir(public.profiles, public.profiles),
  public.handle_new_user(), public.set_updated_at(), public.proteger_perfil(), public.proteger_empresa()
  from authenticated;

-- ---------------------------------------------------------------------
-- Storage: fotos de perfil (bucket privado, URLs firmadas)
-- Cada usuario escribe solo en su carpeta {user_id}/; cualquier usuario con sesión
-- puede ver fotos (se muestran en las tarjetas).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "ver fotos" on storage.objects for select to authenticated using (bucket_id = 'fotos');
create policy "subir mi foto" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cambiar mi foto" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "borrar mi foto" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- Datos iniciales
-- ---------------------------------------------------------------------
insert into public.settings (key, value) values
  ('num_mesas', '10'),
  ('consent_version', '"2026-09-24"');

insert into public.categories (slug, nombre, orden) values
  ('inversionistas', 'Inversionistas y capital', 1),
  ('propietarios', 'Propietarios y anfitriones', 2),
  ('property-managers', 'Property managers', 3),
  ('constructoras', 'Constructoras y desarrolladores', 4),
  ('tecnologia', 'Tecnología', 5),
  ('proveedores', 'Proveedores', 6),
  ('marketing', 'Marketing y demanda', 7),
  ('hoteleria', 'Hotelería', 8),
  ('institucionales', 'Institucionales y gremios', 9);

insert into public.category_affinity (a, b) values
  ('inversionistas','constructoras'), ('inversionistas','propietarios'), ('inversionistas','property-managers'),
  ('propietarios','property-managers'), ('propietarios','tecnologia'), ('propietarios','proveedores'),
  ('property-managers','tecnologia'), ('property-managers','proveedores'), ('property-managers','marketing'), ('property-managers','constructoras'),
  ('tecnologia','hoteleria'), ('proveedores','hoteleria'), ('marketing','hoteleria'),
  ('institucionales','inversionistas'), ('institucionales','propietarios'), ('institucionales','property-managers'),
  ('institucionales','constructoras'), ('institucionales','tecnologia'), ('institucionales','proveedores'),
  ('institucionales','marketing'), ('institucionales','hoteleria');

insert into public.tags (nombre, orden) values
  ('Propiedades para operar', 1), ('Capital / inversión', 2), ('Property management', 3),
  ('Tecnología (PMS, channel manager, IA)', 4), ('Revenue management', 5), ('Automatización', 6),
  ('Fotografía y video', 7), ('Aseo y lencería', 8), ('Mobiliario y decoración', 9),
  ('Cerraduras y acceso', 10), ('Seguros y legal', 11), ('Marketing y canales de demanda', 12),
  ('Proyectos y constructoras', 13), ('Hotelería y nuevos modelos', 14),
  ('Formación y consultoría', 15), ('Institucional y gremios', 16);

-- 28 bloques: 6 y 7 de octubre de 2026, 10:00–13:00 y 14:00–18:00
insert into public.blocks (dia, inicio, fin)
select ts::date, ts::time, (ts + interval '30 minutes')::time
from (
  select generate_series(timestamp '2026-10-06 10:00', timestamp '2026-10-06 17:30', interval '30 minutes') as ts
  union all
  select generate_series(timestamp '2026-10-07 10:00', timestamp '2026-10-07 17:30', interval '30 minutes')
) s
where ts::time not between time '13:00' and time '13:30';

-- Nota para la carga de expositores por CSV (Fase 3): crear primero el usuario
-- con auth.admin.inviteUserByEmail (o createUser) desde una Edge Function; el
-- trigger handle_new_user crea profiles y profiles_private; luego actualizar
-- profiles (tipo='expositor', tier='expositor', company_id, invitado=true).

-- =====================================================================
-- Este esquema fue aplicado y probado en Postgres 16 el 24-sep-2026 con un
-- mock de auth: feed, swipe mutuo → match, propuestas (stand por defecto y
-- mesa entre asistentes), reserva, doble reserva rechazada, contacto solo con
-- match, RLS de reuniones, cancelación y eliminación de cuenta.
--
-- Pruebas rápidas que Claude Code debe repetir en Supabase al terminar la Fase 0:
-- 1. Con la clave publishable y sin sesión: select * from profiles_private → 0 filas.
-- 2. Con un usuario A: select * from profiles_private → solo su fila.
-- 3. A y B hacen swipe mutuo → swipe() devuelve match_id.
-- 4. propuestas(match) devuelve hasta 3 bloques; reservar_reunion dos veces
--    en el mismo bloque para el mismo usuario → error de horario ocupado.
-- 5. contacto_de(B) desde A funciona solo después del match.
-- =====================================================================

-- =====================================================================
-- Cambios posteriores (también en supabase/cambios/)
-- =====================================================================
-- 26-sep · Fase 2: matches y reuniones de la persona actual (para "Mi agenda").
-- Nunca devuelve correo ni teléfono: el contacto se pide aparte con contacto_de() (auditado).
create or replace function public.mis_matches()
returns table (
  match_id uuid, otro_id uuid, nombre text, cargo text, empresa text, foto_path text,
  tipo tipo_participante, match_at timestamptz,
  meeting_id uuid, block_id int, dia date, inicio time, fin time,
  lugar lugar_reunion, mesa int, stand text, confirmo boolean
) language sql stable security definer set search_path = public as $$
  select m.id, o.id, o.nombre, o.cargo, c.nombre, o.foto_path, o.tipo, m.created_at,
         mt.id, b.id, b.dia, b.inicio, b.fin, mt.lugar, mt.mesa, mt.stand,
         case when auth.uid() = m.user_a then mt.confirmo_a else mt.confirmo_b end
  from public.matches m
  join public.profiles o on o.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
  left join public.companies c on c.id = o.company_id
  left join public.meetings mt on mt.match_id = m.id and mt.estado = 'confirmada'
  left join public.blocks b on b.id = mt.block_id
  where auth.uid() in (m.user_a, m.user_b) and o.activo
  order by b.dia nulls last, b.inicio, m.created_at desc;
$$;
revoke execute on function public.mis_matches() from public, anon;
grant execute on function public.mis_matches() to authenticated;

-- 26-sep · Categorías nuevas pedidas por Lina: Hostales, Senior living, Coliving y Otro.
-- Institucionales pasa al final y "Otro" queda de último, sin afinidades (no suma puntos de compatibilidad).
insert into public.categories (slug, nombre, orden) values
  ('hostales', 'Hostales', 9),
  ('senior-living', 'Senior living', 10),
  ('coliving', 'Coliving', 11),
  ('otro', 'Otro', 99)
on conflict (slug) do update set nombre = excluded.nombre, orden = excluded.orden;
update public.categories set orden = 12 where slug = 'institucionales';

insert into public.category_affinity (a, b) values
  ('hostales', 'tecnologia'), ('hostales', 'proveedores'), ('hostales', 'marketing'), ('hostales', 'inversionistas'),
  ('senior-living', 'inversionistas'), ('senior-living', 'constructoras'), ('senior-living', 'proveedores'), ('senior-living', 'tecnologia'),
  ('coliving', 'inversionistas'), ('coliving', 'constructoras'), ('coliving', 'property-managers'), ('coliving', 'tecnologia'),
  ('coliving', 'proveedores'), ('coliving', 'marketing'),
  ('institucionales', 'hostales'), ('institucionales', 'senior-living'), ('institucionales', 'coliving')
on conflict do nothing;

-- 26-sep · Registro pendiente en el servidor.
-- El correo de acceso puede abrirse en otro navegador (Gmail en el celular): los datos del
-- registro se guardan aquí antes de enviar el código y se recuperan al entrar, desde cualquier
-- navegador. Solo se accede por RPC; la fila se borra al usarse (o a los 7 días).
create table if not exists public.pending_registrations (
  email       text primary key,
  datos       jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.pending_registrations enable row level security;
-- sin políticas: nadie lee ni escribe la tabla directamente

create or replace function public.guardar_registro_pendiente(p_email text, p_datos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'correo no válido'; end if;
  if pg_column_size(p_datos) > 300000 then raise exception 'datos demasiado grandes'; end if;
  delete from public.pending_registrations where created_at < now() - interval '7 days';
  insert into public.pending_registrations (email, datos) values (v_email, p_datos)
  on conflict (email) do update set datos = excluded.datos, created_at = now();
end $$;

-- devuelve y borra los datos pendientes del correo de la sesión actual (o null)
create or replace function public.tomar_registro_pendiente()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  delete from public.pending_registrations where email = lower(auth.email()) returning datos into v;
  return v;
end $$;

revoke execute on function public.guardar_registro_pendiente(text, jsonb), public.tomar_registro_pendiente() from public;
grant execute on function public.guardar_registro_pendiente(text, jsonb) to anon, authenticated;
grant execute on function public.tomar_registro_pendiente() to authenticated;

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

-- 26-sep · Decisión de Lina: solo el expositor CON stand lleva la etiqueta "Expositor" (con su
-- número de stand) y va primero en el feed. La empresa aprobada SIN stand queda como
-- "Proveedor / servicio": el perfil sigue siendo tipo 'asistente' con tier 'vip' (visible por
-- encima de los asistentes generales, por debajo de los expositores) y su empresa tiene
-- tipo 'expositor' sin stand. Sus reuniones van a la Zona Match.

create or replace function public.aprobar_expositor(p_company uuid, p_stand text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.companies; v_stand text;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  select * into c from public.companies where id = p_company;
  if c.id is null then raise exception 'empresa no encontrada'; end if;
  v_stand := case when c.solicitud = 'expositor_sin_stand' and p_stand is null then null
                  else coalesce(nullif(trim(p_stand), ''), c.stand_declarado) end;
  update public.companies set tipo = 'expositor', stand = v_stand where id = p_company;
  if v_stand is not null then
    update public.profiles set tipo = 'expositor', tier = 'expositor' where company_id = p_company;
  else
    update public.profiles set tipo = 'asistente', tier = 'vip' where company_id = p_company;
  end if;
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), 'aprobar_expositor', p_company, jsonb_build_object('stand', v_stand));
end $$;

-- feed: expone "proveedor" (empresa aprobada sin stand) para la etiqueta de la tarjeta
drop function if exists public.feed(int);
create function public.feed(p_limit int default 20)
returns table (
  id uuid, nombre text, cargo text, ciudad text, bio text, foto_path text,
  tipo tipo_participante, categoria text, busca text[], ofrece text[],
  empresa text, stand text, proveedor boolean, score numeric, razon text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me public.profiles;
begin
  select * into me from public.profiles p0 where p0.id = auth.uid();
  if me.id is null then raise exception 'no autenticado'; end if;
  return query
  select p.id, p.nombre, p.cargo, p.ciudad, p.bio, p.foto_path, p.tipo, p.categoria,
         p.busca, p.ofrece, c.nombre, c.stand,
         (c.tipo = 'expositor' and c.stand is null) as proveedor,
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
revoke execute on function public.feed(int) from public, anon;
grant execute on function public.feed(int) to authenticated;

-- 26-sep · Fase 4 (adelantada): funciones del panel de organización. Todas exigen is_admin().

-- Participantes con empresa y contacto (solo admin)
create or replace function public.admin_participantes()
returns table (
  id uuid, nombre text, cargo text, ciudad text, email text, telefono text,
  tipo tipo_participante, tier tier_participante, categoria text, activo boolean, invitado boolean,
  company_id uuid, empresa text, empresa_tipo tipo_participante, stand text, solicitud text, stand_declarado text,
  busca text[], ofrece text[], franjas text[], foto_path text, created_at timestamptz,
  matches int, reuniones int
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.ciudad, pp.email, pp.telefono,
         p.tipo, p.tier, p.categoria, p.activo, p.invitado,
         c.id, c.nombre, c.tipo, c.stand, c.solicitud, c.stand_declarado,
         p.busca, p.ofrece, p.franjas, p.foto_path, p.created_at,
         (select count(*)::int from public.matches m where p.id in (m.user_a, m.user_b)),
         (select count(*)::int from public.meeting_participants mp join public.meetings mt on mt.id = mp.meeting_id
           where mp.user_id = p.id and mt.estado = 'confirmada')
  from public.profiles p
  left join public.profiles_private pp on pp.user_id = p.id
  left join public.companies c on c.id = p.company_id
  where public.is_admin()
  order by p.created_at desc;
$$;

-- Reuniones con ambas personas (solo admin)
create or replace function public.admin_reuniones()
returns table (
  id uuid, estado estado_reunion, block_id int, dia date, inicio time, fin time,
  lugar lugar_reunion, mesa int, stand text,
  a_id uuid, a_nombre text, a_empresa text, asistencia_a asistencia, confirmo_a boolean,
  b_id uuid, b_nombre text, b_empresa text, asistencia_b asistencia, confirmo_b boolean,
  created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select mt.id, mt.estado, b.id, b.dia, b.inicio, b.fin, mt.lugar, mt.mesa, mt.stand,
         pa.id, pa.nombre, ca.nombre, mt.asistencia_a, mt.confirmo_a,
         pb.id, pb.nombre, cb.nombre, mt.asistencia_b, mt.confirmo_b,
         mt.created_at
  from public.meetings mt
  join public.matches m on m.id = mt.match_id
  join public.blocks b on b.id = mt.block_id
  join public.profiles pa on pa.id = m.user_a left join public.companies ca on ca.id = pa.company_id
  join public.profiles pb on pb.id = m.user_b left join public.companies cb on cb.id = pb.company_id
  where public.is_admin()
  order by b.dia, b.inicio, mt.lugar, mt.mesa, mt.stand;
$$;

-- Marcar asistencia de una de las dos personas
create or replace function public.admin_asistencia(p_meeting uuid, p_user uuid, p_valor asistencia)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  select ma.* into m from public.meetings mt join public.matches ma on ma.id = mt.match_id where mt.id = p_meeting;
  if m.id is null then raise exception 'reunión no encontrada'; end if;
  update public.meetings set
    asistencia_a = case when p_user = m.user_a then p_valor else asistencia_a end,
    asistencia_b = case when p_user = m.user_b then p_valor else asistencia_b end
  where id = p_meeting;
end $$;

-- Rechazar (o retirar) una solicitud de expositor: la empresa sigue como asistente
create or replace function public.rechazar_solicitud(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  update public.companies set solicitud = null, stand_declarado = null where id = p_company;
  insert into public.audit_events (actor_id, accion, objetivo) values (auth.uid(), 'rechazar_solicitud', p_company);
end $$;

-- Cambiar tier o estado de un participante
create or replace function public.admin_participante(p_user uuid, p_tier tier_participante default null, p_activo boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  update public.profiles set tier = coalesce(p_tier, tier), activo = coalesce(p_activo, activo) where id = p_user;
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), 'admin_participante', p_user, jsonb_build_object('tier', p_tier, 'activo', p_activo));
end $$;

-- Quitar la condición de expositor/proveedor a una empresa (vuelve a asistente)
create or replace function public.quitar_expositor(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  update public.companies set tipo = 'asistente', stand = null, solicitud = null where id = p_company;
  update public.profiles set tipo = 'asistente', tier = 'general' where company_id = p_company;
  insert into public.audit_events (actor_id, accion, objetivo) values (auth.uid(), 'quitar_expositor', p_company);
end $$;

revoke execute on function public.admin_participantes(), public.admin_reuniones(),
  public.admin_asistencia(uuid, uuid, asistencia), public.rechazar_solicitud(uuid),
  public.admin_participante(uuid, tier_participante, boolean), public.quitar_expositor(uuid) from public, anon;
grant execute on function public.admin_participantes(), public.admin_reuniones(),
  public.admin_asistencia(uuid, uuid, asistencia), public.rechazar_solicitud(uuid),
  public.admin_participante(uuid, tier_participante, boolean), public.quitar_expositor(uuid) to authenticated;

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

-- 26-sep · Razón honesta en la tarjeta (pedido de Lina): si no hay intereses ni categoría en común, decirlo.
drop function if exists public.feed(int);
create function public.feed(p_limit int default 20)
returns table (
  id uuid, nombre text, cargo text, ciudad text, bio text, foto_path text,
  tipo tipo_participante, categoria text, busca text[], ofrece text[],
  empresa text, stand text, proveedor boolean, score numeric, razon text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me public.profiles;
begin
  select * into me from public.profiles p0 where p0.id = auth.uid();
  if me.id is null then raise exception 'no autenticado'; end if;
  return query
  select p.id, p.nombre, p.cargo, p.ciudad, p.bio, p.foto_path, p.tipo, p.categoria,
         p.busca, p.ofrece, c.nombre, c.stand,
         (c.tipo = 'expositor' and c.stand is null) as proveedor,
         sqrt(greatest(public.score_dir(me, p), 0.0001) * greatest(public.score_dir(p, me), 0.0001)) as score,
         case
           when me.busca && p.ofrece and p.busca && me.ofrece then 'Coincidencia mutua'
           when me.busca && p.ofrece then 'Ofrece lo que buscas'
           when p.busca && me.ofrece then 'Busca lo que ofreces'
           when me.categoria is not null and p.categoria is not null and exists (
             select 1 from public.category_affinity ca
             where (ca.a = me.categoria and ca.b = p.categoria) or (ca.a = p.categoria and ca.b = me.categoria))
             then 'Perfil compatible con tu categoría'
           when me.franjas && p.franjas then 'Coinciden en horario'
           else 'Sin intereses en común'
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
revoke execute on function public.feed(int) from public, anon;
grant execute on function public.feed(int) to authenticated;

-- 26-sep · Correo de agenda del día siguiente (Fase 4).
-- (a) Función de servicio para la Edge Function correo-agenda (solo service role: no se concede a nadie).
create or replace function public.admin_reuniones_servicio(p_dia date)
returns table (
  id uuid, inicio time, lugar lugar_reunion, mesa int, stand text,
  a_id uuid, a_nombre text, a_empresa text, a_email text, confirmo_a boolean,
  b_id uuid, b_nombre text, b_empresa text, b_email text, confirmo_b boolean
) language sql stable security definer set search_path = public as $$
  select mt.id, b.inicio, mt.lugar, mt.mesa, mt.stand,
         pa.id, pa.nombre, ca.nombre, ppa.email, mt.confirmo_a,
         pb.id, pb.nombre, cb.nombre, ppb.email, mt.confirmo_b
  from public.meetings mt
  join public.matches m on m.id = mt.match_id
  join public.blocks b on b.id = mt.block_id
  join public.profiles pa on pa.id = m.user_a left join public.companies ca on ca.id = pa.company_id left join public.profiles_private ppa on ppa.user_id = pa.id
  join public.profiles pb on pb.id = m.user_b left join public.companies cb on cb.id = pb.company_id left join public.profiles_private ppb on ppb.user_id = pb.id
  where mt.estado = 'confirmada' and b.dia = p_dia
  order by b.inicio;
$$;
revoke execute on function public.admin_reuniones_servicio(date) from public, anon, authenticated;

-- (b) Programación: 5 y 6 de octubre a las 19:00 de Bogotá = 00:00 UTC del día siguiente.
-- Requiere pg_cron y pg_net (Supabase los incluye). La URL y el secreto se leen de settings.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.disparar_correo_agenda()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value->>0 into v_url from public.settings where key = 'url_correo_agenda';
  select value->>0 into v_secret from public.settings where key = 'cron_secret';
  if v_url is null or v_secret is null then raise notice 'correo-agenda sin configurar'; return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), body := '{}'::jsonb);
end $$;

select cron.unschedule(jobid) from cron.job where jobname in ('agenda-6-oct', 'agenda-7-oct');
select cron.schedule('agenda-6-oct', '0 0 6 10 *', $$select public.disparar_correo_agenda()$$);
select cron.schedule('agenda-7-oct', '0 0 7 10 *', $$select public.disparar_correo_agenda()$$);

-- settings: solo admin puede leerlos por RLS, pero el secreto no debe salir al cliente:
-- se guardan en una tabla aparte sin políticas.
create table if not exists public.secretos (key text primary key, value jsonb not null);
alter table public.secretos enable row level security;
create or replace function public.disparar_correo_agenda()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value->>0 into v_url from public.secretos where key = 'url_correo_agenda';
  select value->>0 into v_secret from public.secretos where key = 'cron_secret';
  if v_url is null or v_secret is null then raise notice 'correo-agenda sin configurar'; return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), body := '{}'::jsonb);
end $$;
insert into public.secretos (key, value) values ('url_correo_agenda', to_jsonb('https://ujfhvhoutlqphbpwrgfq.supabase.co/functions/v1/correo-agenda'::text))
on conflict (key) do update set value = excluded.value;
-- 'cron_secret' se inserta desde Claude Code con el mismo valor que el secreto CRON_SECRET de la función.

-- 26-sep · Lista oficial de stands (propuesta de Lina): la organización carga empresa + stand
-- (+ correos o dominio de contacto). Cuando alguien se registra como "Expositor con stand" y su
-- stand coincide con la lista y su correo (o dominio) también, se aprueba solo. Si solo coincide
-- el stand, queda pendiente con una pista para el admin.
create table if not exists public.stand_list (
  stand       text primary key,                 -- normalizado: mayúsculas, sin espacios
  empresa     text not null,
  correos     text[] not null default '{}',     -- correos o dominios (@empresa.com) autorizados
  categoria   text references public.categories(slug),
  created_at  timestamptz not null default now()
);
alter table public.stand_list enable row level security;
create policy "admin lista de stands" on public.stand_list for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.normalizar_stand(s text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(s, ''), '[\s\-_.]', '', 'g'));
$$;

-- ¿coincide el correo con la lista? (correo exacto o dominio)
create or replace function public.correo_autorizado(p_email text, p_correos text[]) returns boolean language sql immutable as $$
  select exists (
    select 1 from unnest(p_correos) c
    where lower(trim(c)) = lower(p_email)
       or (trim(c) like '@%' and lower(p_email) like '%' || lower(trim(c)))
  );
$$;

-- Verificación automática al completar el registro (la llama completar_registro)
create or replace function public.verificar_stand_automatico(p_company uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.companies; s public.stand_list;
begin
  select * into c from public.companies where id = p_company;
  if c.id is null or c.tipo = 'expositor' or c.solicitud <> 'expositor_stand' or c.stand_declarado is null then return; end if;
  select * into s from public.stand_list where stand = public.normalizar_stand(c.stand_declarado);
  if s.stand is null then return; end if;
  if public.correo_autorizado(p_email, s.correos) then
    update public.companies set tipo = 'expositor', stand = c.stand_declarado, solicitud = null,
      categoria = coalesce(categoria, s.categoria) where id = p_company;
    update public.profiles set tipo = 'expositor', tier = 'expositor' where company_id = p_company;
    insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_expositor_auto', p_company, jsonb_build_object('stand', c.stand_declarado, 'email', p_email));
  end if;
end $$;

-- Pista para el panel: a quién pertenece el stand declarado según la lista
create or replace function public.admin_pista_stand(p_stand text)
returns text language sql stable security definer set search_path = public as $$
  select empresa || ' (' || array_to_string(correos, ', ') || ')' from public.stand_list where stand = public.normalizar_stand(p_stand) and public.is_admin();
$$;
revoke execute on function public.verificar_stand_automatico(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_pista_stand(text) from public, anon;
grant execute on function public.admin_pista_stand(text) to authenticated;

-- 26-sep · completar_registro llama a verificar_stand_automatico (lista oficial de stands)
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
  -- verificación automática contra la lista oficial de stands
  perform public.verificar_stand_automatico(v_company, v_email);
end $$;

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

-- 28-sep · Empresas expositoras SIN stand en la lista oficial (pedido de Lina): se aprueban solas
-- como Proveedor / servicio cuando se registran con "Empresa/servicio sin stand" y un correo autorizado.
alter table public.stand_list add column if not exists sin_stand boolean not null default false;

create or replace function public.verificar_stand_automatico(p_company uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.companies; s public.stand_list;
begin
  select * into c from public.companies where id = p_company;
  if c.id is null or c.tipo = 'expositor' or c.solicitud is null then return; end if;
  if c.solicitud = 'expositor_stand' and c.stand_declarado is not null then
    select * into s from public.stand_list where stand = public.normalizar_stand(c.stand_declarado) and not sin_stand;
    if s.stand is not null and public.correo_autorizado(p_email, s.correos) then
      update public.companies set tipo = 'expositor', stand = c.stand_declarado, solicitud = null,
        categoria = coalesce(categoria, s.categoria) where id = p_company;
      update public.profiles set tipo = 'expositor', tier = 'expositor' where company_id = p_company;
      insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_expositor_auto', p_company, jsonb_build_object('stand', c.stand_declarado, 'email', p_email));
    end if;
  elsif c.solicitud = 'expositor_sin_stand' then
    select * into s from public.stand_list where sin_stand and public.correo_autorizado(p_email, correos) limit 1;
    if s.stand is not null then
      update public.companies set tipo = 'expositor', stand = null, solicitud = null,
        categoria = coalesce(categoria, s.categoria) where id = p_company;
      update public.profiles set tipo = 'asistente', tier = 'vip' where company_id = p_company;
      insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_proveedor_auto', p_company, jsonb_build_object('email', p_email));
    end if;
  end if;
end $$;

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

-- 30-sep · Auditoría de seguridad: (A2) nadie con sesión normal puede disparar los correos masivos.
revoke execute on function public.disparar_correo_agenda(), public.disparar_correo_encuesta() from public, anon, authenticated;

-- 30-sep · "Les interesas" (pedido del equipo): personas que me dieron ♥ y a quienes yo aún no,
-- incluidas las que pasé con ✕ o que nunca vi. Sin contacto. Un ♥ mío crea el match al instante.
create or replace function public.les_intereso()
returns table (
  id uuid, nombre text, cargo text, ciudad text, bio text, foto_path text,
  tipo tipo_participante, categoria text, busca text[], ofrece text[],
  empresa text, stand text, proveedor boolean, yo_dije_no boolean, cuando timestamptz
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.ciudad, p.bio, p.foto_path, p.tipo, p.categoria, p.busca, p.ofrece,
         c.nombre, c.stand, (c.tipo = 'expositor' and c.stand is null),
         exists (select 1 from public.swipes x where x.from_user = auth.uid() and x.to_user = p.id and not x.liked),
         s.created_at
  from public.swipes s
  join public.profiles p on p.id = s.from_user
  left join public.companies c on c.id = p.company_id
  where s.to_user = auth.uid() and s.liked
    and p.activo and not p.invitado
    and not exists (select 1 from public.swipes mio where mio.from_user = auth.uid() and mio.to_user = p.id and mio.liked)
    and not exists (select 1 from public.matches m where m.user_a = least(auth.uid(), p.id) and m.user_b = greatest(auth.uid(), p.id))
  order by (p.tipo = 'expositor') desc, s.created_at desc;
$$;
revoke execute on function public.les_intereso() from public, anon;
grant execute on function public.les_intereso() to authenticated;

-- 30-sep · Correcciones de la auditoría de seguridad del 29-sep (segunda parte).

-- A3. Nadie crea empresas por tabla: solo completar_registro (security definer) y la organización.
drop policy if exists "crear empresa" on public.companies;

-- A1/M4. Registro pendiente: sin foto en el servidor, tope de 8 KB, válido 48 h (la app ya no lo aplica
-- sola: lo usa para prellenar y la persona confirma). Limpieza programada cada hora.
create or replace function public.guardar_registro_pendiente(p_email text, p_datos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_datos jsonb := (p_datos - 'foto') || '{"foto":null,"comercial":false}'::jsonb;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'correo no válido'; end if;
  if pg_column_size(v_datos) > 8000 then raise exception 'datos demasiado grandes'; end if;
  delete from public.pending_registrations where created_at < now() - interval '48 hours';
  if (select count(*) from public.pending_registrations) > 2000 then raise exception 'demasiados registros pendientes'; end if;
  insert into public.pending_registrations (email, datos) values (v_email, v_datos)
  on conflict (email) do update set datos = excluded.datos, created_at = now();
end $$;

create or replace function public.tomar_registro_pendiente()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; completo boolean;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  delete from public.pending_registrations where email = lower(auth.email()) returning
    case when created_at > now() - interval '48 hours' then datos end into v;
  select cardinality(busca) + cardinality(ofrece) > 0 into completo from public.profiles where id = auth.uid();
  if coalesce(completo, false) then return null; end if;
  return v;
end $$;
select cron.unschedule(jobid) from cron.job where jobname = 'limpiar-pendientes';
select cron.schedule('limpiar-pendientes', '15 * * * *', $$delete from public.pending_registrations where created_at < now() - interval '48 hours'$$);

-- M3. Fotos: solo se ven las de perfiles visibles (o la propia, o admin)
drop policy if exists "ver fotos" on storage.objects;
create policy "ver fotos" on storage.objects for select to authenticated using (
  bucket_id = 'fotos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
    or exists (select 1 from public.profiles p where p.id::text = (storage.foldername(name))[1] and p.activo and not p.invitado)));

-- M5. Tope de reservas por match (evita el bucle reservar/cancelar como acoso por correo)
create or replace function public.reservar_reunion(p_match uuid, p_block int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m public.matches; me uuid := auth.uid(); prop record; mt_id uuid;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or (me <> m.user_a and me <> m.user_b) then raise exception 'match no encontrado'; end if;
  if (select count(*) from public.meetings where match_id = p_match and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Ya cambiaron esta reunión varias veces hoy. Si necesitan otro horario, pidan ayuda a la organización.';
  end if;
  select * into prop from public.propuestas(p_match) where block_id = p_block;
  if prop.block_id is null then raise exception 'Ese horario ya no está disponible'; end if;

  insert into public.meetings (match_id, block_id, lugar, mesa, stand)
  values (p_match, p_block, prop.lugar, prop.mesa, prop.stand)
  returning id into mt_id;
  insert into public.meeting_participants (meeting_id, user_id, block_id)
  values (mt_id, m.user_a, p_block), (mt_id, m.user_b, p_block);
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (me, 'reservar', mt_id, jsonb_build_object('block', p_block));
  return mt_id;
exception when unique_violation then
  raise exception 'Ese horario acaba de ocuparse. Elige otro.';
end $$;

-- M6. La encuesta solo se escribe desde el correo (función de servicio); la persona solo lee la suya
drop policy if exists "mi encuesta" on public.surveys;
create policy "leer mi encuesta" on public.surveys for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- B10. Perfiles por tabla: no se listan invitados que aún no entran
drop policy if exists "leer perfiles" on public.profiles;
create policy "leer perfiles" on public.profiles for select to authenticated
  using ((activo and not invitado) or id = auth.uid() or public.is_admin());

-- B2. La auditoría no guarda correos
update public.audit_events set detalle = detalle - 'email' where detalle ? 'email';

-- B2. verificar_stand_automatico sin correo en la auditoría
create or replace function public.verificar_stand_automatico(p_company uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.companies; s public.stand_list;
begin
  select * into c from public.companies where id = p_company;
  if c.id is null or c.tipo = 'expositor' or c.solicitud is null then return; end if;
  if c.solicitud = 'expositor_stand' and c.stand_declarado is not null then
    select * into s from public.stand_list where stand = public.normalizar_stand(c.stand_declarado) and not sin_stand;
    if s.stand is not null and public.correo_autorizado(p_email, s.correos) then
      update public.companies set tipo = 'expositor', stand = c.stand_declarado, solicitud = null,
        categoria = coalesce(categoria, s.categoria) where id = p_company;
      update public.profiles set tipo = 'expositor', tier = 'expositor' where company_id = p_company;
      insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_expositor_auto', p_company, jsonb_build_object('stand', c.stand_declarado));
    end if;
  elsif c.solicitud = 'expositor_sin_stand' then
    select * into s from public.stand_list where sin_stand and public.correo_autorizado(p_email, correos) limit 1;
    if s.stand is not null then
      update public.companies set tipo = 'expositor', stand = null, solicitud = null,
        categoria = coalesce(categoria, s.categoria) where id = p_company;
      update public.profiles set tipo = 'asistente', tier = 'vip' where company_id = p_company;
      insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_proveedor_auto', p_company, '{}'::jsonb);
    end if;
  end if;
end $$;


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


-- 23 · 1-oct · "Sacar de la app" a una persona desde el panel (pedido de Lina) y volver a admitirla.
-- Antes "Ocultar de la app" solo escondía el perfil: la persona seguía entrando y viendo perfiles.
-- Ahora sacar a alguien hace todo de una vez:
--   1. cancela sus reuniones confirmadas (devuelve sus ids para que la app avise por correo a la otra persona),
--   2. oculta su perfil (activo = false: no aparece en Perfiles, ni en matches, ni en "Les interesas"),
--   3. bloquea su acceso (auth.users.banned_until) y cierra sus sesiones abiertas.
-- Volver a admitir deshace 2 y 3 (las reuniones canceladas no se recuperan: se vuelven a agendar).
create or replace function public.admin_sacar(p_user uuid, p_sacar boolean)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare canceladas uuid[] := '{}';
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  if p_user = auth.uid() then raise exception 'No puedes sacarte a ti de la app.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Esa persona ya no existe.'; end if;
  if p_sacar and exists (select 1 from auth.users where id = p_user and raw_app_meta_data->>'role' = 'admin') then
    raise exception 'Esa persona es de la organización y no se puede sacar desde aquí.';
  end if;

  if p_sacar then
    with c as (
      update public.meetings mt set estado = 'cancelada', cancelada_por = auth.uid()
       where mt.estado = 'confirmada'
         and mt.id in (select mp.meeting_id from public.meeting_participants mp where mp.user_id = p_user)
      returning mt.id
    )
    select coalesce(array_agg(c.id), '{}') into canceladas from c;
    delete from public.meeting_participants where meeting_id = any(canceladas);
    delete from public.waitlist where user_id = p_user;
    update public.profiles set activo = false where id = p_user;
    update auth.users set banned_until = '2100-01-01 00:00:00+00' where id = p_user;
    delete from auth.sessions where user_id = p_user;
  else
    update public.profiles set activo = true where id = p_user;
    update auth.users set banned_until = null where id = p_user;
  end if;

  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (auth.uid(), case when p_sacar then 'sacar_de_la_app' else 'volver_a_admitir' end, p_user,
          jsonb_build_object('reuniones_canceladas', coalesce(array_length(canceladas, 1), 0)));
  return canceladas;
end $$;
revoke execute on function public.admin_sacar(uuid, boolean) from public, anon;
grant execute on function public.admin_sacar(uuid, boolean) to authenticated;

-- El panel necesita saber si la persona ya entró alguna vez (para distinguir "invitado que no ha abierto
-- el correo" de "entró pero no terminó el perfil") y si está sacada de la app.
drop function if exists public.admin_participantes();
create or replace function public.admin_participantes()
returns table (
  id uuid, nombre text, cargo text, ciudad text, email text, telefono text,
  tipo tipo_participante, tier tier_participante, categoria text, activo boolean, invitado boolean,
  company_id uuid, empresa text, empresa_tipo tipo_participante, stand text, solicitud text, stand_declarado text,
  busca text[], ofrece text[], franjas text[], foto_path text, created_at timestamptz,
  matches int, reuniones int, entro boolean, sacado boolean, es_admin boolean
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.ciudad, pp.email, pp.telefono,
         p.tipo, p.tier, p.categoria, p.activo, p.invitado,
         c.id, c.nombre, c.tipo, c.stand, c.solicitud, c.stand_declarado,
         p.busca, p.ofrece, p.franjas, p.foto_path, p.created_at,
         (select count(*)::int from public.matches m where p.id in (m.user_a, m.user_b)),
         (select count(*)::int from public.meeting_participants mp join public.meetings mt on mt.id = mp.meeting_id
           where mp.user_id = p.id and mt.estado = 'confirmada'),
         u.last_sign_in_at is not null,
         coalesce(u.banned_until > now(), false),
         coalesce(u.raw_app_meta_data->>'role' = 'admin', false)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profiles_private pp on pp.user_id = p.id
  left join public.companies c on c.id = p.company_id
  where public.is_admin()
  order by p.created_at desc;
$$;
revoke execute on function public.admin_participantes() from public, anon;
grant execute on function public.admin_participantes() to authenticated;

notify pgrst, 'reload schema';


-- 24 · 1-oct · Correo de seguimiento a quien dejó su registro a la mitad (pedido de Lina).
-- Un solo recordatorio por persona, entre 45 y 60 minutos después de que empezó y no terminó su perfil.
-- Lo envía la Edge Function `correo-recordatorio`, disparada por pg_cron cada 15 minutos.

-- cuándo se le envió el recordatorio (null = no se le ha enviado)
alter table public.profiles add column if not exists recordatorio_at timestamptz;

-- A quién le toca: perfil sin completar, que empezó (pidió su código o entró) hace más de p_min_minutos
-- y menos de p_max_horas, que no esté fuera de la app y que no haya recibido ya el recordatorio.
-- No incluye a los expositores invitados que aún no han abierto su invitación (para ellos está "Reenviar invitación").
create or replace function public.pendientes_de_recordatorio(p_min_minutos int default 45, p_max_horas int default 48)
returns table (user_id uuid, email text, expositor boolean, tiene_borrador boolean, empezo timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, lower(u.email), coalesce(c.tipo = 'expositor', false),
         exists (select 1 from public.pending_registrations pr where pr.email = lower(u.email)),
         greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at))
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.companies c on c.id = p.company_id
  where cardinality(p.busca) + cardinality(p.ofrece) = 0
    and p.activo
    and p.recordatorio_at is null
    and not (p.invitado and u.last_sign_in_at is null)
    and coalesce(u.banned_until, '-infinity'::timestamptz) < now()
    and u.email !~* '@(example\.com|expohost\.invalid)$'
    and greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at))
        between now() - make_interval(hours => p_max_horas) and now() - make_interval(mins => p_min_minutos)
  order by 5;
$$;
revoke execute on function public.pendientes_de_recordatorio(int, int) from public, anon, authenticated;

-- disparo por pg_cron (misma mecánica que el correo de agenda: URL y secreto en la tabla `secretos`)
create or replace function public.disparar_correo_recordatorio()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  -- después de la feria ya no se envían recordatorios
  if now() > '2026-10-07 18:00:00-05'::timestamptz then return; end if;
  select value->>0 into v_url from public.secretos where key = 'url_correo_recordatorio';
  select value->>0 into v_secret from public.secretos where key = 'cron_secret';
  if v_url is null or v_secret is null then raise notice 'correo-recordatorio sin configurar'; return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), body := '{}'::jsonb);
end $$;
revoke execute on function public.disparar_correo_recordatorio() from public, anon, authenticated;
insert into public.secretos (key, value) values ('url_correo_recordatorio', to_jsonb('https://ujfhvhoutlqphbpwrgfq.supabase.co/functions/v1/correo-recordatorio'::text))
on conflict (key) do update set value = excluded.value;

-- El panel muestra si a la persona ya se le envió el recordatorio
drop function if exists public.admin_participantes();
create or replace function public.admin_participantes()
returns table (
  id uuid, nombre text, cargo text, ciudad text, email text, telefono text,
  tipo tipo_participante, tier tier_participante, categoria text, activo boolean, invitado boolean,
  company_id uuid, empresa text, empresa_tipo tipo_participante, stand text, solicitud text, stand_declarado text,
  busca text[], ofrece text[], franjas text[], foto_path text, created_at timestamptz,
  matches int, reuniones int, entro boolean, sacado boolean, es_admin boolean, recordatorio_at timestamptz
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.ciudad, pp.email, pp.telefono,
         p.tipo, p.tier, p.categoria, p.activo, p.invitado,
         c.id, c.nombre, c.tipo, c.stand, c.solicitud, c.stand_declarado,
         p.busca, p.ofrece, p.franjas, p.foto_path, p.created_at,
         (select count(*)::int from public.matches m where p.id in (m.user_a, m.user_b)),
         (select count(*)::int from public.meeting_participants mp join public.meetings mt on mt.id = mp.meeting_id
           where mp.user_id = p.id and mt.estado = 'confirmada'),
         u.last_sign_in_at is not null,
         coalesce(u.banned_until > now(), false),
         coalesce(u.raw_app_meta_data->>'role' = 'admin', false),
         p.recordatorio_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profiles_private pp on pp.user_id = p.id
  left join public.companies c on c.id = p.company_id
  where public.is_admin()
  order by p.created_at desc;
$$;
revoke execute on function public.admin_participantes() from public, anon;
grant execute on function public.admin_participantes() to authenticated;

notify pgrst, 'reload schema';

-- cada 15 minutos (la función no envía de noche ni después de la feria)
select cron.schedule('recordatorio-registro', '*/15 * * * *', $$select public.disparar_correo_recordatorio()$$);


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
