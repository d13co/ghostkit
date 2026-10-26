import { defineConfig } from 'vitest/config'

// Runs each suite twice: with the dtalgorand fork of algokit-utils (installed as @algorandfoundation/algokit-utils)
// and with stock algokit-utils (installed as algokit-utils-stock). Both use the one algosdk installed.
const stockUtils = [
  {
    find: /^@algorandfoundation\/algokit-utils(\/.*)?$/,
    replacement: 'algokit-utils-stock$1',
  },
]

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/**/*.spec.ts'] } },
      // build.spec.ts doesn't use algokit-utils, and two projects writing its output at once race: run it once
      {
        extends: true,
        resolve: { alias: stockUtils },
        test: { name: 'unit-stock-utils', include: ['test/**/*.spec.ts'], exclude: ['test/build.spec.ts', '**/node_modules/**'] },
      },
      // against live nodes: LocalNet (ALGOD_SERVER, a stock algod) and a MainNet dtalgorand node (DT_ALGOD_SERVER)
      { extends: true, test: { name: 'live', include: ['test/**/*.live.ts'], testTimeout: 120_000, hookTimeout: 60_000 } },
      {
        extends: true,
        resolve: { alias: stockUtils },
        test: { name: 'live-stock-utils', include: ['test/**/*.live.ts'], testTimeout: 120_000, hookTimeout: 60_000 },
      },
    ],
  },
})
