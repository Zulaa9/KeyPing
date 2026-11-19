// @ts-check
import { defineConfig } from 'astro/config';

// Sitio estático: sin servidor, sin scripts en línea (CSP estricta) y sin recursos externos.
export default defineConfig({
  site: 'https://keyping.zula.dev',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  build: {
    format: 'directory',
    // Todo el CSS en archivos propios: la CSP no permite estilos en línea.
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      // Nada de data: URIs; la CSP solo admite imágenes del propio dominio.
      assetsInlineLimit: 0,
    },
  },
});
