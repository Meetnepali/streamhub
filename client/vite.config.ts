import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Everything goes through the Vite origin so cookies, media byte-ranges and canvas frame capture are same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true, xfwd: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
    },
  },
});
