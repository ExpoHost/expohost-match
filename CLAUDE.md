# Expohost Match — contexto del proyecto

Lee este archivo completo antes de escribir código. Es la fuente de verdad del proyecto y cualquier computador o sesión retoma desde aquí. Actualiza la sección "Estado" al cerrar cada fase y haz commit.

## Qué es

Web app tipo "app de citas para negocios" para ExpoHost Bogotá 2026 (martes 6 y miércoles 7 de octubre, Gimnasio Moderno, Bogotá). Su propósito: que los expositores consigan reuniones uno a uno de calidad con asistentes, con una experiencia moderna y simple, no una rueda de negocios tradicional.

Dueña del producto: Lina María Roa, cofundadora de ExpoHost. Idioma de trabajo y de la interfaz: español (Colombia).

## Escala y filosofía

- Usuarios esperados: entre 30 y 50 expositores (de los ~120 que participan en la feria, solo cuentan los que se inscriban en Match) y entre 50 y 150 asistentes. Diseñar para 200 usuarios como máximo. No cargar expositores masivamente: se invita a todos, se crea perfil solo a los que aceptan.
- Nada de optimizaciones prematuras: sin colas, cachés, Realtime, PWA offline, pruebas de carga, límites por IP ni "por si llegan miles".
- Simplicidad ante todo. Entre dos opciones, la más sencilla de construir y de usar.
- Costo: GitHub Pages y Supabase Free (gratis) + Resend Pro (USD 20/mes, 50.000 correos/mes, sin tope diario; contratado por Lina el 29-sep, renueva el 29-oct, cancelable en resend.com → Settings → Billing). Antes era Resend Free con 100 correos/día.
- Solo correo como canal. Sin WhatsApp Business API, SMS ni push. Único WhatsApp: botón con enlace wa.me tras un match aceptado.

## Fechas fijas

- Hoy (inicio): jueves 24 de septiembre de 2026.
- Prueba interna del flujo completo: sábado 26 de septiembre en la noche (Lina + 2 personas, desde celulares).
- Carga de expositores: miércoles 30 de septiembre.
- Invitaciones a expositores: jueves 1 (hasta 90) y viernes 2 de octubre (resto). Nunca más de 100 correos por día.
- Congelamiento de código: sábado 3 de octubre, 6 p.m.
- Correo de agenda del día siguiente: 5 y 6 de octubre a las 7 p.m.
- Feria: 6 y 7 de octubre. Encuesta T+1: 8 de octubre.

## Reglas de negocio

- Bloques de reunión: 30 minutos (25 de reunión + 5 de cambio). Horario 10:00–13:00 y 14:00–18:00 los dos días → 14 bloques por día, 28 en total. Desde el panel se pueden bloquear bloques concretos.
- Lugares: (a) stand del expositor, sin tope, lugar por defecto para reuniones con expositor; (b) Zona Match: **8 mesas** (decisión de Lina del 29-sep; antes 10) numeradas de 4 puestos, una reunión por mesa por bloque, para reuniones entre asistentes o cuando el expositor marca "prefiero Zona Match". El número de mesas se edita en el panel.
- Tipos de participante: `asistente` y `expositor`. Un expositor tiene número de stand y hasta 3 representantes (personas) bajo la misma empresa.
- Tier (prioridad en feed y en mesa): `expositor`, `vip`, `diamante`, `general`. Por defecto `general`; se edita desde el panel.
- Feed: ordenado por compatibilidad; para asistentes, expositores primero. Tope de 30 ♥ por día para asistentes y 200 para expositores.
- Compatibilidad: score(A→B) = 0,4·Jaccard(A.busca, B.ofrece) + 0,3·Jaccard(B.busca, A.ofrece) + 0,15·[categorías complementarias] + 0,15·[alguna franja en común]; penaliza misma empresa. Orden por media geométrica de ambos sentidos. Se calcula en el momento (RPC); con 300 personas es instantáneo.
- Match mutuo → propuesta de los 3 primeros bloques donde ambos están libres y hay lugar → un toque confirma → correo a ambos con lugar, hora y .ics. Cancelar libera y avisa por correo.
- Integridad: un usuario no puede tener dos reuniones en el mismo bloque; una mesa no puede tener dos reuniones en el mismo bloque. Se garantiza en la base (UNIQUE) y en la RPC `reservar_reunion`.
- Correo de agenda del día siguiente con botón "Confirmo". Quien no confirma no pierde la reunión automáticamente en v1 (la persona del match desk decide).
- Check-in: la persona del match desk marca "asistió" / "no vino" en el panel. Sin QR.

## Canales de correo (Resend)

1. Acceso: enlace mágico + código de 6 dígitos (plantilla de Supabase Auth con `{{ .Token }}` y `{{ .ConfirmationURL }}`).
2. Confirmación de reunión (a ambos) con .ics adjunto.
3. Cancelación de reunión.
4. Invitación a expositor cargado por CSV.
5. Agenda del día siguiente (7 p.m.) con botón "Confirmo".
6. T+1: encuesta de una pregunta ("¿La reunión fue útil?").

