import { Arc56Contract } from "@algorandfoundation/algokit-utils/types/app-arc56";
import { GhostkitChunkOptions, GhostkitMeta } from "./templates/runtime";
export declare function makeSafeMethodIdentifier(value: string): string;
/** Reads the AVM version: the varuint at the start of a program. */
export declare function readProgramVersion(program: Uint8Array): number;
/** Facts about the ghost program that the SDK needs at runtime. */
export declare function getGhostMeta(appSpec: Arc56Contract, warn?: (message: string) => void): GhostkitMeta;
/**
 * Reads a method's default chunking from its description: `@ghostkit-chunk <arg> [refsPerItem=N] [maxPerTxn=N]
 * [maxPerGroup=N] [maxArgBytes=N]`, written as is or in backticks.
 */
export declare function parseChunkTag(method: Arc56Contract["methods"][number]): GhostkitChunkOptions | undefined;
export declare function buildGhostSDK(appSpecPath: string, { warn }?: {
    warn?: (message: string) => void;
}): Promise<string>;
