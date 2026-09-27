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