Remitente: match@match.expohost.travel (cuando Resend esté conectado). Tono: ejecutivo, claro, cálido, sin urgencia fabricada, sin emojis, un solo CTA por correo.

## Datos personales (Ley 1581 de 2012, Colombia)

- Responsable: Expohost SAS, NIT 901702368-6. Correo de contacto para datos: management@expohost.travel. Política de Tratamiento de Datos de ExpoHost: https://www.expohost.travel/tratamientodedatos.
- En el paso 1 del registro: aviso de privacidad con enlace a la política y checkbox obligatorio, no premarcado, con este texto: "Autorizo de manera previa, expresa e informada a Expohost SAS (NIT 901702368-6) como Responsable del Tratamiento para recolectar, almacenar y usar mis datos personales (nombre, empresa, cargo, correo, teléfono, foto e intereses comerciales) con el fin de gestionar mi participación en ExpoHost Bogotá 2026 y Expohost Match, mostrar mi perfil profesional a otros participantes registrados, compartir mi correo y teléfono únicamente con los participantes con quienes yo acepte un match y enviarme confirmaciones y recordatorios de mis reuniones por correo. Puedo conocer, actualizar, rectificar y suprimir mis datos y revocar esta autorización escribiendo a management@expohost.travel, conforme a la Ley 1581 de 2012 y a la Política de Tratamiento de Datos de ExpoHost."
- Segundo checkbox opcional: "Acepto recibir información comercial de ExpoHost y sus patrocinadores por correo. Puedo cancelar en cualquier momento."
- Se guarda en `consents`: versión del texto, hash, fecha, IP, user agent.
- Botón "Eliminar mi cuenta" que anonimiza (RPC `eliminar_mi_cuenta`).

## Seguridad (obligatoria aunque la app sea pequeña)

- RLS activo en todas las tablas (ya en `supabase/schema.sql`). Contactos (`profiles_private`) solo legibles por el dueño, por admin, o por la otra parte de un match aceptado.
- El frontend usa únicamente la clave publishable. La clave secret solo en secretos de Edge Functions (`supabase secrets set`). Nada de secretos en el repositorio (es público): `.env` en .gitignore y la publishable key como variable del workflow de GitHub Actions o directamente en el código (es pública).
- El feed sale de la RPC `feed` y nunca incluye correo ni teléfono.
- Reservas solo por la RPC `reservar_reunion`; cancelaciones por `cancelar_reunion`.
- Rol admin en `app_metadata.role = 'admin'` (nunca en `user_metadata`).
- Zod en todos los formularios. Sin HTML en textos libres; longitud máxima 280 caracteres en bio. Sin captcha en v1 (escala pequeña, acceso solo por correo).
- `audit_events` registra quién vio el contacto de quién.
- Respaldo: el panel exporta CSV; además un script `npm run backup` que hace `pg_dump` a `backups/` (ignorado por git).

## Stack (no negociable, elegido por simplicidad: solo tres cuentas)

- Cuentas: GitHub (código y publicación con GitHub Pages), Supabase (base de datos, acceso, funciones) y Resend (correos, se conecta el lunes 28). Nada más: sin Cloudflare, sin Turnstile, sin Sentry, sin Vercel.
- Frontend: Vite + React 18 + TypeScript + Tailwind + react-router (HashRouter, para que GitHub Pages no necesite reglas de redirección). Publicado con GitHub Pages mediante GitHub Actions desde la rama `main`. El repositorio es PÚBLICO (GitHub Pages en repos privados exige plan de pago); por eso NUNCA puede haber una clave secreta ni un .env en el repositorio: solo la publishable key, que es pública por diseño.
- Backend: Supabase Free, región East US (North Virginia) us-east-1: Postgres + RLS + RPC, Auth por correo (enlace mágico y código de 6 dígitos), Edge Functions (correos transaccionales, .ics, agenda diaria), Storage para fotos (bucket privado, URLs firmadas, imágenes redimensionadas en el cliente a 512 px).
- Correo: hasta el domingo 27, el envío incluido de Supabase (2 por hora, solo para la prueba interna). Desde el lunes 28, Resend como SMTP de Supabase Auth (host smtp.resend.com, puerto 465, usuario `resend`, contraseña = API key) y desde Edge Functions para los correos transaccionales. Subir el límite en Authentication → Rate Limits a 100 por hora.
- Sin Realtime. La agenda se recarga al navegar y cada 30 segundos.
- Cabeceras: GitHub Pages no permite cabeceras personalizadas; usar `<meta http-equiv="Content-Security-Policy">` en index.html (self + dominio de Supabase + fonts.googleapis.com/gstatic). HTTPS lo impone GitHub Pages ("Enforce HTTPS").

## Identidad visual (usar exactamente)

