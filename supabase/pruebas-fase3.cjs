// Pruebas de la Fase 3 (carga de expositores y representantes) contra Supabase.
// Uso: node --env-file=.env.pruebas supabase/pruebas-fase3.cjs  (variables de pruebas.cjs + DB_URL de la base)
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL: URL, PUBLISHABLE, SECRET } = process.env;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SECRET, opts);
let fallas = 0;
const ok = (c, msg, extra) => { console.log((c ? 'PASA ' : 'FALLA') + ' · ' + msg + (extra ? ' → ' + extra : '')); if (!c) fallas++; };
async function sesion(email, rol) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let u = data.users.find((x) => x.email === email);
  if (!u) u = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user;
  if (rol) await admin.auth.admin.updateUserById(u.id, { app_metadata: { role: rol } });
  const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const cli = createClient(URL, PUBLISHABLE, opts);
  const v = await cli.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  return { id: u.id, cli, token: v.data.session.access_token };
}
const reg = (u, extra = {}) => u.cli.rpc('completar_registro', { p_nombre: 'Persona Exp', p_cargo: 'Ventas', p_ciudad: 'Bogotá', p_bio: 'Prueba fase 3', p_telefono: '+57 3000000000',
  p_categoria: 'tecnologia', p_empresa: 'Empresa que no debe usarse', p_solicitud: '', p_stand: '',
  p_busca: ['Property management'], p_ofrece: ['Tecnología (PMS, channel manager, IA)'], p_franjas: ['mar-am'], ...extra });
(async () => {
  const emails = ['prueba-adm@example.com', 'prueba-exp-1@example.com', 'prueba-exp-2@example.com', 'prueba-exp-3@example.com', 'prueba-exp-4@example.com'];
  try {
    const A = await sesion(emails[0], 'admin');
    const r = await fetch(`${URL}/functions/v1/invitar-expositores`, { method: 'POST', headers: { Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ solo_crear: true, filas: [{ empresa: 'Demo Prueba Exp', stand: 'Z-9', nombre: 'Expo Uno', email: emails[1], categoria: 'tecnologia' }, { empresa: 'x', stand: '', nombre: '', email: 'malo' }] }) });
    const j = await r.json();
    ok(r.status === 200 && j.resultados?.[0]?.estado === 'creado sin correo' && j.resultados?.[1]?.estado === 'omitida', '1. Edge Function crea el expositor y omite la fila inválida', JSON.stringify(j.resultados));
    const { data: p1 } = await admin.from('profiles').select('invitado, tipo, tier, company:companies(nombre, stand, tipo)').eq('id', (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === emails[1]).id).single();
    ok(p1?.invitado === true && p1.tipo === 'expositor' && p1.tier === 'expositor' && p1.company?.stand === 'Z-9', '2. Perfil invitado: expositor con stand Z-9, aún invisible', JSON.stringify(p1));
    const { data: feedA } = await A.cli.rpc('feed');
    ok(!feedA?.some((x) => x.empresa === 'Demo Prueba Exp'), '   Extra: el invitado no aparece en el feed hasta completar');

    const E1 = await sesion(emails[1]);
    const c1 = await reg(E1);
    const { data: p1b } = await admin.from('profiles').select('invitado, tipo, tier, company:companies(nombre)').eq('id', E1.id).single();
    ok(!c1.error && p1b.invitado === false && p1b.tipo === 'expositor' && p1b.company?.nombre === 'Demo Prueba Exp', '3. Al completar el registro conserva su empresa y se vuelve visible', c1.error?.message);

    const i1 = await E1.cli.rpc('invitar_representante', { p_email: emails[2] });
    const i2 = await E1.cli.rpc('invitar_representante', { p_email: emails[3] });
    const i3 = await E1.cli.rpc('invitar_representante', { p_email: emails[4] });
    ok(!i1.error && !i2.error && !!i3.error, '4. Invita 2 representantes; el cuarto integrante se rechaza', i3.error?.message);
    const { data: emp } = await E1.cli.rpc('mi_empresa');
    ok(emp?.invitaciones?.length === 2 && emp.integrantes?.length === 1, '   Extra: mi_empresa muestra 1 integrante y 2 invitaciones');

    const E2 = await sesion(emails[2]);
    const c2 = await reg(E2, { p_empresa: 'Otra empresa distinta' });
    const { data: p2 } = await admin.from('profiles').select('tipo, tier, company:companies(nombre)').eq('id', E2.id).single();
    ok(!c2.error && p2.company?.nombre === 'Demo Prueba Exp' && p2.tipo === 'expositor', '5. El representante invitado entra a la empresa aunque escriba otro nombre', c2.error?.message ?? JSON.stringify(p2));
    const { data: emp2 } = await E1.cli.rpc('mi_empresa');
    ok(emp2?.integrantes?.length === 2 && emp2.invitaciones?.length === 1, '   Extra: ahora 2 integrantes y 1 invitación pendiente');
    const ret = await E1.cli.rpc('retirar_invitacion', { p_email: emails[3] });
    const { data: emp3 } = await E1.cli.rpc('mi_empresa');
    ok(!ret.error && emp3?.invitaciones?.length === 0, '6. Retirar invitación');
    const anon = createClient(URL, PUBLISHABLE, opts);
    const rf = await fetch(`${URL}/functions/v1/invitar-expositores`, { method: 'POST', headers: { Authorization: `Bearer ${E1.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ filas: [] }) });
    ok(rf.status === 403, '7. Un no-admin no puede invitar expositores', String(rf.status));
    ok(!!(await anon.rpc('mi_empresa')).error, '   Extra: sin sesión no se ejecuta mi_empresa');
  } finally {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data.users.filter((u) => emails.includes(u.email))) await admin.auth.admin.deleteUser(u.id);
    const c = await (async () => { const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); return c })();
    await c.query("delete from company_invites where email like 'prueba-%@example.com'");
    await c.query('delete from companies where id not in (select company_id from profiles where company_id is not null)');
    await c.end();
  }
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodas las pruebas de la Fase 3 pasan.');
  process.exitCode = fallas ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message || e); process.exit(1); });
