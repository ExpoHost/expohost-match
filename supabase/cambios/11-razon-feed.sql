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
