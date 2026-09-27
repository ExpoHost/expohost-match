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
