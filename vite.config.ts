import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@stratos-wallet/sdk': '/root/cantonlocal/stratos-wallet-sdk/dist/index.mjs',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['snarkjs'],
  },
});
