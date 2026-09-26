# Expohost Match — contexto del proyecto

Lee este archivo completo antes de escribir código. Es la fuente de verdad del proyecto y cualquier computador o sesión retoma desde aquí. Actualiza la sección "Estado" al cerrar cada fase y haz commit.

## Qué es

Web app tipo "app de citas para negocios" para ExpoHost Bogotá 2026 (martes 6 y miércoles 7 de octubre, Gimnasio Moderno, Bogotá). Su propósito: que los expositores consigan reuniones uno a uno de calidad con asistentes, con una experiencia moderna y simple, no una rueda de negocios tradicional.

Dueña del producto: Lina María Roa, cofundadora de ExpoHost. Idioma de trabajo y de la interfaz: español (Colombia).

## Escala y filosofía

- Usuarios esperados: entre 30 y 50 expositores (de los ~120 que participan en la feria, solo cuentan los que se inscriban en Match) y entre 50 y 150 asistentes. Diseñar para 200 usuarios como máximo. No cargar expositores masivamente: se invita a todos, se crea perfil solo a los que aceptan.
- Nada de optimizaciones prematuras: sin colas, cachés, Realtime, PWA offline, pruebas de carga, límites por IP ni "por si llegan miles".
- Simplicidad ante todo. Entre dos opciones, la más sencilla de construir y de usar.
- Costo cero: GitHub Pages, Supabase Free y Resend Free (100 correos/día). Si algo requiere plan de pago, avisar antes.
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
- Lugares: (a) stand del expositor, sin tope, lugar por defecto para reuniones con expositor; (b) Zona Match: 10 mesas numeradas de 4 puestos, una reunión por mesa por bloque, para reuniones entre asistentes o cuando el expositor marca "prefiero Zona Match". El número de mesas se edita en el panel.
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

Inversionistas y capital · Propietarios y anfitriones · Property managers · Constructoras y desarrolladores · Tecnología · Proveedores · Marketing y demanda · Hotelería · Institucionales y gremios.

Categorías complementarias (para el score): Inversionistas ↔ Constructoras, Propietarios, Property managers · Propietarios ↔ Property managers, Tecnología, Proveedores · Property managers ↔ Tecnología, Proveedores, Marketing, Propietarios, Constructoras · Constructoras ↔ Inversionistas, Property managers · Tecnología ↔ Property managers, Hotelería, Propietarios · Proveedores ↔ Property managers, Hotelería, Propietarios · Marketing ↔ Property managers, Hotelería · Hotelería ↔ Tecnología, Proveedores, Marketing · Institucionales ↔ todas.

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
- [ ] Fase 2
- [ ] Prueba interna sábado 26
- [ ] Fase 3
- [ ] Fase 4
- [ ] Fase 5
- [ ] Expositores cargados (mié 30)
- [ ] Invitaciones enviadas (jue 1 / vie 2)
- [ ] Congelado v1.0-feria (sáb 3)

## Decisiones tomadas durante la construcción

- 26-sep: el proyecto Supabase quedó en la región **us-east-2 (Ohio)**, no us-east-1. Sin impacto. Conexión directa a la base por el pooler `aws-0-us-east-2.pooler.supabase.com:5432`, usuario `postgres.ujfhvhoutlqphbpwrgfq`.
- 26-sep, ajustes al schema aprobados por Lina: (1) tipo, tier, empresa, activo e invitado del perfil solo los cambia el admin (trigger `proteger_perfil`); (2) se quitó la política "participante confirma" y se creó la RPC `confirmar_reunion`; (3) los usuarios solo crean empresas de asistente; quien quiere ser expositor lo pide en el registro como "expositor con stand" (debe escribir su número de stand, doble verificación) o "expositor sin stand", y el admin aprueba con `aprobar_expositor`; (4) el tope diario de ♥ cuenta días en hora de Bogotá; (5) el feed solo muestra perfiles con al menos una etiqueta Busco u Ofrezco; (6) nadie sin sesión ejecuta funciones. Además: RPC `completar_registro` (guarda perfil, empresa/solicitud y teléfono en un paso), `registrar_consentimiento` toma IP y user agent de las cabeceras, bucket privado `fotos`.
- Correo de acceso (decisión de Lina, 26-sep): botón "Entrar a Expohost Match" con `{{ .ConfirmationURL }}` y el código `{{ .Token }}` debajo. Plantillas en `supabase/plantillas/magic.html` ("Magic Link", personas con perfil) y `confirmacion.html` ("Confirm signup", personas nuevas); el logo del correo es `public/correo/arcos.png`. La app usa flujo `implicit` (sirve aunque el correo se abra en otro navegador) y `src/main.tsx` procesa el `#access_token=...` del regreso antes del HashRouter.
- Código de 6 dígitos (el proyecto venía con 8; se cambió por API el 26-sep).
- Sesión de 7 días: el plan Free no permite limitar sesiones ("Pro Plans and up"), así que la app cierra la sesión si pasaron 7 días desde `last_sign_in_at` (`src/lib/sesion.tsx`).
- Mientras no esté Resend, el correo de Supabase solo llega a miembros de la organización y máximo 2 por hora: la prueba del 26 la hace Lina sola con management@expohost.travel, con perfiles de demostración para poder hacer match.
- La publishable key y la URL de Supabase están directamente en `src/lib/supabase.ts` (son públicas); el workflow no necesita variables.
- Pruebas de la base: `node --env-file=.env.pruebas supabase/pruebas.cjs` (ver cabecera del archivo).

## Cuentas y dónde viven las claves

- GitHub: repositorio público `expohost-match`. GitHub Pages con dominio personalizado match.expohost.travel (CNAME → <usuario>.github.io).
- Supabase: proyecto `expohost-match`, región us-east-2 (Ohio). `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env` local (ignorado) y como variables del workflow de GitHub Actions. Secret key y `RESEND_API_KEY` solo en secretos de Edge Functions.
- Resend: dominio verificado match.expohost.travel, remitente match@match.expohost.travel.
- Contraseña de la base de datos de Supabase y todas las claves: en el gestor de contraseñas de Lina, nunca en el repositorio.

## Cómo desplegar y revertir

(Claude Code completa esta sección en la Fase 5.)
