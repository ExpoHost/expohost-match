// Prueba de intrusión (Fase 5): con la clave publishable intenta lo que un atacante intentaría.
// Todo debe fallar o devolver 0 filas. Uso: node --env-file=.env.pruebas supabase/intrusion.cjs
// (SUPABASE_URL, PUBLISHABLE y SECRET; crea y borra 2 usuarios @example.com)
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL: URL, PUBLISHABLE, SECRET } = process.env;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SECRET, opts);
let fallas = 0;
const ok = (c, msg, extra) => { console.log((c ? 'BLOQUEADO ' : 'ABIERTO   ') + '· ' + msg + (extra ? ' → ' + extra : '')); if (!c) fallas++; };
const vacio = (r) => !!r.error || (Array.isArray(r.data) ? r.data.length === 0 : !r.data);
async function sesion(email) {
  const u = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user;
  const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const cli = createClient(URL, PUBLISHABLE, opts);
  const v = await cli.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' }); if (v.error) throw v.error;
  return { id: u.id, cli };
}
(async () => {
  const anon = createClient(URL, PUBLISHABLE, opts);
  const emails = ['intruso-a@example.com', 'intruso-b@example.com'];
  try {
    // sin sesión
    ok(vacio(await anon.from('profiles_private').select('*')), 'anon: leer profiles_private');
    ok(vacio(await anon.from('profiles').select('*')), 'anon: leer profiles');
    ok(vacio(await anon.from('meetings').select('*')), 'anon: leer meetings');
    ok(vacio(await anon.from('audit_events').select('*')), 'anon: leer audit_events');
    ok(vacio(await anon.from('secretos').select('*')), 'anon: leer secretos');
    ok(!!(await anon.rpc('reservar_reunion', { p_match: '00000000-0000-0000-0000-000000000000', p_block: 1 })).error, 'anon: reservar_reunion');
    ok(!!(await anon.rpc('feed')).error, 'anon: feed');
    ok(!!(await anon.rpc('admin_participantes')).error, 'anon: admin_participantes');
    ok(!!(await anon.rpc('contacto_de', { p_user: '00000000-0000-0000-0000-000000000000' })).error, 'anon: contacto_de');
    ok(!!(await anon.from('profiles').insert({ id: '00000000-0000-0000-0000-000000000000', nombre: 'x' })).error, 'anon: insertar en profiles');
    ok(!!(await anon.storage.from('fotos').list('')).error || (await anon.storage.from('fotos').list('')).data?.length === 0, 'anon: listar fotos');

    // con sesión normal
    const A = await sesion(emails[0]); const B = await sesion(emails[1]);
    ok(vacio(await A.cli.from('profiles_private').select('*').eq('user_id', B.id)), 'A: leer el contacto de B por tabla');
    ok(!!(await A.cli.rpc('contacto_de', { p_user: B.id })).error, 'A: contacto_de(B) sin match');
    ok(!!(await A.cli.from('profiles').update({ nombre: 'Hackeado' }).eq('id', B.id).select()).error || (await A.cli.from('profiles').select('nombre').eq('id', B.id).single()).data?.nombre !== 'Hackeado', 'A: editar el perfil de B');
    ok(!!(await A.cli.from('profiles').update({ tier: 'diamante' }).eq('id', A.id)).error, 'A: subirse a diamante');
    ok(!!(await A.cli.from('profiles_private').update({ email: 'otro@x.com' }).eq('user_id', A.id)).error, 'A: cambiar su propio correo por tabla');
    ok(!!(await A.cli.from('companies').insert({ nombre: 'Falsa', tipo: 'expositor', stand: '1' })).error, 'A: crear empresa expositora');
    ok(!!(await A.cli.from('meetings').insert({ match_id: '00000000-0000-0000-0000-000000000000', block_id: 1, lugar: 'mesa', mesa: 1 })).error, 'A: insertar reunión directa');
    ok(!!(await A.cli.from('swipes').insert({ from_user: B.id, to_user: A.id, liked: true })).error, 'A: fabricar un ♥ de B');
    ok(!!(await A.cli.from('matches').insert({ user_a: A.id < B.id ? A.id : B.id, user_b: A.id < B.id ? B.id : A.id })).error, 'A: fabricar un match');
    ok(!!(await A.cli.rpc('admin_participantes')).error || vacio(await A.cli.rpc('admin_participantes')), 'A: admin_participantes');
    ok(!!(await A.cli.rpc('aprobar_expositor', { p_company: '00000000-0000-0000-0000-000000000000' })).error, 'A: aprobar_expositor');
    ok(!!(await A.cli.rpc('admin_reasignar', { p_meeting: '00000000-0000-0000-0000-000000000000', p_block: 1, p_lugar: 'mesa', p_mesa: 1 })).error, 'A: admin_reasignar');
    ok(vacio(await A.cli.from('stand_list').select('*')), 'A: leer la lista de stands (correos)');
    ok(vacio(await A.cli.from('pending_registrations').select('*')), 'A: leer registros pendientes');
    ok(vacio(await A.cli.from('company_invites').select('*')), 'A: leer invitaciones de empresas');
    ok(vacio(await A.cli.from('audit_events').select('*')), 'A: leer auditoría');
    ok(!!(await A.cli.from('settings').update({ value: 1 }).eq('key', 'num_mesas')).error || (await admin.from('settings').select('value').eq('key', 'num_mesas').single()).data?.value !== 1, 'A: cambiar el número de mesas');
    ok(!!(await A.cli.storage.from('fotos').upload(`${B.id}/hack.jpg`, new Blob(['x']))).error, 'A: subir foto en la carpeta de B');
    const f = await fetch(`${URL}/functions/v1/invitar-expositores`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE }, body: '{}' });
    ok(f.status === 401, 'anon: Edge Function invitar-expositores', String(f.status));
    const g = await fetch(`${URL}/functions/v1/correo-agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'adivinado' }, body: '{}' });
    ok(g.status === 403 || g.status === 401, 'anon: correo-agenda con secreto falso', String(g.status));
  } finally {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data.users.filter((u) => emails.includes(u.email))) await admin.auth.admin.deleteUser(u.id);
  }
  console.log(fallas ? `\n${fallas} agujero(s) encontrados` : '\nTodo bloqueado.');
  process.exitCode = fallas ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
