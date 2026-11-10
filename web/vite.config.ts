import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Normalise `VITE_BASE_PATH` so both "/" and "/earthpulse" work. */
export function normaliseBase(value: string | undefined): string {
  const raw = (value ?? '/').trim()
  if (raw === '' || raw === '/') return '/'
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

/**
 * Preload the contract entry point. `loaders.ts` fetches it immediately, so
 * starting the request in the document head removes one round trip on first
 * visit. The path follows the configured base automatically.
 */
function preloadIndex(): Plugin {
  return {
    name: 'earthpulse-preload-index',
    transformIndexHtml(html, ctx) {
      const base = normaliseBase(ctx.server?.config.base ?? process.env.VITE_BASE_PATH)
      return {
        // Vite does not rebase a public-file href written by hand in index.html.
        html: html.replace('href="/favicon.svg"', `href="${base}favicon.svg"`),
        tags: [
          {
            tag: 'link',
            attrs: {
              rel: 'preload',
              href: `${base}data/index.json`,
              as: 'fetch',
              type: 'application/json',
              crossorigin: 'anonymous',
            },
            injectTo: 'head',
          },
        ],
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: normaliseBase(process.env.VITE_BASE_PATH),
  plugins: [react(), preloadIndex()],
})
