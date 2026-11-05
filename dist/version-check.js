"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exactGhostkitVersion = exactGhostkitVersion;
exports.checkProjectGhostkit = checkProjectGhostkit;
const fs_1 = require("fs");
const path_1 = require("path");
const readJson = (path) => JSON.parse((0, fs_1.readFileSync)(path, "utf8"));
const realpath = (path) => {
    try {
        return (0, fs_1.realpathSync)(path);
    }
    catch {
        return path;
    }
};
/** The ghostkit version a dependency spec pins exactly ("0.1.0-dt.8", "npm:ghostkit@0.1.0-dt.8"), else undefined. */
function exactGhostkitVersion(spec) {
    return /^(?:npm:ghostkit@)?=?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(spec.trim())?.[1];
}
/**
 * Checks that this ghostkit (`self`) is the version the project in `cwd` depends on, and returns why not. A missing or
 * failed install leaves `npx ghostkit` running another copy (a global one, or an old version from npm's cache), which
 * would quietly generate an SDK for that version's runtime. The project is the nearest package.json, from `cwd` up,
 * that depends on ghostkit; with none, or in ghostkit itself, there is nothing to check.
 */
function checkProjectGhostkit({ cwd, self }) {
    let dir = cwd;
    for (;;) {
        const path = (0, path_1.join)(dir, "package.json");
        if ((0, fs_1.existsSync)(path)) {
            const pkg = readJson(path);
            if (pkg.name === "ghostkit")
                return undefined;
            const spec = pkg.dependencies?.ghostkit ?? pkg.devDependencies?.ghostkit ?? pkg.optionalDependencies?.ghostkit;
            if (spec !== undefined)
                return checkAgainst(dir, spec, self);
        }
        const parent = (0, path_1.dirname)(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
}
function checkAgainst(project, spec, self) {
    const where = (0, path_1.relative)(process.cwd(), (0, path_1.join)(project, "package.json")) || "package.json";
    const run = "Run the project's copy with `npm exec ghostkit` (or `pnpm exec ghostkit`, `yarn ghostkit`), not `npx`, which falls back to another copy";
    let installed;
    try {
        installed = require.resolve("ghostkit/package.json", { paths: [project] });
    }
    catch {
        // not installed
    }
    const pinned = exactGhostkitVersion(spec);
    if (!installed) {
        // the version the project pins generates the same SDK from any copy
        if (pinned === self.version)
            return undefined;
        return `${where} depends on ghostkit ${spec}, but it isn't installed there (did the install fail?), so this is another ghostkit: ${self.version} at ${self.dir}. Install the project's dependencies, then build again. ${run}.`;
    }
    const installedDir = (0, path_1.dirname)(installed);
    const version = readJson(installed).version;
    // another copy of the same version generates the same SDK
    if (realpath(installedDir) !== realpath(self.dir) && version !== self.version) {
        return `this is ghostkit ${self.version} at ${self.dir}, but ${where} uses ghostkit ${version} at ${installedDir}. ${run}.`;
    }
    if (pinned && pinned !== self.version) {
        return `${where} pins ghostkit ${pinned}, but ${self.version} is installed. Install the project's dependencies, then build again.`;
    }
    return undefined;
}
//# sourceMappingURL=version-check.js.map