// Pruebas de la Fase 4 (reasignar, lista de espera, encuesta). Uso: node --env-file=.env.pruebas supabase/pruebas-fase4.cjs
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL: URL, PUBLISHABLE, SECRET } = process.env;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SECRET, opts);
let fallas = 0; const ok = (c, m, x) => { console.log((c ? 'PASA ' : 'FALLA') + ' · ' + m + (x ? ' → ' + x : '')); if (!c) fallas++; };
async function sesion(email, rol) {
  const u = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user;
  if (rol) await admin.auth.admin.updateUserById(u.id, { app_metadata: { role: rol } });
  const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const cli = createClient(URL, PUBLISHABLE, opts);
  const v = await cli.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' }); if (v.error) throw v.error;
  return { id: u.id, cli, token: v.data.session.access_token };
}
const reg = (u, franjas) => u.cli.rpc('completar_registro', { p_nombre: 'Persona F4', p_cargo: 'x', p_ciudad: 'Bogotá', p_bio: 'prueba fase 4', p_telefono: '+57 3000000000', p_categoria: 'propietarios', p_empresa: 'Empresa ' + u.id.slice(0, 4), p_solicitud: '', p_stand: '', p_busca: ['Property management'], p_ofrece: ['Propiedades para operar'], p_franjas: franjas });
(async () => {
  const emails = ['f4-admin@example.com', 'f4-a@example.com', 'f4-b@example.com', 'f4-c@example.com'];
  try {
    const AD = await sesion(emails[0], 'admin'), A = await sesion(emails[1]), B = await sesion(emails[2]), C = await sesion(emails[3]);
    await reg(A, ['mar-am']); await reg(B, ['mar-am']); await reg(C, ['mie-pm']);
    await A.cli.rpc('swipe', { p_to: B.id, p_liked: true }); const match = (await B.cli.rpc('swipe', { p_to: A.id, p_liked: true })).data;
    const props = (await A.cli.rpc('propuestas', { p_match: match })).data;
    const mt = (await A.cli.rpc('reservar_reunion', { p_match: match, p_block: props[0].block_id })).data;
    const otro = props[1].block_id;
    const r1 = await AD.cli.rpc('admin_reasignar', { p_meeting: mt, p_block: otro, p_lugar: 'mesa', p_mesa: 3 });
    const { data: m1 } = await admin.from('meetings').select('block_id, mesa, lugar').eq('id', mt).single();
    ok(!r1.error && m1.block_id === otro && m1.mesa === 3, '1. Admin reasigna a otro bloque y mesa 3', r1.error?.message);
    const r2 = await AD.cli.rpc('admin_reasignar', { p_meeting: mt, p_block: otro, p_lugar: 'mesa', p_mesa: 3 });
    ok(!r2.error, '   Extra: reasignar al mismo sitio no choca consigo misma', r2.error?.message);
    // choque de mesa: otra reunión en mesa 3 del mismo bloque
    await C.cli.rpc('swipe', { p_to: B.id, p_liked: true }); const mCB = (await B.cli.rpc('swipe', { p_to: C.id, p_liked: true })).data;
    const pCB = (await C.cli.rpc('propuestas', { p_match: mCB })).data;
    ok(pCB.length === 0, '2. Sin franja en común no hay propuestas', String(pCB.length));
    const w = await C.cli.rpc('lista_de_espera', { p_match: mCB });
    ok(!w.error && w.data === 0, '3. Lista de espera sin franjas en común inserta 0 bloques', String(w.data));
    const w2 = await A.cli.rpc('lista_de_espera', { p_match: match });
    const { data: le } = await AD.cli.rpc('admin_lista_espera');
    ok(!w2.error && w2.data > 0 && le.length > 0 && le[0].personas === 1, '4. Lista de espera con franjas en común y el admin la ve', `${w2.data} bloques`);
    ok(!!(await A.cli.rpc('admin_lista_espera')).error || (await A.cli.rpc('admin_lista_espera')).data.length === 0, '   Extra: un no-admin no ve la lista de espera');
    const { data: enc } = await AD.cli.rpc('admin_encuesta');
    ok(enc?.[0]?.reuniones >= 1, '5. admin_encuesta responde', JSON.stringify(enc?.[0]));
    const f = await fetch(`${URL}/functions/v1/correo-encuesta`, { method: 'POST', headers: { Authorization: `Bearer ${AD.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ solo: 'nadie@example.com' }) });
    const j = await f.json();
    ok(f.status === 200 && j.enviado === true && j.personas === 0, '6. correo-encuesta responde al admin (0 personas con filtro)', JSON.stringify(j));
    const g = await fetch(`${URL}/functions/v1/responder-encuesta?m=${mt}&u=${A.id}&r=si&t=malo`);
    ok((await g.text()).includes('no válido'), '7. responder-encuesta rechaza firma falsa');
  } finally {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data.users.filter((u) => emails.includes(u.email))) await admin.auth.admin.deleteUser(u.id);
    const c = await (async () => { const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); return c })();
    await c.query('delete from companies where id not in (select company_id from profiles where company_id is not null)'); await c.end();
  }
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodas las pruebas de la Fase 4 pasan.');
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
