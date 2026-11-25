import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'

// The strict policy only applies to the built app; dev needs inline scripts for hot reload.
const csp = {
  name: 'drift-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string): string =>
    html.replace(
      '<!--csp-->',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:">`,
    ),
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), csp],
    css: {
      postcss: {
        plugins: [tailwindcss({ config: path.resolve(__dirname, 'tailwind.config.cjs') }), autoprefixer()],
      },
    },
  },
})
