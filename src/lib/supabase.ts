import { createClient } from '@supabase/supabase-js'

// Valores públicos por diseño (la publishable key solo permite lo que RLS autoriza).
// Se pueden sobrescribir con un .env local.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://ujfhvhoutlqphbpwrgfq.supabase.co'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_9HMoKVIP8AH0NAx3W1onaA_mUXi7spd'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