- Fuente: Montserrat (400, 500, 600, 700, 800) desde Google Fonts.
- Colores: azul `#0049FE` (primario, botones), turquesa `#00D1D1`, rosa `#FF3772` (♥ y chips "Busco"), naranja `#FF8000`, tinta `#0D0D16`, tinta suave `#4A4B58`, fondo hueso `#F7F8FC`, blanco `#FFFFFF`, línea `#E4E6F0`.
- Botones tipo píldora (border-radius 999px). Tarjetas con radio 22px y sombra suave.
- Logotipo: tres arcos (azul, turquesa, rosa) + "EXPOHOST MATCH" (MATCH en azul). SVG:
  `<svg viewBox="0 0 88 52" fill="none"><path d="M4 50 C4 22, 24 10, 26 34 L26 50" stroke="#0049FE" stroke-width="9" stroke-linecap="round"/><path d="M30 50 C30 20, 50 8, 52 32 L52 50" stroke="#00D1D1" stroke-width="9" stroke-linecap="round"/><path d="M56 50 C56 18, 74 6, 84 14" stroke="#FF3772" stroke-width="9" stroke-linecap="round"/></svg>`
- Copy de la landing (cambiado por Lina el 26-sep): "Haz match antes de Expohost. Conecta en persona durante la feria." Subtítulo: "Cuéntanos qué buscas o qué ofreces y te ayudamos a encontrar personas afines para agendar reuniones el 6 y 7 de octubre en Bogotá."
- Logotipo (26-sep): se redibujó como la cinta continua de arcos inclinados con degradado azul → turquesa → rosa → naranja del logo real de ExpoHost (`src/components/Logo.tsx`); el SVG de abajo quedó como referencia antigua. Nota visible: "En la feria entra con tus datos móviles."
- Tono: ejecutivo, claro, cálido, sin urgencia fabricada, un solo CTA por pantalla, sin emojis.
- Mobile-first: todo usable con una mano en 375 px; pulsables ≥ 44 px; contraste WCAG AA; respetar `prefers-reduced-motion`. ✕ y ♥ siempre como botones grandes; el swipe es adicional; "Deshacer" para el último ✕.

## Etiquetas Busco / Ofrezco (iniciales, editables en el panel)

Propiedades para operar · Capital / inversión · Property management · Tecnología (PMS, channel manager, IA) · Revenue management · Automatización · Fotografía y video · Aseo y lencería · Mobiliario y decoración · Cerraduras y acceso · Seguros y legal · Marketing y canales de demanda · Proyectos y constructoras · Hotelería y nuevos modelos · Formación y consultoría · Institucional y gremios.

## Categorías de participante

Inversionistas y capital · Propietarios y anfitriones · Property managers · Constructoras y desarrolladores · Tecnología · Proveedores · Marketing y demanda · Hotelería · Hostales · Senior living · Coliving · Institucionales y gremios · Otro. (Hostales, Senior living, Coliving y Otro se agregaron el 26-sep a pedido de Lina; "Otro" no tiene afinidades.)

Categorías complementarias (para el score): Inversionistas ↔ Constructoras, Propietarios, Property managers · Propietarios ↔ Property managers, Tecnología, Proveedores · Property managers ↔ Tecnología, Proveedores, Marketing, Propietarios, Constructoras · Constructoras ↔ Inversionistas, Property managers · Tecnología ↔ Property managers, Hotelería, Propietarios · Proveedores ↔ Property managers, Hotelería, Propietarios · Marketing ↔ Property managers, Hotelería · Hotelería ↔ Tecnología, Proveedores, Marketing · Hostales ↔ Tecnología, Proveedores, Marketing, Inversionistas · Senior living ↔ Inversionistas, Constructoras, Proveedores, Tecnología · Coliving ↔ Inversionistas, Constructoras, Property managers, Tecnología, Proveedores, Marketing · Institucionales ↔ todas (menos Otro).

## Fases

- Fase 0: repo, estructura, aplicar schema.sql, plantilla de correo Magic Link con enlace y código, Site URL y Redirect URLs, despliegue en GitHub Pages.
- Fase 1: landing, registro en 3 pasos con consentimiento, acceso por correo, perfil.
- Fase 2: feed, ♥/✕/deshacer, match, propuesta de 3 bloques, "Mi agenda", correos de confirmación y cancelación con .ics. → Prueba interna del sábado 26.
- Fase 3: perfil de expositor (stand, 3 representantes), carga por CSV con invitación, panel de expositor (matches, agenda, notas, CSV).
- Fase 4: panel de organización (reuniones por lugar y bloque, asistió / no vino, reasignar, lista de espera, CSV, ajustes), correo de agenda del día siguiente con "Confirmo".
- Fase 5: textos legales, eliminar cuenta, meta CSP, prueba de intrusión con curl, script de respaldo, correo T+1, guía de despliegue y reversión.

Al cerrar cada fase: resumen de lo hecho, lo pendiente y las decisiones que necesita Lina; commit; esperar aprobación. No preguntar lo que ya está aquí. Si falta una decisión, elegir la más sencilla y avisar.

## Estado

