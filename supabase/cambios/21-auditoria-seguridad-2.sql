-- 30-sep · Correcciones de la auditoría de seguridad del 29-sep (segunda parte).

-- A3. Nadie crea empresas por tabla: solo completar_registro (security definer) y la organización.
drop policy if exists "crear empresa" on public.companies;

-- A1/M4. Registro pendiente: sin foto en el servidor, tope de 8 KB, válido 48 h (la app ya no lo aplica
-- sola: lo usa para prellenar y la persona confirma). Limpieza programada cada hora.
create or replace function public.guardar_registro_pendiente(p_email text, p_datos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_datos jsonb := (p_datos - 'foto') || '{"foto":null,"comercial":false}'::jsonb;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'correo no válido'; end if;
  if pg_column_size(v_datos) > 8000 then raise exception 'datos demasiado grandes'; end if;
  delete from public.pending_registrations where created_at < now() - interval '48 hours';
  if (select count(*) from public.pending_registrations) > 2000 then raise exception 'demasiados registros pendientes'; end if;
  insert into public.pending_registrations (email, datos) values (v_email, v_datos)
  on conflict (email) do update set datos = excluded.datos, created_at = now();
end $$;

create or replace function public.tomar_registro_pendiente()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; completo boolean;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  delete from public.pending_registrations where email = lower(auth.email()) returning
    case when created_at > now() - interval '48 hours' then datos end into v;
  select cardinality(busca) + cardinality(ofrece) > 0 into completo from public.profiles where id = auth.uid();
  if coalesce(completo, false) then return null; end if;
  return v;
end $$;
select cron.unschedule(jobid) from cron.job where jobname = 'limpiar-pendientes';
select cron.schedule('limpiar-pendientes', '15 * * * *', $$delete from public.pending_registrations where created_at < now() - interval '48 hours'$$);

-- M3. Fotos: solo se ven las de perfiles visibles (o la propia, o admin)
drop policy if exists "ver fotos" on storage.objects;
create policy "ver fotos" on storage.objects for select to authenticated using (
  bucket_id = 'fotos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
    or exists (select 1 from public.profiles p where p.id::text = (storage.foldername(name))[1] and p.activo and not p.invitado)));

-- M5. Tope de reservas por match (evita el bucle reservar/cancelar como acoso por correo)
create or replace function public.reservar_reunion(p_match uuid, p_block int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m public.matches; me uuid := auth.uid(); prop record; mt_id uuid;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or (me <> m.user_a and me <> m.user_b) then raise exception 'match no encontrado'; end if;
  if (select count(*) from public.meetings where match_id = p_match and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Ya cambiaron esta reunión varias veces hoy. Si necesitan otro horario, pidan ayuda a la organización.';
  end if;
  select * into prop from public.propuestas(p_match) where block_id = p_block;
  if prop.block_id is null then raise exception 'Ese horario ya no está disponible'; end if;

  insert into public.meetings (match_id, block_id, lugar, mesa, stand)
  values (p_match, p_block, prop.lugar, prop.mesa, prop.stand)
  returning id into mt_id;
  insert into public.meeting_participants (meeting_id, user_id, block_id)
  values (mt_id, m.user_a, p_block), (mt_id, m.user_b, p_block);
  insert into public.audit_events (actor_id, accion, objetivo, detalle)
  values (me, 'reservar', mt_id, jsonb_build_object('block', p_block));
  return mt_id;
exception when unique_violation then
  raise exception 'Ese horario acaba de ocuparse. Elige otro.';
end $$;

-- M6. La encuesta solo se escribe desde el correo (función de servicio); la persona solo lee la suya
drop policy if exists "mi encuesta" on public.surveys;
create policy "leer mi encuesta" on public.surveys for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- B10. Perfiles por tabla: no se listan invitados que aún no entran
drop policy if exists "leer perfiles" on public.profiles;
create policy "leer perfiles" on public.profiles for select to authenticated
  using ((activo and not invitado) or id = auth.uid() or public.is_admin());

-- B2. La auditoría no guarda correos
update public.audit_events set detalle = detalle - 'email' where detalle ? 'email';

-- B2. verificar_stand_automatico sin correo en la auditoría
create or replace function public.verificar_stand_automatico(p_company uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.companies; s public.stand_list;
begin
  select * into c from public.companies where id = p_company;
  if c.id is null or c.tipo = 'expositor' or c.solicitud is null then return; end if;
  if c.solicitud = 'expositor_stand' and c.stand_declarado is not null then
    select * into s from public.stand_list where stand = public.normalizar_stand(c.stand_declarado) and not sin_stand;
    if s.stand is not null and public.correo_autorizado(p_email, s.correos) then
      update public.companies set tipo = 'expositor', stand = c.stand_declarado, solicitud = null,
        categoria = coalesce(categoria, s.categoria) where id = p_company;
      update public.profiles set tipo = 'expositor', tier = 'expositor' where company_id = p_company;
      insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_expositor_auto', p_company, jsonb_build_object('stand', c.stand_declarado));
    end if;
  elsif c.solicitud = 'expositor_sin_stand' then
    select * into s from public.stand_list where sin_stand and public.correo_autorizado(p_email, correos) limit 1;
    if s.stand is not null then
      update public.companies set tipo = 'expositor', stand = null, solicitud = null,
        categoria = coalesce(categoria, s.categoria) where id = p_company;
      update public.profiles set tipo = 'asistente', tier = 'vip' where company_id = p_company;
      insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_proveedor_auto', p_company, '{}'::jsonb);
    end if;
  end if;
end $$;
