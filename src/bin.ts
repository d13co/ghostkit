#!/usr/bin/env node

import { readFileSync } from "fs";
import { join } from "path";
import { buildGhostSDK } from "./build";
import { checkProjectGhostkit } from "./version-check";

const { version } = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as { version: string };

const [command, ...args] = process.argv.slice(2);
const anyVersion = args.includes("--any-version");
const rest = args.filter((arg) => arg !== "--any-version");

(async () => {
  switch (command) {
    case "build":
      if (rest.length !== 0) {
        const mismatch = anyVersion ? undefined : checkProjectGhostkit({ cwd: process.cwd(), self: { version, dir: join(__dirname, "..") } });
        if (mismatch) {
          process.stderr.write(`[Ghostkit] error: ${mismatch} (--any-version skips this check.)\n`);
          process.exit(1);
        }
        let failures = 0;
        for (const appSpecPath of rest) {
          try {
            process.stderr.write(`[Ghostkit] Building ${appSpecPath}... `);
            const path = await buildGhostSDK(appSpecPath);
            process.stderr.write(`OK\n[Ghostkit] Built to: ${path}\n\n`);
          } catch (e) {
            failures += 1;
            process.stderr.write(`ERR\n\n`);
            console.error(e);
          }
        }
        process.exit(failures === 0 ? 0 : 1);
      }
    // fall through to help when `build` is given no arguments
    default:
      process.stderr.write(`Ghostkit v${version}

Supported commands:

    ghostkit build a.arc56.json [b.arc56.json] [--any-version]

Run it as the project's copy: npm exec ghostkit (pnpm exec ghostkit, yarn ghostkit). It refuses to build when it isn't
the ghostkit the project's package.json depends on; --any-version builds anyway.
`);
      process.exit(command === "help" ? 0 : 1);
  }
})();
