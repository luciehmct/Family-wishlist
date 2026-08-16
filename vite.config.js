import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

// ponytail: base './' means the repo name never has to be configured anywhere.
// Works for both user.github.io and user.github.io/Family-wishlist/.
// Only valid because there is no client-side router.
export default defineConfig({
  base: './',
  plugins: [react(), tailwind()],
});