- [x] Fase 0 (sáb 26: schema aplicado y 21 pruebas pasando; workflow de Pages listo)
- [x] Fase 1 (sáb 26: landing, registro en 3 pasos con consentimiento, acceso por código o botón, perfil y edición; probado en navegador)
- [x] Fase 2 (sáb 26: Descubrir con ♥/✕/deshacer y deslizar, match, 3 horarios, Mi agenda con contacto, WhatsApp, .ics y cancelar; Edge Function `correo-reunion` publicada, envía cuando exista RESEND_API_KEY)
- [ ] Prueba interna sábado 26 (Lina sola con management@expohost.travel; los demás cuando esté Resend)
- [~] Fase 3 (26-sep: representantes por empresa hasta 3 con invitación por correo en el perfil; carga de expositores por CSV con invitación desde el panel, Edge Function `invitar-expositores`, plantilla "Invite user" aplicada; pruebas en `supabase/pruebas-fase3.cjs`. Pendiente: panel de expositor con notas por lead y CSV de sus matches)
- [x] Fase 4 (26-sep: panel de organización en `/admin`: solicitudes, participantes, reuniones con asistencia, cancelar y **reasignar**, lista de espera, cargar expositores, lista de stands, ajustes; correo de agenda del día siguiente con "Confirmo", programado)
- [x] Fase 5 (26-sep: /privacidad, "Eliminar mi cuenta", meta CSP, `npm run intrusion` (31 ataques bloqueados), `npm run backup`, encuesta T+1 programada con respuesta desde el correo, guía de despliegue y reversión abajo). Pendiente de Lina: DNS de Resend y prueba con el equipo.
- [ ] Expositores cargados (mié 30)
- [ ] Invitaciones enviadas (jue 1 / vie 2)
- [ ] Congelado v1.0-feria (sáb 3)

## Decisiones tomadas durante la construcción

