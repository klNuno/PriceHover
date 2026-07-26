import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ browser }) => ({
    name: 'PriceHover',
    description: 'Converts prices on any webpage on hover',
    // version is intentionally absent: WXT takes it from package.json, which
    // keeps a single source of truth. The popup reads it back from the manifest.
    permissions: ['storage'],
    host_permissions: ['https://open.er-api.com/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'pricehover@klnuno',
          strict_min_version: '109.0',
          data_collection_permissions: {
            required: ['none'],
            optional: [],
          },
        },
      },
    }),
  }),
});
