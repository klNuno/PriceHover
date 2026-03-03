import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  extensionApi: 'chrome',
  manifestVersion: 3,
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: 'PriceHover',
    description: 'Converts prices on any webpage on hover',
    version: '1.0.0',
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://open.er-api.com/*', 'https://flagcdn.com/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'PriceHover',
      default_popup: 'popup.html',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: { id: 'pricehover@klnuno', strict_min_version: '109.0' },
      },
    }),
  }),
});
