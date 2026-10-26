import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

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

// public/sw.js is copied verbatim; stamp its cache name with a hash of this
// build's output so each deploy gets a fresh cache (and the SW file changes,
// which is what makes browsers install the update).
function serviceWorkerBuildId(): Plugin {
  let outDir = 'dist'
  let id = ''
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    generateBundle(options, bundle) {
      outDir = options.dir ?? outDir
      id = createHash('sha1').update(Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 10)
    },
    // closeBundle: public/ has been copied into the output by now.
    closeBundle() {
      const file = join(outDir, 'sw.js')
      try {
        writeFileSync(file, readFileSync(file, 'utf8').replace("'__BUILD_ID__'", `'${id}'`))
      } catch {
        // No sw.js in the output (e.g. publicDir disabled): nothing to stamp.
      }
    },
  }
}

// Honor a harness-assigned port (e.g. preview tooling) while keeping Vite's
// default when PORT is unset.
const port = process.env.PORT ? Number(process.env.PORT) : undefined

// `vite build --mode single`: one self-contained index.html for release
// downloads. Drops what only makes sense on a hosted origin (service worker,
// manifest, analytics) and inlines the icon.
function singleFileHtml(): Plugin {
  const icon = readFileSync('public/icon.svg', 'utf8')
  return {
    name: 'single-file-html',
    apply: 'build',
    transformIndexHtml: (html) =>
      html
        .replace(/\s*<link rel="(apple-touch-icon|manifest)"[^>]*>/g, '')
        .replace(/\s*<script data-goatcounter[^>]*><\/script>/, '')
        .replace('href="/icon.svg"', `href="data:image/svg+xml,${encodeURIComponent(icon)}"`),
  }
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    plugins: single
      ? [react(), tailwindcss(), singleFileHtml(), viteSingleFile()]
      : [react(), tailwindcss(), serviceWorkerBuildId()],
    base: single ? './' : normalizeBasePath(process.env.APP_BASE_PATH),
    publicDir: single ? false : 'public',
    build: single ? { outDir: 'dist-single' } : undefined,
    server: { port },
    preview: { port },
  }
})
