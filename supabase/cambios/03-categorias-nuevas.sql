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
