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
