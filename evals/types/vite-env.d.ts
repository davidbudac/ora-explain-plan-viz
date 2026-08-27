// The evals tsconfig swaps `vite/client` types for `node`, but a few src
// modules the harness imports transitively (src/lib/agent/client.ts via the
// AI provider dispatch) read `import.meta.env`. Declare just that surface.
interface ImportMeta {
  readonly env: Record<string, string | boolean | undefined>;
}
