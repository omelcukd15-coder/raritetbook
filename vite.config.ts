import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Плагин раздачи локального книжного архива (/archive/*) напрямую из папки ../archive
 * без копирования 580 МБ книг при каждой сборке фронтенда (Cloudflare Pages + R2 архитектура).
 */
function localArchiveServerPlugin(): Plugin {
  const archiveRoot = path.resolve(__dirname, 'archive');

  const middleware = (req: any, res: any, next: any) => {
    if (!req.url || !req.url.startsWith('/archive/')) {
      return next();
    }
    const cleanUrl = decodeURIComponent(req.url.split('?')[0]).replace(/^\/archive\//, '');
    const targetPath = path.resolve(archiveRoot, cleanUrl);
    if (!targetPath.startsWith(archiveRoot)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      return next();
    }

    const ext = path.extname(targetPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.json': 'application/json; charset=utf-8',
      '.fb2': 'application/x-fictionbook+xml; charset=utf-8',
      '.webp': 'image/webp',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    if (cleanUrl.startsWith('catalog/')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    if (ext === '.fb2') {
      const filename = path.basename(path.dirname(targetPath)) + '.fb2';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    fs.createReadStream(targetPath).pipe(res);
  };

  return {
    name: 'raritetbook-local-archive',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), localArchiveServerPlugin()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