- 26-sep: el proyecto Supabase quedó en la región **us-east-2 (Ohio)**, no us-east-1. Sin impacto. Conexión directa a la base por el pooler `aws-0-us-east-2.pooler.supabase.com:5432`, usuario `postgres.ujfhvhoutlqphbpwrgfq`.
- 26-sep, ajustes al schema aprobados por Lina: (1) tipo, tier, empresa, activo e invitado del perfil solo los cambia el admin (trigger `proteger_perfil`); (2) se quitó la política "participante confirma" y se creó la RPC `confirmar_reunion`; (3) los usuarios solo crean empresas de asistente; quien quiere ser expositor lo pide en el registro como "expositor con stand" (debe escribir su número de stand, doble verificación) o "expositor sin stand", y el admin aprueba con `aprobar_expositor`; (4) el tope diario de ♥ cuenta días en hora de Bogotá; (5) el feed solo muestra perfiles con al menos una etiqueta Busco u Ofrezco; (6) nadie sin sesión ejecuta funciones. Además: RPC `completar_registro` (guarda perfil, empresa/solicitud y teléfono en un paso), `registrar_consentimiento` toma IP y user agent de las cabeceras, bucket privado `fotos`.
- Correo de acceso: botón "Entrar a Expohost Match" que lleva a `#/confirmar?th={{ .TokenHash }}&t=email` (o `t=invite` en la invitación): la app llama a verifyOtp solo cuando la persona toca el botón, así los escáneres de correo corporativo (Outlook Safe Links) no gastan el enlace; el código `{{ .Token }}` va debajo. Cambiado el 26-sep tras conectar Resend (antes usaba `{{ .ConfirmationURL }}`, flujo implicit, que sigue soportado en `src/main.tsx`). Plantillas en `supabase/plantillas/magic.html` ("Magic Link", personas con perfil) y `confirmacion.html` ("Confirm signup", personas nuevas); el logo del correo es `public/correo/arcos.png`. La app usa flujo `implicit` (sirve aunque el correo se abra en otro navegador) y `src/main.tsx` procesa el `#access_token=...` del regreso antes del HashRouter.
- Código de 6 dígitos (el proyecto venía con 8; se cambió por API el 26-sep).
- Sesión de 7 días: el plan Free no permite limitar sesiones ("Pro Plans and up"), así que la app cierra la sesión si pasaron 7 días desde `last_sign_in_at` (`src/lib/sesion.tsx`).
- Mientras no esté Resend, el correo de Supabase solo llega a miembros de la organización y máximo 2 por hora: la prueba del 26 la hace Lina sola con management@expohost.travel, con perfiles de demostración para poder hacer match.
- La publishable key y la URL de Supabase están directamente en `src/lib/supabase.ts` (son públicas); el workflow no necesita variables.
- Pruebas de la base: `node --env-file=.env.pruebas supabase/pruebas.cjs` (ver cabecera del archivo).
- Fase 2 (26-sep): RPC `mis_matches()` (matches y reunión activa de la persona, sin contacto) en `supabase/cambios/02-fase2-mis-matches.sql`. Correos de reunión: Edge Function `supabase/functions/correo-reunion` (verifica sesión y participación; con `RESEND_API_KEY` envía confirmación con .ics o cancelación a ambos; sin la key responde `enviado:false`). Se publica con `npx supabase@latest functions deploy correo-reunion --project-ref ujfhvhoutlqphbpwrgfq --no-verify-jwt` (variable `SUPABASE_ACCESS_TOKEN`). Secretos de la función: `RESEND_API_KEY`, opcional `RESEND_FROM` y `APP_URL`.
- Perfiles de demostración (ampliados el 29-sep, solo para pruebas): 13 usuarios `demo-1..13@example.com` que cubren todos los tipos (2 expositores con stand, 1 proveedor sin stand, asistentes de PM, inversionistas, constructora, hotelería, hostal, coliving, marketing, gremio) con franjas variadas; 10 dan ♥ automático a cada persona real que completa su registro (trigger temporal `demo_likes`) y 3 no (Felipe, Ricardo, Tomás). **Borrarlos antes de cargar expositores reales (30-sep)** con el script `demo.js borrar` de Claude Code (o borrar los usuarios en Authentication → Users y ejecutar `drop trigger demo_likes on profiles; drop function demo_likes();`).
- **Plantillas de correo (26-sep):** Supabase Free NO permite personalizar las plantillas de Auth mientras use su remitente por defecto ("Email template modification is not available for free tier projects using the default email provider"). Hasta conectar Resend como SMTP, el correo de acceso llega en inglés y solo con el enlace (sin código). Al conectar Resend: correr `plantillas.js` de Claude Code (Management API) o pegarlas a mano en Authentication → Emails → Templates.
- **Registro pendiente en el servidor (26-sep):** como el enlace del correo suele abrirse en otro navegador (Gmail en el celular), los datos del registro se guardan con `guardar_registro_pendiente(email, datos)` (RPC para anon) antes de enviar el correo, y al entrar la app los recupera con `tomar_registro_pendiente()` (los borra al usarlos; caducan a los 7 días). El borrador local (con foto) sigue como primera opción. Tabla `pending_registrations`, sin políticas RLS (solo RPC). Cambio en `supabase/cambios/04-registro-pendiente.sql`.
- **Admins (26-sep):** el trigger `marcar_admin` pone `app_metadata.role = 'admin'` al crearse un usuario con correo lm.roa@aheadhosting.com.co o management@expohost.travel (lista en `supabase/cambios/05-deshacer-match-y-admin.sql`; editar y reejecutar para agregar personas). El panel de organización es la Fase 4.
- **Deshacer (26-sep, pedido de Lina):** `deshacer_ultimo_swipe()` deshace también un ♥ (quita el match y cancela la reunión si la había; devuelve el id de la reunión cancelada para avisar por correo) y `deshacer_match(p_match)` hace lo mismo desde la pantalla del match. La otra persona conserva su ♥: un nuevo ♥ rehace el match. El deslizar exige más de la mitad del ancho de la tarjeta y movimiento horizontal, con aviso visual ("Suelta para ♥").
- **Expositor con stand vs. proveedor (26-sep, decisión de Lina):** solo la empresa aprobada CON stand es "Expositor" (etiqueta naranja con número de stand, perfil tipo `expositor`, tier `expositor`, primera en el feed). La aprobada SIN stand es "Proveedor / servicio" (etiqueta turquesa; perfil tipo `asistente`, tier `vip`; empresa tipo `expositor` con `stand` null; reuniones en Zona Match). `aprobar_expositor(company, stand)` aplica la regla; el feed devuelve `proveedor boolean`. Cambio en `supabase/cambios/07-proveedor-sin-stand.sql`.
- **Revisión de código del 26-sep** (agente revisor, 20 hallazgos) y lo corregido en `supabase/cambios/06-revision-seguridad.sql` y el cliente: registro pendiente solo se aplica a perfiles incompletos, caduca en 2 h, se valida con Zod y tiene topes; `propuestas` no ofrece bloques ya pasados (margen 10 min, hora Bogotá); correos de reunión una sola vez por tipo (`meetings.correo_confirmacion_at` / `correo_cancelacion_at`); `profiles_private` solo permite editar teléfono y aceptación comercial; `foto_path` solo en carpeta propia; topes en arrays y nombre de empresa; `handle_new_user` nunca falla por el nombre; feed ordena por tier y la razón no promete afinidad inexistente; error de red al cargar perfil ya no manda al formulario; sesión 14 días y nunca se expulsa del 5 al 8 de octubre; `signOut` solo local; enlace a Google Calendar además del .ics; botón de cancelar no se duplica; "atrás" del celular retrocede de paso en el registro (`?paso=`) y el borrador se guarda en cada paso; pulsables ≥ 44 px. **Pendiente hasta tener Resend:** enlace del correo con `{{ .TokenHash }}` a una pantalla con botón (los escáneres de Outlook consumen el enlace directo) y priorizar el código. **Operativo:** con Resend Pro (29-sep) ya no hay tope diario: las 58 invitaciones pueden salir el jueves 1.
- **Carga de expositores (26-sep):** pestaña "Cargar expositores" del panel: filas `empresa;stand;nombre;correo;categoría` → Edge Function `invitar-expositores` (solo admin): crea/reutiliza la empresa expositora, invita al correo con `auth.admin.inviteUserByEmail` (plantilla "Invite user" de Supabase = `supabase/plantillas/invitacion.html`, sale por Resend) o solo crea sin correo, y deja el perfil `invitado = true` (invisible) con empresa, tipo y tier. Al completar el registro (`completar_registro`) el perfil conserva la empresa, pasa a visible y toma la etiqueta según el stand. Representantes: tabla `company_invites`, RPC `invitar_representante(email)` (máximo 3 personas por empresa expositora), `retirar_invitacion`, `mi_empresa()`; el invitado entra a la empresa al registrarse con ese correo. Cambio `supabase/cambios/10-representantes-e-invitaciones.sql`.
- **Lista oficial de stands (26-sep, propuesta de Lina):** tabla `stand_list` (stand normalizado, empresa, correos o dominios autorizados, categoría), pestaña "Lista de stands" del panel. `completar_registro` llama a `verificar_stand_automatico`: si el stand declarado está en la lista y el correo (o su dominio) está autorizado, la empresa queda aprobada como Expositor al instante (auditoría `aprobar_expositor_auto`); si no, queda pendiente y el panel muestra a quién pertenece el stand (`admin_pista_stand`). Cambios 13 y 14.
- **Correo de agenda del día siguiente (26-sep):** Edge Function `correo-agenda` (admin con sesión o cabecera `x-cron-secret`), botón "Confirmo" por reunión → Edge Function `confirmar-reunion` (GET con firma HMAC, sin sesión) que marca `confirmo_a/b` y muestra una página de gracias. Programado con pg_cron (`agenda-6-oct`, `agenda-7-oct` a las 00:00 UTC = 19:00 Bogotá del 5 y 6 de octubre) vía `disparar_correo_agenda()` + pg_net; la URL y el `cron_secret` están en la tabla `secretos` (sin políticas) y el mismo valor en el secreto `CRON_SECRET` de la función. Desde el panel → Reuniones → "Enviar correo de agenda" se puede forzar. Notas privadas por contacto (`lead_notes`) en Agenda y en la pantalla del match; expositores y proveedores exportan sus matches con contacto y notas a CSV.
- **UX para personas poco tecnológicas (27-sep, pedido de Lina; Claude decide sin pedir permiso desde entonces):** letra base 17 px; barra inferior "Perfiles · Mi agenda · Mi perfil"; botones ✕/♥ con etiqueta "No" / "Me interesa" y frase de ayuda fija; bienvenida de 3 pasos la primera vez en Perfiles (localStorage `expohost-bienvenida`); "Cómo funciona" en la landing; textos sin jerga ("Quieren reunirse contigo · falta elegir horario", "Descargar en Excel", "Prioridad", "Ocultar de la app"); ErrorBoundary con "Volver a cargar"; panel con pestañas "Aprobar expositores · Personas · Reuniones · Invitar expositores · Lista de stands · Ajustes", frase de ayuda por pestaña, botón Volver, día actual y bloque "ahora" resaltado, asistencia con dos botones. Bug corregido: las pestañas usaban rutas relativas y quedaban en blanco.
- **27-sep (tarde):** página `/ayuda` (preguntas frecuentes en lenguaje sencillo, enlazada desde Mi perfil y la landing); workflow `.github/workflows/respaldo.yml` (respaldo diario 04:30 UTC como artefacto de 90 días; necesita el secreto `DB_URL` en GitHub, lo crea Lina); plantillas Excel en `docs/` (stands y expositores a invitar); "Cerrar sesión" con confirmación y aviso (sin contraseñas, volver exige código); pantalla de código con el código primero; "Entrar" recuerda el último correo. Dominio propio: se pidió en el mismo mensaje de DNS un CNAME `match` → `expohost.github.io`; cuando exista: GitHub → Settings → Pages → Custom domain `match.expohost.travel` (+ Enforce HTTPS), archivo `public/CNAME`, Supabase Site URL y Redirect URLs, `APP_URL` en secretos de funciones, y los enlaces de las plantillas de correo (`plantillas.js`).
- **28-sep (tarde):** lista oficial cargada (72 registros: 70 stands de 59 empresas + 2 empresas sin stand marcadas `sin_stand`); empresas sin stand de la lista se aprueban solas como proveedor (cambio 16); quien se registra con un stand/nombre de la lista y correo autorizado **se une a la empresa expositora ya existente** (invitada o creada por un colega) en vez de duplicarla, tope 3 (cambio 17, `empresa_existente_por_lista`). Invitación real probada: daniel@aheadhosting.com.co recibió el correo de invitación (usuario invitado, empresa Ahead D04). Auditoría de configuración hecha: Site URL, redirects, OTP 6, SMTP Resend, plantillas con confirmar?th, 6 funciones activas, secretos RESEND_API_KEY/RESEND_FROM/CRON_SECRET/CONFIRM_SECRET, 3 cron activos y probados vía pg_net (respuesta 200), HTTPS forzado en Pages, bucket fotos privado.
- **30-sep:** sección "Les interesas · ¿quieres reunirte?" en Mi agenda (RPC les_intereso: quienes me dieron ♥ y yo aún no, incluidos los que pasé con ✕ o nunca vi; botón "Me interesa" crea el match y lleva a elegir hora) y aviso en Perfiles ("N personas quieren reunirse contigo"). Cambio 20. Seguridad (auditoría 29-sep): se eliminó el workflow de respaldo en Actions (el artefacto era descargable en el repo público; Lina debe borrar los artefactos existentes), CRON_SECRET rotado, disparar_correo_* revocadas (cambio 19), correo-reunion acepta admin y dice "La organización canceló". Pendientes de la auditoría: suplantación por nombre de empresa al cargar CSV (antes del 1-oct), registro pendiente aplicado sin confirmación, OTP a 15 min y verify 120, enlaces Confirmo/encuesta por POST, borrar fotos al eliminar cuenta, y los 10 cambios de usabilidad del informe QA.
- **29-sep, dominio propio activo:** la app vive en **https://match.expohost.travel** (CNAME `match` → expohost.github.io en Wix; dominio configurado en GitHub → Settings → Pages con Enforce HTTPS; `public/CNAME`). La dirección vieja expohost.github.io/expohost-match redirige (301) a la nueva. Supabase: Site URL nuevo, Redirect URLs con ambas, secreto `APP_URL`, plantillas de acceso/confirmación/invitación con enlaces al dominio nuevo; las 6 funciones republicadas. Efecto: las sesiones abiertas en la dirección vieja se pierden (hay que pedir código una vez).
- **Regla para pruebas (28-sep):** nunca probar desde la app con correos inventados (@example.com, etc.) flujos que envíen correo (reservar, cancelar, agenda, encuesta): rebotan y dañan la reputación del dominio en Resend. Los scripts de prueba llaman a las RPC directamente y no envían correo; para probar correos usar direcciones reales del equipo. Secreto `CONFIRM_SECRET` fijado el 28-sep (firma de los enlaces "Confirmo" y de la encuesta); probado de punta a punta.
- **28-sep:** dominio `match.expohost.travel` verificado en Resend (DNS en Wix). Remitente cambiado a `Expohost Match <match@match.expohost.travel>` en Auth (`smtp_admin_email`) y en el secreto `RESEND_FROM`. Prueba real: correo de acceso entregado a lm.roa@aheadhosting.com.co (externo). Ya no hay restricción de destinatarios. El CNAME `match` → `expohost.github.io` (dominio de la app) aún no existe; opcional.
- **27-sep (noche):** límites de Auth por IP subidos para la feria (rate_limit_otp 30→360 por 5 min, verify 30→720, refresh 150→600; el correo sigue en 100/h); "Tu próxima reunión" arriba de Mi agenda los días 6 y 7 (hora de Bogotá); cifras resumen al abrir el panel (excluye perfiles Demo); `scripts/dominio.mjs` deja listo el cambio a match.expohost.travel (Site URL, Redirect URLs, APP_URL, plantillas) para cuando exista el CNAME.
- **Razón en la tarjeta (26-sep, pedido de Lina):** "Coincidencia mutua" / "Ofrece lo que buscas" / "Busca lo que ofreces" / "Perfil compatible con tu categoría" / "Coinciden en horario" / "Sin intereses en común" (las dos últimas en gris). Se muestran todos los perfiles; Lina decidirá si ocultar los sin intereses en común. `supabase/cambios/11-razon-feed.sql`.
- Registro (26-sep, decisiones de Lina): todos los campos del paso 1 obligatorios excepto la foto; celular con código de país elegido en lista (se guarda como `+57 3001234567`); número de stand obligatorio si elige "Expositor con stand"; opción "Empresa/servicio sin stand". Los campos de texto son no controlados (defaultValue) y se leen con FormData al enviar, porque el autocompletado del navegador no avisa a React.

