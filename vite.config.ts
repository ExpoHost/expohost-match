import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const SUPABASE = 'https://ujfhvhoutlqphbpwrgfq.supabase.co'

// GitHub Pages no permite cabeceras propias: la política de seguridad va como <meta>.
// Solo en la versión publicada (en desarrollo Vite necesita scripts en línea).
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: ${SUPABASE}; connect-src 'self' ${SUPABASE}; base-uri 'self'; form-action 'self'; object-src 'none'" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />`,
    ),
}

// base relativa: funciona igual en expohost.github.io/expohost-match y en match.expohost.travel
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), csp],
})
