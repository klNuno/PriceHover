import { defineSubmitConfig } from 'wxt/submit';

export default defineSubmitConfig({
  dryRun: false,
  submissionConfig: {
    chrome: {
      uploadBeta: false,
      publishTarget: 'default',
    },
    firefox: {
      channel: 'listed',
    },
  },
});
