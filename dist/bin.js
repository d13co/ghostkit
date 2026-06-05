#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const build_1 = require("./build");
const { version } = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(__dirname, "../package.json"), "utf8"));
const [command, ...rest] = process.argv.slice(2);
(async () => {
    switch (command) {
        case "build":
            if (rest.length !== 0) {
                let failures = 0;
                for (const appSpecPath of rest) {
                    try {
                        process.stderr.write(`[Ghostkit] Building ${appSpecPath}... `);
                        const path = await (0, build_1.buildGhostSDK)(appSpecPath);
                        process.stderr.write(`OK\n[Ghostkit] Built to: ${path}\n\n`);
                    }
                    catch (e) {
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

    ghostkit build a.arc56.json [b.arc56.json]
`);
            process.exit(command === "help" ? 0 : 1);
    }
})();
//# sourceMappingURL=bin.js.map