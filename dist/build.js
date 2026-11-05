"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSafeMethodIdentifier = makeSafeMethodIdentifier;
exports.readProgramVersion = readProgramVersion;
exports.getGhostMeta = getGhostMeta;
exports.parseChunkTag = parseChunkTag;
exports.buildGhostSDK = buildGhostSDK;
const algosdk_1 = require("algosdk");
const fs_1 = require("fs");
const path_1 = require("path");
const generate_client_1 = require("./generate-client");
const algokit_client_generator_1 = require("@algorandfoundation/algokit-client-generator");
const change_case_1 = require("change-case");
const runtime_1 = require("./templates/runtime");
const templatesBaseDir = (0, path_1.join)(__dirname, "templates");
const { version: GHOSTKIT_VERSION } = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(__dirname, "../package.json"), "utf8"));
/** Bytes per program page (consensus `MaxAppProgramLen`). */
const PAGE_BYTES = 2048;
/** Most extra program pages: 3 before consensus v42, 7 from v42 (beyond 3 for a fee surcharge). */
const MAX_EXTRA_PAGES = 7;
const FREE_EXTRA_PAGES = 3;
function getTemplate(filename) {
    return (0, fs_1.readFileSync)((0, path_1.join)(templatesBaseDir, filename)).toString();
}
function unexportClient(client, name) {
    return client.replace(`export class ${name}Client`, `class ${name}Client`).replace(`export class ${name}Factory`, `class ${name}Factory`);
}
const replaceInvalidWithUnderscore = (value) => value.replace(/[^a-z0-9_$]+/gi, "_");
function makeSafeMethodIdentifier(value) {
    const options = value.startsWith("_") ? { prefixCharacters: "_" } : {};
    return (0, change_case_1.camelCase)(replaceInvalidWithUnderscore(value), options);
}
/** Reads the AVM version: the varuint at the start of a program. */
function readProgramVersion(program) {
    let version = 0;
    for (let i = 0, shift = 0; i < program.length && i < 9; i++, shift += 7) {
        version += (program[i] & 0x7f) * 2 ** shift;
        if ((program[i] & 0x80) === 0)
            return version;
    }
    throw new Error("the approval program has no valid version");
}
/** Facts about the ghost program that the SDK needs at runtime. */
function getGhostMeta(appSpec, warn = () => { }) {
    if (!appSpec.byteCode)
        throw new Error(`${appSpec.name}: the ARC-56 spec has no byteCode; compile the contract so that it is included`);
    const approval = (0, algosdk_1.base64ToBytes)(appSpec.byteCode.approval);
    const clear = (0, algosdk_1.base64ToBytes)(appSpec.byteCode.clear);
    const extraProgramPages = Math.max(0, Math.ceil((approval.length + clear.length) / PAGE_BYTES) - 1);
    if (extraProgramPages > MAX_EXTRA_PAGES) {
        throw new Error(`${appSpec.name}: the programs are ${approval.length + clear.length} bytes, more than the ${(MAX_EXTRA_PAGES + 1) * PAGE_BYTES} an app can hold`);
    }
    const avmVersion = readProgramVersion(approval);
    if (extraProgramPages > FREE_EXTRA_PAGES) {
        warn(`${appSpec.name}: ${extraProgramPages} extra program pages need consensus v42 (AVM 13 networks) and cost a fee surcharge`);
    }
    return { avmVersion, extraProgramPages, approvalBytes: approval.length, clearBytes: clear.length };
}
// optionally in backticks: puya-ts drops JSDoc tags from a method's description, but keeps inline code
const CHUNK_TAG = /`?@ghostkit-chunk\s+([A-Za-z_$][\w$]*)((?:\s+\w+=\d+)*)`?/;
const CHUNK_KEYS = ["refsPerItem", "maxPerTxn", "maxPerGroup", "maxArgBytes"];
/**
 * Reads a method's default chunking from its description: `@ghostkit-chunk <arg> [refsPerItem=N] [maxPerTxn=N]
 * [maxPerGroup=N] [maxArgBytes=N]`, written as is or in backticks.
 */
