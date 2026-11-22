
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const disableHmr = process.env.DISABLE_HMR === 'true';

  return {
    plugins: [
      react(),
      tailwindcss(),

      // Copies src/assets into dist/ for production builds.
      // Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',

        closeBundle(error?: Error): void {
          if (error) {
            return;
          }

          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');

          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {
              recursive: true,
              force: true,
            });
          }
        },
      },
    ],

    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },

    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,

      // Disable HMR when AI Studio requests it.
      hmr: !disableHmr,

      // Preserve existing file-watching behavior.
      watch: disableHmr ? null : {},
    },
  };
});
