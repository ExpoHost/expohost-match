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
    const g = await fetch(`${URL}/functions/v1/responder-encuesta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ m: mt, u: A.id, r: 'si', t: 'malo' }) });
    const gj = await g.json();
    ok(gj.ok === false && gj.motivo === 'firma', '7. responder-encuesta rechaza firma falsa');
    const g2 = await fetch(`${URL}/functions/v1/confirmar-reunion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ m: mt, u: A.id, t: 'malo' }) });
    ok((await g2.json()).ok === false, '8. confirmar-reunion rechaza firma falsa');
    // Cambiar la hora: la app propone todas las horas libres para ambos y el participante elige
    const ops = (await B.cli.rpc('propuestas', { p_match: match, p_limite: 28 })).data;
    ok(ops.length > 3 && !ops.some((o) => o.block_id === otro), '9. Opciones para cambiar la hora: todas las libres, sin la actual', String(ops.length));
    const destino = ops[ops.length - 1].block_id;
    const r9 = await B.cli.rpc('reagendar_reunion', { p_meeting: mt, p_block: destino });
    const { data: m9 } = await admin.from('meetings').select('block_id, cambiada_por, correo_confirmacion_at, estado').eq('id', mt).single();
    const { data: mp9 } = await admin.from('meeting_participants').select('block_id').eq('meeting_id', mt);
    ok(!r9.error && m9.block_id === destino && m9.cambiada_por === B.id && m9.estado === 'confirmada' && m9.correo_confirmacion_at === null && mp9.every((x) => x.block_id === destino), '10. Un participante cambia la hora de su reunión', r9.error?.message);
    const r10 = await C.cli.rpc('reagendar_reunion', { p_meeting: mt, p_block: ops[0].block_id });
    ok(!!r10.error, '11. Quien no es de la reunión no puede cambiarla', r10.error?.message);
    const r11 = await A.cli.rpc('reagendar_reunion', { p_meeting: mt, p_block: 9999 });
    ok(!!r11.error, '12. Una hora que no está libre se rechaza', r11.error?.message);
    await A.cli.rpc('reagendar_reunion', { p_meeting: mt, p_block: ops[0].block_id }); await A.cli.rpc('reagendar_reunion', { p_meeting: mt, p_block: ops[1].block_id });
    const r13 = await A.cli.rpc('reagendar_reunion', { p_meeting: mt, p_block: ops[2].block_id });
    ok(/varias veces/.test(r13.error?.message ?? ''), '13. Tope de 3 cambios de hora por reunión al día', r13.error?.message);
    // Sacar de la app: cancela reuniones, oculta y bloquea la entrada, sin borrar datos; se puede volver a admitir
    const s1 = await A.cli.rpc('admin_sacar', { p_user: B.id, p_sacar: true });
    ok(!!s1.error, '14. Quien no es de la organización no puede sacar a nadie', s1.error?.message);
    const s2 = await AD.cli.rpc('admin_sacar', { p_user: B.id, p_sacar: true });
    const { data: mtS } = await admin.from('meetings').select('estado').eq('id', mt).single();
    const { data: pB } = await admin.from('profiles').select('activo, nombre').eq('id', B.id).single();
    ok(!s2.error && s2.data.length === 1 && s2.data[0] === mt && mtS.estado === 'cancelada' && pB.activo === false && !!pB.nombre, '15. La organización saca a una persona: reunión cancelada, perfil oculto, datos conservados', s2.error?.message);
    const ref = await B.cli.auth.refreshSession();
    ok(!!ref.error, '16. La persona sacada no puede renovar su sesión', ref.error?.message);
    const lk = await admin.auth.admin.generateLink({ type: 'magiclink', email: emails[2] });
    const v2 = lk.error ? { error: lk.error } : await createClient(URL, PUBLISHABLE, opts).auth.verifyOtp({ token_hash: lk.data.properties.hashed_token, type: 'magiclink' });
    ok(!!v2.error, '17. La persona sacada no puede volver a entrar', v2.error?.message);
    const { data: lista } = await AD.cli.rpc('admin_participantes'); const fb = (lista ?? []).find((x) => x.id === B.id);
    ok(!!fb && fb.sacado === true && fb.entro === true, '18. El panel la muestra como fuera de la app');
    const s3 = await AD.cli.rpc('admin_sacar', { p_user: B.id, p_sacar: false });
    const lk2 = await admin.auth.admin.generateLink({ type: 'magiclink', email: emails[2] });
    const v3 = lk2.error ? { error: lk2.error } : await createClient(URL, PUBLISHABLE, opts).auth.verifyOtp({ token_hash: lk2.data.properties.hashed_token, type: 'magiclink' });
    const { data: pB2 } = await admin.from('profiles').select('activo').eq('id', B.id).single();
    ok(!s3.error && !v3.error && pB2.activo === true, '19. Volver a admitir: la persona entra de nuevo', s3.error?.message ?? v3.error?.message);
    const s4 = await AD.cli.rpc('admin_sacar', { p_user: AD.id, p_sacar: true });
    ok(!!s4.error, '20. Nadie de la organización se puede sacar a sí mismo', s4.error?.message);
  } finally {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data.users.filter((u) => emails.includes(u.email))) await admin.auth.admin.deleteUser(u.id);
    const c = await (async () => { const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); return c })();
    await c.query('delete from companies where id not in (select company_id from profiles where company_id is not null)'); await c.end();
  }
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodas las pruebas de la Fase 4 pasan.');
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
