import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  // Co-op refuses to pair two different builds; see `src/net/protocol.ts`.
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: { host: true },
});
