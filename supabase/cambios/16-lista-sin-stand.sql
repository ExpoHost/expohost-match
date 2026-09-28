-- 28-sep · Empresas expositoras SIN stand en la lista oficial (pedido de Lina): se aprueban solas
-- como Proveedor / servicio cuando se registran con "Empresa/servicio sin stand" y un correo autorizado.
alter table public.stand_list add column if not exists sin_stand boolean not null default false;

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
      insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_expositor_auto', p_company, jsonb_build_object('stand', c.stand_declarado, 'email', p_email));
    end if;
  elsif c.solicitud = 'expositor_sin_stand' then
    select * into s from public.stand_list where sin_stand and public.correo_autorizado(p_email, correos) limit 1;
    if s.stand is not null then
      update public.companies set tipo = 'expositor', stand = null, solicitud = null,
        categoria = coalesce(categoria, s.categoria) where id = p_company;
      update public.profiles set tipo = 'asistente', tier = 'vip' where company_id = p_company;
      insert into public.audit_events (accion, objetivo, detalle) values ('aprobar_proveedor_auto', p_company, jsonb_build_object('email', p_email));
    end if;
  end if;
end $$;