## Cuentas y dónde viven las claves

- GitHub: repositorio público `expohost-match`. GitHub Pages con dominio personalizado match.expohost.travel (CNAME → <usuario>.github.io).
- Supabase: proyecto `expohost-match`, región us-east-2 (Ohio). `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env` local (ignorado) y como variables del workflow de GitHub Actions. Secret key y `RESEND_API_KEY` solo en secretos de Edge Functions.
- Resend (conectado el 26-sep con autorización de Lina, desde su Chrome): cuenta management@expohost.travel, workspace "expohost", dominio `match.expohost.travel` agregado en región **sa-east-1 (São Paulo)** con click tracking apagado (id `44b3edba-5df1-47e9-ad57-d782900bafd3`), clave `expohost-match` (Full access). SMTP de Supabase Auth ya apunta a smtp.resend.com:465, usuario `resend`, límite 100 correos/hora, y las plantillas Magic Link / Confirm signup están aplicadas (código de 6 dígitos). **Mientras el DNS no esté verificado**, el remitente es `onboarding@resend.dev` (Resend solo entrega a management@expohost.travel) tanto en Auth (`smtp_admin_email`) como en la Edge Function (`RESEND_FROM`). Cuando el dominio verifique: cambiar ambos a `Expohost Match <match@match.expohost.travel>` (Management API `PATCH /config/auth` y `POST /secrets`). Registros DNS pendientes (quien administre expohost.travel): TXT `resend._domainkey.match`, CNAME `rsend.match` → rsend-sae1.forge.rmta.net, CNAME `send.match` → send.forge.rmta.net, TXT `_dmarc.match` → `v=DMARC1; p=none;`.
- Contraseña de la base de datos de Supabase y todas las claves: en el gestor de contraseñas de Lina, nunca en el repositorio.