function parseChunkTag(method) {
    const match = method.desc?.match(CHUNK_TAG);
    if (!match)
        return undefined;
    const chunk = { arg: match[1] };
    for (const pair of match[2].trim().split(/\s+/).filter(Boolean)) {
        const [key, value] = pair.split("=");
        if (!CHUNK_KEYS.includes(key)) {
            throw new Error(`Method ${method.name}: unknown @ghostkit-chunk option ${key} (expected ${CHUNK_KEYS.join(", ")})`);
        }
        chunk[key] = Number(value);
    }
    const arg = method.args.find((a) => a.name === chunk.arg);
    if (!arg)
        throw new Error(`Method ${method.name}: @ghostkit-chunk names ${chunk.arg}, which is not one of its arguments`);
    if (!arg.type.endsWith("[]"))
        throw new Error(`Method ${method.name}: @ghostkit-chunk argument ${chunk.arg} is ${arg.type}, not a dynamic array`);
    if (algosdk_1.ABIType.from(arg.type.slice(0, -2)).isDynamic() && chunk.maxPerTxn === undefined) {
        throw new Error(`Method ${method.name}: the items of ${chunk.arg} vary in size, so @ghostkit-chunk needs maxPerTxn=N`);
    }
    return chunk;
}
/** The method's description as a doc comment, without ghostkit tags. */
function methodDoc(method) {
    const desc = method.desc?.replace(CHUNK_TAG, "").trim();
    if (!desc)
        return "";
    const lines = desc.replace(/\*\//g, "*\\/").split("\n");
    return `  /**\n${lines.map((l) => `   * ${l}`.trimEnd()).join("\n")}\n   */\n`;
}
async function buildGhostSDK(appSpecPath, { warn = (m) => void process.stderr.write(`[Ghostkit] warning: ${m}\n`) } = {}) {
    const appSpec = await (0, algokit_client_generator_1.loadApplicationJson)(appSpecPath);
    const meta = getGhostMeta(appSpec, warn);
    const client = await (0, generate_client_1.generateClient)(appSpec);
    const runtime = getTemplate("runtime.ts");
    const template = getTemplate("index.ts.template");
    const methodTemplate = getTemplate("method.ts.template");
    const { name, methods } = appSpec;
    const methodPieces = [];
    const seen = new Map();
    for (const method of methods) {
        const supportsCreate = method.actions.create.includes("NoOp");
        if (!supportsCreate) {
            throw new Error(`Method ${method.name} does not support creation calls. Decorate it with \`@abimethod({ readonly: true, onCreate: 'allow' })\``);
        }
        if (!method.readonly) {
            throw new Error(`Method ${method.name} is not readonly. Decorate it with \`@abimethod({ readonly: true, onCreate: 'allow' })\``);
        }
        const methodName = method.name;
        const methodSignature = new algosdk_1.ABIMethod(method).getSignature();
        const safeMethodName = makeSafeMethodIdentifier(methodName);
        if (runtime_1.GHOSTKIT_RESERVED_MEMBERS.includes(safeMethodName) || safeMethodName.startsWith("_gk")) {
            throw new Error(`Method ${methodName}: ${safeMethodName} is a member of every ghostkit SDK; rename the method`);
        }
        if (seen.has(safeMethodName)) {
            throw new Error(`Methods ${seen.get(safeMethodName)} and ${methodSignature} would both be ${safeMethodName}; ghostkit doesn't support overloads`);
        }
        seen.set(safeMethodName, methodSignature);
        const chunk = parseChunkTag(method);
        const methodString = methodTemplate
            .replace(/\{\{METHOD_DOC\}\}/g, () => methodDoc(method))
            .replace(/\{\{METHOD_CHUNK\}\}/g, () => (chunk ? `, chunk: ${JSON.stringify(chunk)}` : ""))
            .replace(/\{\{ORIGINAL_METHOD_NAME\}\}/g, () => methodName)
            .replace(/\{\{SAFE_METHOD_NAME\}\}/g, () => safeMethodName)
            .replace(/\{\{METHOD_SIGNATURE\}\}/g, () => methodSignature)
            .replace(/\{\{ARC56_NAME\}\}/g, () => name);
        methodPieces.push(methodString);
    }
    const sdk = template
        .replace(/\{\{ARC56_NAME\}\}/g, () => name)
        .replace(/\{\{GHOST_META\}\}/g, () => JSON.stringify(meta))
        .replace(/\{\{METHODS\}\}/g, () => methodPieces.join("\n\n"));
    // the version that generated the SDK, since its runtime is that version's
    const final = [`// Generated by ghostkit ${GHOSTKIT_VERSION}. DO NOT MODIFY IT BY HAND.`, unexportClient(client, name), runtime, sdk].join("\n");
    const outputFilepath = (0, path_1.join)((0, path_1.dirname)(appSpecPath), `${name}SDK.ts`);
    (0, fs_1.writeFileSync)(outputFilepath, final);
    return outputFilepath;
}
//# sourceMappingURL=build.js.map