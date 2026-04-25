import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        volunteer: 'volunteer-dashboard.html',
        ngo: 'ngo-dashboard.html',
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