## Cómo desplegar y revertir

Escrito para alguien que no programa. Todo lo que dice "en el computador" se hace en la carpeta del proyecto con la terminal del Claude Code o de Windows.

**Qué hay en producción**
- La app (lo que ve la gente): https://match.expohost.travel (la dirección vieja expohost.github.io/expohost-match redirige a esta). Se publica sola cada vez que se sube código a la rama `main` de GitHub (Actions → "Publicar en GitHub Pages", tarda 1–2 minutos).
- La base de datos, el acceso, las fotos y las funciones de correo: proyecto `expohost-match` en Supabase.
- Los correos: Resend (remitente y plantillas configurados en Supabase).

**Publicar un cambio de la app**
1. En el computador: `npm run build` (comprueba que compila). Si sale un error, no seguir.
2. `git add -A`, `git commit -m "qué cambió"`, `git push`.
3. Esperar el visto verde en github.com/ExpoHost/expohost-match/actions. Recargar la app en el celular.

**Revertir la app a la versión anterior (si algo salió mal)**
1. En github.com/ExpoHost/expohost-match → pestaña **Actions** → elegir la última ejecución que estaba bien (verde, anterior al cambio) → botón **Re-run all jobs**. En 2 minutos vuelve la versión anterior sin tocar la base de datos.
2. Alternativa desde el computador: `git revert HEAD` y `git push` (crea un cambio que deshace el último).

