// Respaldo de la base: exporta todas las tablas públicas (y los usuarios de Auth sin contraseñas)
// a backups/AAAA-MM-DD-HHMM/ en JSON. No necesita pg_dump instalado.
// Uso: crear .env.backup (ignorado por git) con DB_URL=postgresql://postgres.<ref>:<contraseña>@<host>:5432/postgres
//      y correr: npm run backup
import { Client } from 'pg'
import { mkdirSync, writeFileSync } from 'node:fs'

const url = process.env.DB_URL
if (!url) { console.error('Falta DB_URL (ver cabecera del script).'); process.exit(1) }
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const fecha = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
const dir = `backups/${fecha}`
mkdirSync(dir, { recursive: true })
const { rows: tablas } = await c.query("select tablename from pg_tables where schemaname = 'public' order by tablename")
let total = 0
for (const { tablename } of tablas) {
  const { rows } = await c.query(`select * from public."${tablename}"`)
  writeFileSync(`${dir}/${tablename}.json`, JSON.stringify(rows, null, 1))
  total += rows.length
  console.log(`${tablename}: ${rows.length}`)
}
const { rows: usuarios } = await c.query('select id, email, created_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data from auth.users')
writeFileSync(`${dir}/auth_users.json`, JSON.stringify(usuarios, null, 1))
console.log(`auth.users: ${usuarios.length}\nRespaldo en ${dir} (${total + usuarios.length} filas).`)
await c.end()
