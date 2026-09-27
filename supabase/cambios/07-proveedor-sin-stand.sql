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
