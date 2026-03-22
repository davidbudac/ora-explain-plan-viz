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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
})
