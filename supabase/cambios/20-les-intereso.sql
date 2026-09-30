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
