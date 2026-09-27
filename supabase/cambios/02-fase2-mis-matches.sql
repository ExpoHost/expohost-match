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
