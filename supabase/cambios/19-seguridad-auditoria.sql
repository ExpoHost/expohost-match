-- 30-sep · Auditoría de seguridad: (A2) nadie con sesión normal puede disparar los correos masivos.
revoke execute on function public.disparar_correo_agenda(), public.disparar_correo_encuesta() from public, anon, authenticated;
