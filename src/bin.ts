#!/usr/bin/env node

import { buildGhostSDK } from "./build";

const [command, ...rest] = process.argv.slice(2);

(async () => {
  switch (command) {
    case "build":
      for (const appSpecPath of rest) {
        try {
          process.stderr.write(`[Ghostkit] Building ${appSpecPath}... `);
          const path = await buildGhostSDK(appSpecPath);
          process.stderr.write(`OK\n[Ghostkit] Built to: ${path}\n\n`);
        } catch (e) {
          process.stderr.write(`ERR\n\n`);
          console.error(e);
        }
      }
      if (rest.length !== 0) {
        break
      }
    default:
      process.stderr.write(`Ghostkit v0.0.0

Supported commands:

    ghostkit build a.arc56.json [b.arc56.json]
`);
      process.exit(command === "help" ? 0 : 1);
  }
})();
