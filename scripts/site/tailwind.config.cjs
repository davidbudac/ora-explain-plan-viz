// Tailwind v3 config for the static showcase pages (site/*.html).
// Compiled into site/assets/site.css by `npm run build:site-css` (run from the repo root).
module.exports = {
  content: ['./site/*.html'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
};
