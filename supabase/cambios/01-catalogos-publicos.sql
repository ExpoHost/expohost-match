-- 26-sep: etiquetas y categorías legibles sin sesión (el registro las muestra antes de confirmar el correo)
alter policy "leer catalogos" on public.tags to anon, authenticated;
alter policy "leer categorias" on public.categories to anon, authenticated;
