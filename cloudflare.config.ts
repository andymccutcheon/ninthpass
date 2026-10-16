import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig({
  // Set CLOUDFLARE_ACCOUNT_ID in your environment, or leave unset when your
  // cf login has access to exactly one account.
  ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
  worker: {
    name: 'promptzilla-mcp',
    entrypoint: 'worker/index.ts',
    compatibilityDate: '2026-10-01',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: true,
    previewUrls: false,
    exports: { PipelineRun: exports.durableObject({ storage: 'sqlite' }) },
    env: {
      PIPELINE_RUNS: bindings.durableObject({ worker: 'promptzilla-mcp', exportName: 'PipelineRun' }),
      PROMPTZILLA_CLIENTS: bindings.secret(),
    },
  },
});
