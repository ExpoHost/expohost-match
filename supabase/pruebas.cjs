// Pruebas de seguridad y reglas de la base contra Supabase.
// Uso: crear .env.pruebas (ignorado por git) con SUPABASE_URL, PUBLISHABLE y SECRET, y correr:
//   node --env-file=.env.pruebas supabase/pruebas.cjs
// Crea 3 usuarios de prueba y los elimina al terminar.
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL: URL, PUBLISHABLE, SECRET } = process.env;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SECRET, opts);
let fallas = 0;
const ok = (cond, msg, extra) => { console.log((cond ? 'PASA ' : 'FALLA') + ' · ' + msg + (extra ? ' → ' + extra : '')); if (!cond) fallas++; };
const pass = 'Prueba-' + Math.random().toString(36).slice(2) + 'X1!';
async function usuario(letra) {
  const email = `prueba-${letra}-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { nombre: 'Prueba ' + letra } });
  if (error) throw error;
  const cli = createClient(URL, PUBLISHABLE, opts);
  const s = await cli.auth.signInWithPassword({ email, password: pass });
  if (s.error) throw s.error;
  return { id: data.user.id, cli };
}
const reg = (u, extra = {}) => u.cli.rpc('completar_registro', { p_nombre: 'Persona de prueba', p_cargo: 'Gerente', p_ciudad: 'Bogotá', p_bio: 'Prueba', p_telefono: '+573000000000',
  p_categoria: 'propietarios', p_empresa: 'Empresa ' + u.id.slice(0, 4), p_solicitud: '', p_stand: '',
  p_busca: ['Property management'], p_ofrece: ['Propiedades para operar'], p_franjas: ['mar-am', 'mar-pm'], ...extra });

(async () => {
  const anon = createClient(URL, PUBLISHABLE, opts);
  const r1 = await anon.from('profiles_private').select('*');
  ok(!!r1.error || r1.data.length === 0, '1. Sin sesión: profiles_private devuelve 0 filas', r1.error ? r1.error.message : r1.data.length + ' filas');
  const rf = await anon.rpc('feed');
  ok(!!rf.error, '   Extra: sin sesión no puede ejecutar feed()', rf.error && rf.error.message);

  const A = await usuario('a'), B = await usuario('b'), C = await usuario('c');
  const users = [A, B, C];
  try {
    for (const u of users) { const e = (await reg(u)).error; if (e) throw e; }
    await reg(B, { p_categoria: 'property-managers', p_busca: ['Propiedades para operar'], p_ofrece: ['Property management'] });

    const r2 = await A.cli.from('profiles_private').select('user_id');
    ok(!r2.error && r2.data.length === 1 && r2.data[0].user_id === A.id, '2. Usuario A: profiles_private solo devuelve su fila', r2.data && r2.data.length + ' fila(s)');

    const r5a = await A.cli.rpc('contacto_de', { p_user: B.id });
    ok(!!r5a.error, '5a. contacto_de(B) desde A ANTES del match falla', r5a.error && r5a.error.message);

    const fA = await A.cli.rpc('feed');
    ok(!fA.error && fA.data.some(p => p.id === B.id) && fA.data.every(p => !('email' in p) && !('telefono' in p)), '   Extra: feed de A incluye a B y no trae correo ni teléfono');

    const s1 = await A.cli.rpc('swipe', { p_to: B.id, p_liked: true });
    const s2 = await B.cli.rpc('swipe', { p_to: A.id, p_liked: true });
    ok(!s1.error && s1.data === null && !s2.error && !!s2.data, '3. Swipe mutuo A↔B: swipe() devuelve match_id', s2.data || (s2.error && s2.error.message));
    const match = s2.data;

    const p = await A.cli.rpc('propuestas', { p_match: match });
    ok(!p.error && p.data.length >= 1 && p.data.length <= 3, '4a. propuestas(match) devuelve hasta 3 bloques', p.data && p.data.map(x => `${x.dia} ${x.inicio} ${x.lugar}${x.mesa ? ' ' + x.mesa : ''}`).join(' | '));
    const blk = p.data[0].block_id;
    const res1 = await A.cli.rpc('reservar_reunion', { p_match: match, p_block: blk });
    ok(!res1.error, '4b. Primera reserva funciona', res1.error && res1.error.message);
    await A.cli.rpc('swipe', { p_to: C.id, p_liked: true });
    const mAC = (await C.cli.rpc('swipe', { p_to: A.id, p_liked: true })).data;
    const res2 = await C.cli.rpc('reservar_reunion', { p_match: mAC, p_block: blk });
    ok(!!res2.error, '4c. Segunda reserva de A en el mismo bloque → error de horario', res2.error && res2.error.message);
    const res3 = await B.cli.rpc('reservar_reunion', { p_match: match, p_block: p.data[1].block_id });
    ok(!!res3.error, '   Extra: el mismo match no puede tener dos reuniones activas', res3.error && res3.error.message);

    const r5b = await A.cli.rpc('contacto_de', { p_user: B.id });
    ok(!r5b.error && r5b.data.length === 1 && !!r5b.data[0].email, '5b. contacto_de(B) desde A DESPUÉS del match funciona');
    const r5c = await B.cli.rpc('contacto_de', { p_user: C.id });
    ok(!!r5c.error, '   Extra: B no ve el contacto de C (no hay match)', r5c.error && r5c.error.message);

    const x1 = await A.cli.from('profiles').update({ tier: 'vip' }).eq('id', A.id);
    ok(!!x1.error, '   Ajuste 1: A no puede subirse a VIP', x1.error && x1.error.message);
    const x1b = await A.cli.from('profiles').update({ bio: 'Nueva bio' }).eq('id', A.id).select('bio');
    ok(!x1b.error && x1b.data[0].bio === 'Nueva bio', '   Ajuste 1: A sí puede editar su bio', x1b.error && x1b.error.message);
    const x2 = await A.cli.from('meetings').update({ block_id: 1 }).eq('id', res1.data).select('id');
    ok(!!x2.error || x2.data.length === 0, '   Ajuste 2: A no puede mover la reunión directamente');
    const x2b = await A.cli.rpc('confirmar_reunion', { p_meeting: res1.data });
    const mt = await B.cli.from('meetings').select('confirmo_a, confirmo_b, block_id').eq('id', res1.data).single();
    ok(!x2b.error && (mt.data.confirmo_a !== mt.data.confirmo_b) && mt.data.block_id === blk, '   Ajuste 2: confirmar_reunion marca solo la confirmación de A', x2b.error && x2b.error.message);
    const x3 = await A.cli.from('companies').insert({ nombre: 'Falsa', tipo: 'expositor', stand: '12' });
    ok(!!x3.error, '   Ajuste 3: A no puede crear una empresa expositora', x3.error && x3.error.message);
    const x3b = await reg(C, { p_solicitud: 'expositor_stand', p_stand: '' });
    ok(!!x3b.error, '   Ajuste 3: solicitud de expositor con stand exige número', x3b.error && x3b.error.message);
    const x3c = await reg(C, { p_solicitud: 'expositor_stand', p_stand: 'A-12' });
    const cc = await C.cli.from('profiles').select('tipo, companies(solicitud, stand_declarado, tipo)').eq('id', C.id).single();
    ok(!x3c.error && cc.data.tipo === 'asistente' && cc.data.companies.solicitud === 'expositor_stand' && cc.data.companies.stand_declarado === 'A-12', '   Ajuste 3: la solicitud queda pendiente y C sigue como asistente', (x3c.error || cc.error || {}).message);

    const can = await B.cli.rpc('cancelar_reunion', { p_meeting: res1.data });
    const res4 = await C.cli.rpc('reservar_reunion', { p_match: mAC, p_block: blk });
    ok(!can.error && !res4.error, '   Extra: cancelar libera el bloque (C ya puede reservarlo con A)', (can.error || res4.error || {}).message);

    const del = await C.cli.rpc('eliminar_mi_cuenta');
    const gone = await admin.auth.admin.getUserById(C.id);
    ok(!del.error && !gone.data.user, '   Extra: eliminar_mi_cuenta borra al usuario', del.error && del.error.message);
  } finally {
    for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodas las pruebas pasan. Usuarios de prueba eliminados.');
  process.exitCode = fallas ? 1 : 0;
})().catch(e => { console.error('ERROR', e.message || e); process.exit(1); });
