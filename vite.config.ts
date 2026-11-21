import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // everything (fonts, terrain texture) is inlined so the single-file build works offline
  build: { target: 'es2020', chunkSizeWarningLimit: 4000, assetsInlineLimit: 8_000_000 },
});
