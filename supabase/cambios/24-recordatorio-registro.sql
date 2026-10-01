-- 24 · 1-oct · Correo de seguimiento a quien dejó su registro a la mitad (pedido de Lina).
-- Un solo recordatorio por persona, entre 45 y 60 minutos después de que empezó y no terminó su perfil.
-- Lo envía la Edge Function `correo-recordatorio`, disparada por pg_cron cada 15 minutos.

-- cuándo se le envió el recordatorio (null = no se le ha enviado)
alter table public.profiles add column if not exists recordatorio_at timestamptz;

-- A quién le toca: perfil sin completar, que empezó (pidió su código o entró) hace más de p_min_minutos
-- y menos de p_max_horas, que no esté fuera de la app y que no haya recibido ya el recordatorio.
-- No incluye a los expositores invitados que aún no han abierto su invitación (para ellos está "Reenviar invitación").
create or replace function public.pendientes_de_recordatorio(p_min_minutos int default 45, p_max_horas int default 48)
returns table (user_id uuid, email text, expositor boolean, tiene_borrador boolean, empezo timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, lower(u.email), coalesce(c.tipo = 'expositor', false),
         exists (select 1 from public.pending_registrations pr where pr.email = lower(u.email)),
         greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at))
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.companies c on c.id = p.company_id
  where cardinality(p.busca) + cardinality(p.ofrece) = 0
    and p.activo
    and p.recordatorio_at is null
    and not (p.invitado and u.last_sign_in_at is null)
    and coalesce(u.banned_until, '-infinity'::timestamptz) < now()
    and u.email !~* '@(example\.com|expohost\.invalid)$'
    and greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at))
        between now() - make_interval(hours => p_max_horas) and now() - make_interval(mins => p_min_minutos)
  order by 5;
$$;
revoke execute on function public.pendientes_de_recordatorio(int, int) from public, anon, authenticated;

-- disparo por pg_cron (misma mecánica que el correo de agenda: URL y secreto en la tabla `secretos`)
create or replace function public.disparar_correo_recordatorio()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  -- después de la feria ya no se envían recordatorios
  if now() > '2026-10-07 18:00:00-05'::timestamptz then return; end if;
  select value->>0 into v_url from public.secretos where key = 'url_correo_recordatorio';
  select value->>0 into v_secret from public.secretos where key = 'cron_secret';
  if v_url is null or v_secret is null then raise notice 'correo-recordatorio sin configurar'; return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), body := '{}'::jsonb);
end $$;
revoke execute on function public.disparar_correo_recordatorio() from public, anon, authenticated;
insert into public.secretos (key, value) values ('url_correo_recordatorio', to_jsonb('https://ujfhvhoutlqphbpwrgfq.supabase.co/functions/v1/correo-recordatorio'::text))
on conflict (key) do update set value = excluded.value;

-- El panel muestra si a la persona ya se le envió el recordatorio
drop function if exists public.admin_participantes();
create or replace function public.admin_participantes()
returns table (
  id uuid, nombre text, cargo text, ciudad text, email text, telefono text,
  tipo tipo_participante, tier tier_participante, categoria text, activo boolean, invitado boolean,
  company_id uuid, empresa text, empresa_tipo tipo_participante, stand text, solicitud text, stand_declarado text,
  busca text[], ofrece text[], franjas text[], foto_path text, created_at timestamptz,
  matches int, reuniones int, entro boolean, sacado boolean, es_admin boolean, recordatorio_at timestamptz
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.ciudad, pp.email, pp.telefono,
         p.tipo, p.tier, p.categoria, p.activo, p.invitado,
         c.id, c.nombre, c.tipo, c.stand, c.solicitud, c.stand_declarado,
         p.busca, p.ofrece, p.franjas, p.foto_path, p.created_at,
         (select count(*)::int from public.matches m where p.id in (m.user_a, m.user_b)),
         (select count(*)::int from public.meeting_participants mp join public.meetings mt on mt.id = mp.meeting_id
           where mp.user_id = p.id and mt.estado = 'confirmada'),
         u.last_sign_in_at is not null,
         coalesce(u.banned_until > now(), false),
         coalesce(u.raw_app_meta_data->>'role' = 'admin', false),
         p.recordatorio_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profiles_private pp on pp.user_id = p.id
  left join public.companies c on c.id = p.company_id
  where public.is_admin()
  order by p.created_at desc;
$$;
revoke execute on function public.admin_participantes() from public, anon;
grant execute on function public.admin_participantes() to authenticated;

notify pgrst, 'reload schema';

-- cada 15 minutos (la función no envía de noche ni después de la feria)
select cron.schedule('recordatorio-registro', '*/15 * * * *', $$select public.disparar_correo_recordatorio()$$);