**Cambios en la base de datos**
- Cada cambio vive en `supabase/cambios/NN-nombre.sql` y también al final de `supabase/schema.sql`. Para aplicar uno: Supabase → SQL Editor → New query → pegar el archivo → Run. Nunca borrar tablas en producción durante la feria.
- Revertir un cambio de base: no hay "deshacer" automático. Restaurar desde el respaldo (abajo) o pedir el SQL contrario a Claude Code. Por eso el código se congela el sábado 3 de octubre.

**Respaldo (todos los días desde el 30 de septiembre y antes de cualquier cambio de base)**
- En el computador: `npm run backup`. Crea `backups/FECHA-HORA/` con un archivo por tabla (JSON) y los usuarios de Auth. La carpeta `backups/` no se sube a GitHub. Copiarla a Google Drive.
- Necesita el archivo `.env.backup` (ignorado por git) con `DB_URL=postgresql://postgres.ujfhvhoutlqphbpwrgfq:CONTRASEÑA@aws-0-us-east-2.pooler.supabase.com:5432/postgres` (la contraseña de la base, con los caracteres especiales codificados: `(` → `%28`).
- Restaurar: Claude Code carga los JSON con un script; en Supabase Pro existiría restauración automática, en Free no.

**Pruebas (correr después de cualquier cambio)**
- `npm run pruebas`: 21 pruebas de reglas de negocio y seguridad + 11 de Fase 3. Necesita `.env.pruebas` (mismo contenido que `.env.backup` más `SUPABASE_URL`, `PUBLISHABLE` y `SECRET`).
- `npm run intrusion`: 31 intentos de ataque con la clave publishable; todos deben decir BLOQUEADO.

**Funciones de correo (Edge Functions)**
- Están en `supabase/functions/*`. Publicar una: `npx supabase@latest functions deploy NOMBRE --project-ref ujfhvhoutlqphbpwrgfq --no-verify-jwt` con la variable `SUPABASE_ACCESS_TOKEN` (token de acceso personal de Supabase). Secretos: Supabase → Edge Functions → Secrets (`RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`, `APP_URL` opcional).
- Programación automática (pg_cron): agenda del día siguiente el 5 y 6 de octubre a las 7 p.m., encuesta el 8 de octubre a las 9 a.m. Ver en Supabase → Integrations → Cron. Para forzar un envío: panel de organización → Reuniones → "Enviar correo de agenda" / Ajustes → "Enviar encuesta ahora".

**Cuando Resend verifique el dominio (match.expohost.travel)**
1. Supabase → Authentication → Emails → SMTP Settings → Sender email: `match@match.expohost.travel`, Sender name: Expohost Match → Save.
2. Supabase → Edge Functions → Secrets → `RESEND_FROM` = `Expohost Match <match@match.expohost.travel>`.
3. Enviar un correo de prueba (Entrar → tu correo) y confirmar que llega a un correo que no sea de la organización.

**Si la app deja de cargar**
- Ver github.com/ExpoHost/expohost-match/actions: si la última ejecución está en rojo, abrirla y leer el error, o re-ejecutar la anterior verde.
- Ver status.supabase.com. Si Supabase está caído, la app muestra "Sin conexión"; no hay nada que hacer salvo esperar.

**Después de la feria (seguridad)**
- Revocar el token de acceso de Supabase (foto → Account preferences → Access Tokens → Revoke), cambiar la contraseña de la base (Project Settings → Database → Reset database password), rotar la clave secret (Project Settings → API Keys) y la clave de Resend (API Keys → eliminar `expohost-match`), y actualizar los secretos de las funciones.
- Borrar la carpeta temporal de Claude Code del computador (contiene copias de las claves usadas durante la construcción).
