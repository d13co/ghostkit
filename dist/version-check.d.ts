/** The ghostkit version a dependency spec pins exactly ("0.1.0-dt.8", "npm:ghostkit@0.1.0-dt.8"), else undefined. */
export declare function exactGhostkitVersion(spec: string): string | undefined;
/**
 * Checks that this ghostkit (`self`) is the version the project in `cwd` depends on, and returns why not. A missing or
 * failed install leaves `npx ghostkit` running another copy (a global one, or an old version from npm's cache), which
 * would quietly generate an SDK for that version's runtime. The project is the nearest package.json, from `cwd` up,
 * that depends on ghostkit; with none, or in ghostkit itself, there is nothing to check.
 */
export declare function checkProjectGhostkit({ cwd, self }: {
    cwd: string;
    self: {
        version: string;
        dir: string;
    };
}): string | undefined;
