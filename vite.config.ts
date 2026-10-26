import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // Never inline fonts as data: URIs; the CSP (default-src 'self') only allows same-origin font files
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    rolldownOptions: {
      output: {
        // React gets its own chunk: it changes only on upgrades, so browsers keep it cached across releases.
        // antd is deliberately not forced into one chunk: that would put the components only some pages use
        // (Table, Upload, DatePicker…) on the first screen (+90 KB gzip). Automatic splitting puts each antd
        // module in the chunk of the pages that use it. Pages are split by the lazy imports in main.tsx and
        // AdminRoutes.tsx; scripts/bundle-check.mjs guards the first-screen size.
        codeSplitting: {
          groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
  server: { proxy: { '/api': 'http://localhost:8080', '/healthz': 'http://localhost:8080' } },
});
