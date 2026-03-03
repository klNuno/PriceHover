import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'PriceHover',
    description: 'Converts prices on any webpage on hover',
    version: '0.1.0',
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://open.er-api.com/*', 'https://flagcdn.com/*'],
  },
});
