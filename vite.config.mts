import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Client root is src/client; /socket.io proxies to the room engine (npm run dev:server).
// ENGINE_PORT overrides 3001 on both sides when something else holds it.
const enginePort = process.env.ENGINE_PORT ?? '3001';

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/socket.io': { target: `http://localhost:${enginePort}`, ws: true },
      '/api': { target: `http://localhost:${enginePort}` },
    },
  },
  build: { outDir: '../../dist', emptyOutDir: true },
});
