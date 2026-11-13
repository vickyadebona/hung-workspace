import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// On Vercel (it sets VERCEL=1 during builds) use the Vercel adapter; everywhere else run as a plain Node server.
const onVercel = !!process.env.VERCEL;

export default defineConfig({
  output: 'server',
  adapter: onVercel ? vercel() : node({ mode: 'standalone' }),
  integrations: [react()],
  server: { port: 4321 },
  vite: { plugins: [tailwindcss()] },
});
