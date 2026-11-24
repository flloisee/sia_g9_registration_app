import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    proxy: { '/api': 'http://localhost:4000' },
    // Vite blocks unknown Host headers; the localtunnel subdomain must be allowed.
    allowedHosts: ['.loca.lt'],
  },
});
