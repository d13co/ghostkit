import { ABIMethod, ABIType, base64ToBytes } from "algosdk";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { generateClient } from "./generate-client";
import { loadApplicationJson } from "@algorandfoundation/algokit-client-generator";
import { Arc56Contract } from "@algorandfoundation/algokit-utils/types/app-arc56";
import { camelCase } from "change-case";
import { GHOSTKIT_RESERVED_MEMBERS, GhostkitChunkOptions, GhostkitMeta } from "./templates/runtime";

const templatesBaseDir = join(__dirname, "templates");

/** Bytes per program page (consensus `MaxAppProgramLen`). */
const PAGE_BYTES = 2048;
/** Most extra program pages: 3 before consensus v42, 7 from v42 (beyond 3 for a fee surcharge). */
const MAX_EXTRA_PAGES = 7;
const FREE_EXTRA_PAGES = 3;

function getTemplate(filename: string) {
  return readFileSync(join(templatesBaseDir, filename)).toString();
}

function unexportClient(client: string, name: string) {
  return client.replace(`export class ${name}Client`, `class ${name}Client`).replace(`export class ${name}Factory`, `class ${name}Factory`);
}

const replaceInvalidWithUnderscore = (value: string) => value.replace(/[^a-z0-9_$]+/gi, "_");

export function makeSafeMethodIdentifier(value: string) {
  const options = value.startsWith("_") ? { prefixCharacters: "_" } : {};
  return camelCase(replaceInvalidWithUnderscore(value), options);
}

/** Reads the AVM version: the varuint at the start of a program. */
export function readProgramVersion(program: Uint8Array): number {
  let version = 0;
  for (let i = 0, shift = 0; i < program.length && i < 9; i++, shift += 7) {
    version += (program[i] & 0x7f) * 2 ** shift;
    if ((program[i] & 0x80) === 0) return version;
  }
  throw new Error("the approval program has no valid version");
}

/** Facts about the ghost program that the SDK needs at runtime. */
export function getGhostMeta(appSpec: Arc56Contract, warn: (message: string) => void = () => {}): GhostkitMeta {
  if (!appSpec.byteCode) throw new Error(`${appSpec.name}: the ARC-56 spec has no byteCode; compile the contract so that it is included`);
  const approval = base64ToBytes(appSpec.byteCode.approval);
  const clear = base64ToBytes(appSpec.byteCode.clear);
  const extraProgramPages = Math.max(0, Math.ceil((approval.length + clear.length) / PAGE_BYTES) - 1);
  if (extraProgramPages > MAX_EXTRA_PAGES) {
    throw new Error(
      `${appSpec.name}: the programs are ${approval.length + clear.length} bytes, more than the ${(MAX_EXTRA_PAGES + 1) * PAGE_BYTES} an app can hold`,
    );
  }
  const avmVersion = readProgramVersion(approval);
  if (extraProgramPages > FREE_EXTRA_PAGES) {
    warn(`${appSpec.name}: ${extraProgramPages} extra program pages need consensus v42 (AVM 13 networks) and cost a fee surcharge`);
  }
  return { avmVersion, extraProgramPages, approvalBytes: approval.length, clearBytes: clear.length };
}

const CHUNK_TAG = /@ghostkit-chunk\s+([A-Za-z_$][\w$]*)((?:\s+\w+=\d+)*)/;
const CHUNK_KEYS = ["refsPerItem", "maxPerTxn", "maxPerGroup", "maxArgBytes"] as const;

/**
 * Reads a method's default chunking from its description: `@ghostkit-chunk <arg> [refsPerItem=N] [maxPerTxn=N]
 * [maxPerGroup=N] [maxArgBytes=N]`.
 */
export function parseChunkTag(method: Arc56Contract["methods"][number]): GhostkitChunkOptions | undefined {
  const match = method.desc?.match(CHUNK_TAG);
  if (!match) return undefined;
  const chunk: GhostkitChunkOptions = { arg: match[1] };
  for (const pair of match[2].trim().split(/\s+/).filter(Boolean)) {
    const [key, value] = pair.split("=");
    if (!(CHUNK_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Method ${method.name}: unknown @ghostkit-chunk option ${key} (expected ${CHUNK_KEYS.join(", ")})`);
    }
    chunk[key as (typeof CHUNK_KEYS)[number]] = Number(value);
  }
  const arg = method.args.find((a) => a.name === chunk.arg);
  if (!arg) throw new Error(`Method ${method.name}: @ghostkit-chunk names ${chunk.arg}, which is not one of its arguments`);
  if (!arg.type.endsWith("[]")) throw new Error(`Method ${method.name}: @ghostkit-chunk argument ${chunk.arg} is ${arg.type}, not a dynamic array`);
  if (ABIType.from(arg.type.slice(0, -2)).isDynamic() && chunk.maxPerTxn === undefined) {
    throw new Error(`Method ${method.name}: the items of ${chunk.arg} vary in size, so @ghostkit-chunk needs maxPerTxn=N`);
  }
  return chunk;
}

/** The method's description as a doc comment, without ghostkit tags. */
function methodDoc(method: Arc56Contract["methods"][number]) {
  const desc = method.desc?.replace(CHUNK_TAG, "").trim();
  if (!desc) return "";
  const lines = desc.replace(/\*\//g, "*\\/").split("\n");
  return `  /**\n${lines.map((l) => `   * ${l}`.trimEnd()).join("\n")}\n   */\n`;
}

export async function buildGhostSDK(
  appSpecPath: string,
  { warn = (m: string) => void process.stderr.write(`[Ghostkit] warning: ${m}\n`) }: { warn?: (message: string) => void } = {},
) {
  const appSpec = await loadApplicationJson(appSpecPath);
  const meta = getGhostMeta(appSpec, warn);
  const client = await generateClient(appSpec);

  const runtime = getTemplate("runtime.ts");
  const template = getTemplate("index.ts.template");
  const methodTemplate = getTemplate("method.ts.template");

  const { name, methods } = appSpec;

  const methodPieces: string[] = [];
  const seen = new Map<string, string>();
  for (const method of methods) {
    const supportsCreate = method.actions.create.includes("NoOp");
    if (!supportsCreate) {
      throw new Error(
        `Method ${method.name} does not support creation calls. Decorate it with \`@abimethod({ readonly: true, onCreate: 'allow' })\``,
      );
    }
    if (!method.readonly) {
      throw new Error(`Method ${method.name} is not readonly. Decorate it with \`@abimethod({ readonly: true, onCreate: 'allow' })\``);
    }

    const methodName = method.name;
    const methodSignature = new ABIMethod(method).getSignature();
    const safeMethodName = makeSafeMethodIdentifier(methodName);
    if (GHOSTKIT_RESERVED_MEMBERS.includes(safeMethodName) || safeMethodName.startsWith("_gk")) {
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
  const final = [unexportClient(client, name), runtime, sdk].join("\n");

  const outputFilepath = join(dirname(appSpecPath), `${name}SDK.ts`);
  writeFileSync(outputFilepath, final);

  return outputFilepath;
}
