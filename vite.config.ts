import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function normalizeBasePath(value?: string): string {
  if (!value || value.trim() === '') {
    return '/'
  }

  const trimmed = value.trim()
  if (trimmed === '/') {
    return '/'
  }

  const withoutLeading = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const withoutTrailing = withoutLeading.endsWith('/') ? withoutLeading.slice(0, -1) : withoutLeading

  return `/${withoutTrailing}/`
}

const base = normalizeBasePath(process.env.APP_BASE_PATH)

// Honor a harness-assigned port (e.g. preview tooling) while keeping Vite's
// default when PORT is unset.
const port = process.env.PORT ? Number(process.env.PORT) : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
  server: { port },
  preview: { port },
})
