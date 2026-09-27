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
