/* BEGIN GHOSTKIT RUNTIME */
// Shared by every ghostkit SDK: ghostkit inlines this file into each SDK it generates, after the algokit-generated
// typed client. It must only import algosdk and algokit-utils, under names that can't clash with the generated client
// (exports start with `Ghostkit`/`GHOSTKIT_`, private names with `gk`). It runs on stock algokit-utils and algosdk, and
// uses the dtalgorand forks' read-only queries (POST /v2/query) or extended simulate when they and the node support them.

import type { AlgorandClient as GkAlgorandClient } from '@algorandfoundation/algokit-utils/types/algorand-client'
import { AlgoAmount as GkAlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import {
  getABIDecodedValue as gkDecodeValue,
  getABIEncodedValue as gkEncodeValue,
  type Arc56Contract as GkArc56Contract,
} from '@algorandfoundation/algokit-utils/types/app-arc56'
import {
  TransactionComposer as GkTransactionComposer,
  type AppCallMethodCall as GkAppCallMethodCall,
  type CommonAppCallParams as GkCommonAppCallParams,
  type RawSimulateOptions as GkRawSimulateOptions,
} from '@algorandfoundation/algokit-utils/types/composer'
import * as gkAlgosdk from 'algosdk'

/** A round number. */
export type GhostkitRound = number | bigint

/** Extra app call parameters for each ghost call: fees, validity, note, lease, references. */
export type GhostkitExtraMethodCallArgs = Omit<GkCommonAppCallParams, 'appId' | 'sender' | 'method' | 'args' | 'onComplete'>

/** Simulate options. They are spread over the defaults (`extraOpcodeBudget: 170_000`, `allowMoreLogging`, `allowUnnamedResources`). */
export type GhostkitSimulateOptions = Omit<GkRawSimulateOptions, 'allowEmptySignatures' | 'fixSigners'> & {
  /**
   * dtalgorand nodes only: simulate under a later consensus protocol (`v24`..`v43`, `latest`, `future` or a version
   * string), as if an upgrade took effect right after the round. Defaults to `latest` at past rounds, since a ghost's
   * AVM version is usually newer than old rounds allow (a no-op at rounds already on the latest protocol); `null`
   * simulates each round under its own protocol.
   */
  protocol?: string | null
  /**
   * Cancels the call's requests; the call rejects with the signal's reason, whatever the backend. Shared reads (limits,
   * suggested params, the fee sink, the reader's balance) carry on for other callers.
   */
  signal?: AbortSignal
}

/** Options for simulating at several rounds. */
export type GhostkitRoundsOptions = Omit<GhostkitSimulateOptions, 'round'> & {
  /**
   * dtalgorand nodes only: how the node treats the transactions' validity window at each round. `rewrite` (default)
   * moves it to each simulated round, so rounds any distance apart share a request and programs (e.g. `block`) see
   * each round as the current one. `skip` evaluates the transactions as built. `null` uses neither, so the rounds of a
   * request must be within 1,000 rounds of each other.
   */
  validityWindow?: 'skip' | 'rewrite' | null
}

/**
 * Splits one call's array argument into several app calls, and several groups if needed, sized to the node's limits.
 * The method must log one result per item, in order, and treat each item independently of the others.
 */
export type GhostkitChunkOptions = {
  /** The name of the dynamic array argument to split. */
  arg: string
  /** Unnamed resources (accounts, assets, apps, boxes, holdings) each item makes the method touch; default 1. */
  refsPerItem?: number
  /** At most this many items per app call. */
  maxPerTxn?: number
  /** At most this many items per group, e.g. to stay within the opcode budget. */
  maxPerGroup?: number
  /**
   * The most app argument bytes per app call, all arguments together. Defaults to 16,384 for a ghost that needs
   * consensus v42, else 4,096 (beyond 2,048 bytes costs a small fee surcharge, which the fee budget covers; set 2,048
   * to avoid it). The chunked array is one argument, so it also stays within 4,096 bytes, the limit for any one argument.
   */
  maxArgBytes?: number
}

/** The input of a generated SDK method. */
export type GhostkitMethodInput<TArgs> = {
  /** The method's arguments, or a list of them: one app call each, in one group. */
  methodArgsOrArgsArray: TArgs | TArgs[]
  /** Extra app call parameters, for every app call or one per entry of `methodArgsOrArgsArray`. */
  extraMethodCallArgs?: GhostkitExtraMethodCallArgs | GhostkitExtraMethodCallArgs[]
  /** Simulate options for this call. Inside `batch` and `atRounds`, pass them to those instead. */
  extraSimulateArgs?: GhostkitSimulateOptions
  /** Split an array argument across app calls and groups (see `GhostkitChunkOptions`); `false` turns off the method's default. */
  chunk?: GhostkitChunkOptions | false
}

/** The simulate limits of a node. */
export type GhostkitSimulateLimits = {
  /** Most groups per simulate request. */
  maxTxnGroups: number
  /** Most rounds per simulate request; 0 when the node can't simulate several rounds per request. */
  maxRounds: number
  /** Most extra opcode budget per group. */
  maxExtraOpcodeBudget: number
  /** The factor on the consensus limits on unnamed resources. */
  resourceLimitMultiplier: number
  /** Whether any round since genesis can be simulated; otherwise only the last few (usually 4). */
  timeTravel: boolean
  /** Whether `protocol: 'future'` and execution traces are allowed. */
  developerApi: boolean
}

/** The query limits of a dtalgorand node with queries (`POST /v2/query`). */
export type GhostkitQueryLimits = {
  /** Most calls per query request. */
  maxCalls: number
  /** Most rounds per query request. */
  maxRounds: number
  /** The most opcode budget of each call, which each call gets by default. */
  maxCallBudget: number
  /** The most log bytes of each call; 0 for the consensus limits (1,024 bytes, 32 logs). */
  maxCallLogBytes: number
  /** The most bytes of ledger state each call may read; 0 for no limit. A call that reads more fails on its own. */
  maxCallStateBytes: number
  /** The most bytes of a response's logs and errors; 0 for no limit. */
  maxResponseBytes: number
}

/**
 * What ghostkit found about the node and libraries: `dt` when the dtalgorand forks are loaded and the node is a
 * dtalgorand node, with `query` when the node has queries on.
 */
export type GhostkitNode =
  | { kind: 'dt'; limits: GhostkitSimulateLimits; query?: GhostkitQueryLimits }
  | { kind: 'stock'; limits: GhostkitSimulateLimits; reason: string }

/** The limits of a stock algod's simulate. */
export const GHOSTKIT_STOCK_LIMITS: GhostkitSimulateLimits = Object.freeze({
  maxTxnGroups: 1,
  maxRounds: 0,
  maxExtraOpcodeBudget: 320_000,
  resourceLimitMultiplier: 1,
  timeTravel: false,
  developerApi: false,
})

/** The limits of a dtalgorand node with its default config: the default of `ghostkitDTBackend` and `ghostkitQueryBackend`. */
export const GHOSTKIT_DT_DEFAULT_LIMITS: GhostkitSimulateLimits = Object.freeze({
  maxTxnGroups: 16,
  maxRounds: 16,
  maxExtraOpcodeBudget: 320_000,
  resourceLimitMultiplier: 1,
  timeTravel: true,
  developerApi: false,
})

/** How a `protocol` override applied at a round. */
export type GhostkitProtocolOverride = {
  from: string
  to: string
  applied: boolean
  notes?: { code: string; message: string }[]
}

/** The outcome of one simulated group: the logs of each of its transactions, or why it failed. */
export type GhostkitGroupOutcome =
  | {
      ok: true
      logs: Uint8Array[][]
      /** simulate: the group's fee usage, in millionths of the minimum fee */
      groupUsage?: number
      /** query: the opcode budget the group's app calls used */
      cost?: number
      protocolOverride?: GhostkitProtocolOverride
    }
  | { ok: false; error: Error; protocolOverride?: GhostkitProtocolOverride }

/** The outcomes of the groups at one round. */
export type GhostkitRoundOutcome = { round: bigint; groups: GhostkitGroupOutcome[]; protocolOverride?: GhostkitProtocolOverride }

/** A ghost group, built on demand: valid in `validity` if given (unless its calls set their own), else as composed by default. */
export type GhostkitGroup = (validity?: { firstValidRound: bigint; lastValidRound: bigint }) => Promise<GkTransactionComposer>

/** Request-level simulate options as backends get them. */
export type GhostkitRequestOptions = Omit<GhostkitSimulateOptions, 'round' | 'protocol'> & { protocol?: string }

/**
 * Runs ghost simulates. ghostkit picks `ghostkitQueryBackend`, `ghostkitDTBackend` or `ghostkitStockBackend`; pass
 * your own to the SDK constructor's `backend` to change how simulates are sent.
 */
export interface GhostkitBackend {
  readonly name: string
  readonly limits: GhostkitSimulateLimits
  /** Simulates independent groups at `round` (the latest when undefined); one outcome per group, in order. */
  simulate(groups: GhostkitGroup[], options: GhostkitRequestOptions & { round?: bigint }): Promise<GhostkitGroupOutcome[]>
  /** Simulates the same independent groups at each round; one entry per round, in order. */
  simulateRounds(
    groups: GhostkitGroup[],
    rounds: bigint[],
    options: GhostkitRequestOptions & { validityWindow?: 'skip' | 'rewrite' },
  ): Promise<GhostkitRoundOutcome[]>
}

/** Facts about a ghost program, written by ghostkit when it generates the SDK. */
export type GhostkitMeta = {
  avmVersion: number
  extraProgramPages: number
  approvalBytes: number
  clearBytes: number
}

/** A failed ghost call. */
export class GhostkitError extends Error {
  /** The method, or `batch(...)` */
  readonly method: string
  /** The round simulated at, if not the latest */
  readonly round?: bigint
  /** The path of the failed transaction, if a group failed */
  readonly failedAt?: number[]
  /** The node's failure message, if a group failed */
  readonly failureMessage?: string

  constructor(method: string, round: bigint | undefined, cause: unknown, hint?: string) {
    const c = cause as { message?: string; failedAt?: number[]; failureMessage?: string } | undefined
    super(
      `ghostkit: ${method} failed${round !== undefined ? ` at round ${round}` : ''}: ${c?.message ?? String(cause)}${hint ? ` (${hint})` : ''}`,
    )
    // set by hand: the Error constructor's `cause` option needs the ES2022 lib, which SDK users may not have
    ;(this as { cause?: unknown }).cause = cause
    this.name = 'GhostkitError'
    this.method = method
    this.round = round
    this.failedAt = c?.failedAt
    this.failureMessage = c?.failureMessage
  }
}

/** The result of a call (or calls) at one round. */
export type GhostkitRoundResult<V> = { round: bigint; protocolOverride?: GhostkitProtocolOverride } & (
  | { ok: true; value: V }
  | { ok: false; error: GhostkitError }
)

/** Parameters of a generated SDK's constructor. */
export type GhostkitSDKParams = {
  algorand: GkAlgorandClient
  /**
   * The account the ghost calls are sent from. Defaults to the network's fee sink, which is funded at every round. On a
   * node with queries it needn't be funded: queries check no fees or balances.
   */
  readerAccount?: string
  /** Call this deployed app instead of creating the ghost on the fly. */
  ghostAppId?: bigint
  /**
   * Milliseconds that calls at the latest round reuse suggested params for (default 3,000), shared by every SDK on the
   * same AlgorandClient; 0 to fetch them for every call. They come through the AlgorandClient, so its own cache applies
   * too, and ghostkit never changes it. Calls at past rounds reuse params of any age: they set their own validity.
   */
  cacheParamsTimeout?: number
  /** Log diagnostics of each call. */
  debug?: boolean
  /**
   * How to run ghost calls. With algokit-utils and algosdk the dtalgorand forks, `auto` (default) uses read-only queries
   * (`POST /v2/query`) when the node has them, with dtalgorand's extended simulate for calls that need simulate (see the
   * README), and the extended simulate on a dtalgorand node with queries off; else one simulate per group. `query`
   * always queries, and throws for calls that need simulate and on a node without queries. `dt` always uses the
   * extended simulate, and throws on stock algod. `stock` never uses either; or pass your own `GhostkitBackend`.
   */
  backend?: 'auto' | 'query' | 'dt' | 'stock' | GhostkitBackend
  /**
   * What each group pays in fees when it is simulated; queries check no fees, so this only applies on simulate.
   * Simulate checks fees, and a group's needs aren't known before it runs: consensus v42
   * charges for large programs and app args, and inner transactions are paid for as the program issues them.
   * - a microAlgo amount (default 1,000,000, 1 Algo): the group's first app call pays this, the others the minimum fee.
   *   Nothing is paid, since the group is only simulated, but the reader must hold it at the round simulated.
   * - `max`: the first app call pays everything the reader can spend at the round simulated (its balance less its
   *   minimum balance and the ghost apps' minimum balance), the others nothing. It never fails for fees unless the
   *   reader couldn't pay them at all, at the cost of reading the reader's balance (cached like suggested params, and
   *   for good at past rounds).
   * - `0`: every app call pays the minimum fee.
   *
   * App calls that set their own `staticFee` or `extraFee` keep them.
   */
  ghostFee?: GhostkitFee
}

/** What each group pays in fees: see `GhostkitSDKParams.ghostFee`. */
export type GhostkitFee = 'max' | bigint | number

/** Members of a ghostkit SDK, which an ABI method of a ghost contract can't be named. Names starting with `_gk` are reserved too. */
export const GHOSTKIT_RESERVED_MEMBERS: readonly string[] = Object.freeze([
  'constructor',
  'algorand',
  'readerAccount',
  'ghostAppId',
  'factory',
  'client',
  'appSpec',
  'cacheParamsTimeout',
  'debug',
  'backend',
  'ghostFee',
  'atRound',
  'atRounds',
  'batch',
  'getNode',
  'prefetch',
  // Object.prototype
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])

/** The fee sinks of MainNet and TestNet by genesis hash, so finding them takes no request. */
const GK_KNOWN_FEE_SINKS: Record<string, string> = {
  'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=': 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA',
  'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=': 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE',
}
/** How long calls at past rounds reuse suggested params: only their genesis and minimum fee matter. */
const GK_PAST_PARAMS_MAX_AGE = 3_600_000
/** The default sender for the public `factory`: the fee sink of LocalNet, TestNet and BetaNet. */
const GK_FALLBACK_READER = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE'
/** Most transactions per group. */
const GK_MAX_GROUP_SIZE = 16
/** The most bytes in any one app argument, under any consensus version. */
const GK_MAX_ARG_BYTES = 4_096
/** Unnamed resources each app call may touch at 1x (consensus `MaxAppTotalTxnReferences`). */
const GK_REFS_PER_TXN = 8
/** The minimum balance an app's creator holds for it, and for each extra page (consensus `AppFlatParamsMinBalance`). */
const GK_APP_MIN_BALANCE = 100_000n
/** The minimum balance per global state entry (`SchemaMinBalancePerEntry` plus `SchemaUintMinBalance` / `SchemaBytesMinBalance`). */
const GK_GLOBAL_UINT_MIN_BALANCE = 28_500n
const GK_GLOBAL_BYTES_MIN_BALANCE = 50_000n
/** The ABI return log prefix. */
const GK_RETURN_PREFIX = [0x15, 0x1f, 0x7c, 0x75]
/** The zero address: a query sent from it runs as the round's fee sink. */
const GK_ZERO_ADDRESS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
/**
 * Suggested params for groups that are only queried: a query ignores fees and validity (each call is valid in the
 * block after the round), so they cost no request.
 */
const GK_QUERY_PARAMS = {
  fee: 0n,
  minFee: 1_000n,
  flatFee: false,
  firstValid: 1n,
  lastValid: 1n,
  genesisID: '',
  genesisHash: new Uint8Array(32),
}
/** The log bytes of an app call with simulate's `allowMoreLogging`. */
const GK_MORE_LOGGING_BYTES = 65_536
/** The opcode budget of each app call of a group (`MaxAppProgramCost`), pooled by simulate. */
const GK_APP_CALL_BUDGET = 700

const gkEmptySigner = gkAlgosdk.makeEmptyTransactionSigner()

type GkAwaitedAll<T> = T extends readonly unknown[] ? { -readonly [K in keyof T]: Awaited<T[K]> } : Awaited<T>

/** The extended simulate of the dtalgorand fork of algokit-utils (`algorand.simulate`), as far as ghostkit uses it. */
type GkDTOutcome = { round: bigint; protocolOverride?: GhostkitProtocolOverride } & (
  | { ok: true; result: { confirmations: { logs?: Uint8Array[] }[]; simulateResponse: GkSimulateResponse } }
  | { ok: false; error: Error }
)
type GkSimulateResponse = {
  txnGroups: { groupUsage?: number; txnResults: { txnResult: unknown }[] }[]
  roundResults?: { txnGroups?: { groupUsage?: number; txnResults: { txnResult: unknown }[] }[] }[]
}
type GkSimulateManager = {
  groups(composers: GkTransactionComposer[], options: Record<string, unknown>): Promise<GkDTOutcome[]>
  rounds(
    composers: GkTransactionComposer[],
    rounds: bigint[],
    options: Record<string, unknown>,
  ): Promise<{ round: bigint; groups: GkDTOutcome[]; protocolOverride?: GhostkitProtocolOverride }[]>
}


/** The queries of the dtalgorand fork of algokit-utils (`algorand.query.run`), as far as ghostkit uses them. */
type GkQueryCall = {
  args?: Uint8Array[]
  accounts?: string[]
  foreignApps?: bigint[]
  foreignAssets?: bigint[]
  boxes?: { app: bigint; name: Uint8Array }[]
}
type GkQuerySchema = { numUint: number; numByteSlice: number }
type GkQueryTarget = {
  program?: Uint8Array
  clearProgram?: Uint8Array
  globalSchema?: GkQuerySchema
  localSchema?: GkQuerySchema
  appId?: bigint
  sender?: string
}
type GkQueryCallOutcome =
  | { ok: true; logs: Uint8Array[]; cost: number }
  | { ok: false; error: Error & { kind?: 'round' | 'call'; failureMessage?: string } }
type GkQueryManager = {
  run(
    params: GkQueryTarget & { rounds?: bigint[]; protocol?: string; calls: GkQueryCall[] },
    options?: { signal?: AbortSignal; concurrency?: number },
  ): Promise<{ round: bigint; protocolOverride?: GhostkitProtocolOverride; calls: GkQueryCallOutcome[] }[]>
}

/** `DTAlgodClient` of dtalgosdk, the dtalgorand fork of algosdk, as far as ghostkit uses it. */
type GkDTAlgodClass = {
  features: readonly string[]
  from(algod: unknown): {
    simulateLimits(): Promise<GkReportedLimits>
    accountInformation(address: string): { exclude(exclude: 'all'): { round(round: bigint): { do(): Promise<GkAccountBalance> } } }
  }
}
/** The balance fields of an algosdk `Account`. */
type GkAccountBalance = { amount: bigint; minBalance: bigint }
/** What `DTAlgodClient.simulateLimits()` returns, as far as ghostkit uses it. */
type GkReportedLimits = GhostkitSimulateLimits & { reported: boolean; query?: GhostkitQueryLimits }

/**
 * `DTAlgodClient` if the loaded algosdk is dtalgosdk, else undefined. Its `features` describe the SDK build, not the
 * node: they only tell dtalgosdk from stock algosdk here.
 */
const gkDTAlgod = (): GkDTAlgodClass | undefined => {
  const dt = (gkAlgosdk as unknown as { DTAlgodClient?: Partial<GkDTAlgodClass> }).DTAlgodClient
  return dt?.features?.includes('simulate-limits') ? (dt as GkDTAlgodClass) : undefined
}

/** The managers the dtalgorand fork of algokit-utils adds to `AlgorandClient`, as far as ghostkit uses them. */
type GkForkUtils = { simulate: GkSimulateManager; query: GkQueryManager; dt: GkDTManager }

/** The fork of algokit-utils' managers if the loaded algokit-utils is the fork (it adds `algorand.simulate`), else undefined. */
const gkForkUtils = (algorand: GkAlgorandClient): GkForkUtils | undefined => {
  const fork = algorand as unknown as Partial<GkForkUtils>
  return fork.simulate ? (fork as GkForkUtils) : undefined
}

const gkStatus = (e: unknown): number | undefined => {
  const err = e as { status?: number; response?: { status?: number } } | undefined
  return err?.status ?? err?.response?.status
}

const gkAsError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

/** The node's message in an HTTP error: its JSON body's `message` if it has one, else the error's message. */
const gkErrorText = (e: unknown): string => {
  const err = e as { message?: string; response?: { body?: { message?: unknown }; text?: string } } | undefined
  const body = err?.response?.body?.message
  if (typeof body === 'string') return body
  try {
    const parsed = err?.response?.text ? (JSON.parse(err.response.text) as { message?: unknown }) : undefined
    if (typeof parsed?.message === 'string') return parsed.message
  } catch {
    // not JSON
  }
  return err?.message ?? String(e)
}

/** Whether a backend runs on a dtalgorand node's extensions (queries or the extended simulate), e.g. `protocol`. */
const gkExtended = (backend: GhostkitBackend) => backend.name === 'dt' || backend.name === 'query'

/** Maps with at most `limit` promises pending at once. */
async function gkMapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Throws the signal's reason if it is aborted (`AbortSignal.throwIfAborted`, which older DOM typings lack). */
function gkThrowIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason
}

/** The validity window for a simulate at `round`: valid only in block round + 1, so `block` can look back the furthest. */
const gkValidityAt = (round: bigint) => ({ firstValidRound: round + 1n, lastValidRound: round + 1n })

/** A dtalgorand node's limits: its simulate limits, and its query limits if it has queries. */
type GkNodeLimits = { simulate: GhostkitSimulateLimits; query?: GhostkitQueryLimits }

/**
 * A dtalgorand node's limits, or `undefined` for stock algod, the only node without them. They come from
 * `DTAlgodClient.simulateLimits()`, which caches them per algod client and is what the fork of algokit-utils reads
 * before each extended simulate and query, so the node is asked once.
 */
async function gkFetchLimits(algorand: GkAlgorandClient): Promise<GkNodeLimits | undefined> {
  const dt = gkDTAlgod()
  if (!dt) return undefined
  const limits = await dt.from(algorand.client.algod).simulateLimits()
  if (!limits.reported) return undefined
  const q = limits.query
  return {
    simulate: {
      maxTxnGroups: limits.maxTxnGroups,
      maxRounds: limits.maxRounds,
      maxExtraOpcodeBudget: limits.maxExtraOpcodeBudget,
      resourceLimitMultiplier: limits.resourceLimitMultiplier,
      timeTravel: limits.timeTravel,
      developerApi: limits.developerApi,
    },
    ...(q
      ? {
          query: {
            maxCalls: q.maxCalls,
            maxRounds: q.maxRounds,
            maxCallBudget: q.maxCallBudget,
            maxCallLogBytes: q.maxCallLogBytes,
            maxCallStateBytes: q.maxCallStateBytes,
            maxResponseBytes: q.maxResponseBytes,
          },
        }
      : {}),
  }
}

/** Why the loaded libraries can't use a dtalgorand node's extensions, or undefined if they can. */
function gkMissingForks(algorand: GkAlgorandClient): string | undefined {
  if (!gkForkUtils(algorand)) return 'the loaded algokit-utils is not the dtalgorand fork'
  if (!gkDTAlgod()) return 'the loaded algosdk is not the dtalgorand fork (dtalgosdk)'
  return undefined
}

/**
 * Finds out whether ghost calls can use dtalgorand's queries or extended simulate: the loaded algokit-utils and algosdk
 * must be the dtalgorand forks, and the node must report its simulate limits (`GET /v2/transactions/simulate/limits`),
 * which every dtalgorand node does and stock algod doesn't. The limits also say which of the node's optional features
 * are on: queries (`query`), several rounds per simulate (`maxRounds`) and time travel (`timeTravel`).
 */
export async function ghostkitDetectNode(algorand: GkAlgorandClient): Promise<GhostkitNode> {
  const stock = (reason: string): GhostkitNode => ({ kind: 'stock', limits: GHOSTKIT_STOCK_LIMITS, reason })
  const missing = gkMissingForks(algorand)
  if (missing) return stock(missing)
  const limits = await gkFetchLimits(algorand)
  if (!limits) return stock('the node is stock algod (it has no simulate limits)')
  return { kind: 'dt', limits: limits.simulate, ...(limits.query ? { query: limits.query } : {}) }
}

/** One simulate request per group, as any algod takes them. */
export function ghostkitStockBackend(algorand: GkAlgorandClient, { concurrency = 8 }: { concurrency?: number } = {}): GhostkitBackend {
  const simulateOne = async (group: GhostkitGroup, options: GhostkitRequestOptions, round?: bigint): Promise<GhostkitGroupOutcome> => {
    try {
      gkThrowIfAborted(options.signal)
      const { protocol, ...raw } = options
      if (protocol) throw new Error(`protocol '${protocol}' needs a dtalgorand node`)
      const composer = await group(round !== undefined ? gkValidityAt(round) : undefined)
      const result = await composer.simulate({ ...raw, skipSignatures: true, ...(round !== undefined ? { round: Number(round) } : {}) })
      return {
        ok: true,
        logs: result.confirmations.map((c) => c.logs ?? []),
        groupUsage: (result.simulateResponse.txnGroups[0] as { groupUsage?: number } | undefined)?.groupUsage,
      }
    } catch (e) {
      // an abort rejects the whole call, as on the other backends, rather than failing this group
      gkThrowIfAborted(options.signal)
      return { ok: false, error: gkAsError(e) }
    }
  }
  return {
    name: 'stock',
    limits: GHOSTKIT_STOCK_LIMITS,
    simulate: (groups, { round, ...options }) => gkMapLimit(groups, concurrency, (g) => simulateOne(g, options, round)),
    simulateRounds: async (groups, rounds, { validityWindow: _ignored, ...options }) => {
      const flat = await gkMapLimit(
        rounds.flatMap((round) => groups.map((group) => ({ round, group }))),
        concurrency,
        ({ round, group }) => simulateOne(group, options, round),
      )
      return rounds.map((round, r) => ({ round, groups: flat.slice(r * groups.length, (r + 1) * groups.length) }))
    },
  }
}

function gkFromDTOutcome(o: GkDTOutcome, protocolOverride?: GhostkitProtocolOverride): GhostkitGroupOutcome {
  const override = o.protocolOverride ?? protocolOverride
  const extra = override ? { protocolOverride: override } : {}
  if (!o.ok) return { ok: false, error: o.error, ...extra }
  const { confirmations, simulateResponse } = o.result
  // the group's usage is on its entry in the response, found by its first transaction's result
  const first = (confirmations[0] as unknown) ?? null
  const all = [...(simulateResponse.txnGroups ?? []), ...(simulateResponse.roundResults ?? []).flatMap((r) => r.txnGroups ?? [])]
  const groupUsage = all.find((g) => g.txnResults[0]?.txnResult === first)?.groupUsage
  return { ok: true, logs: confirmations.map((c) => c.logs ?? []), groupUsage, ...extra }
}

/**
 * dtalgorand's extended simulate through the fork of algokit-utils: independent groups go in as few requests as the
 * node allows, and rounds too.
 */
export function ghostkitDTBackend(algorand: GkAlgorandClient, limits: GhostkitSimulateLimits = GHOSTKIT_DT_DEFAULT_LIMITS): GhostkitBackend {
  const manager = gkForkUtils(algorand)?.simulate
  if (!manager) throw new Error('ghostkit: the dt backend needs the dtalgorand fork of algokit-utils (algorand.simulate)')
  const simulate: GhostkitBackend['simulate'] = async (groups, { round, protocol, ...raw }) => {
    const composers = await Promise.all(groups.map((g) => g(round !== undefined ? gkValidityAt(round) : undefined)))
    const outcomes = await manager.groups(composers, {
      ...raw,
      parallel: true,
      maxGroups: limits.maxTxnGroups,
      ...(round !== undefined ? { round } : {}),
      ...(protocol ? { protocol } : {}),
    })
    return outcomes.map((o) => gkFromDTOutcome(o))
  }
  return {
    name: 'dt',
    limits,
    simulate,
    simulateRounds: async (groups, rounds, { validityWindow, protocol, ...raw }) => {
      if (limits.maxRounds < 1) {
        // the node takes one round per request
        return gkMapLimit(rounds, 4, async (round) => ({ round, groups: await simulate(groups, { ...raw, protocol, round }) }))
      }
      // `rewrite` keeps each transaction's validity width: a zero width lets `block` read the furthest back at every round
      const composers = await Promise.all(groups.map((g) => g(validityWindow === 'rewrite' ? gkValidityAt(rounds[0]) : undefined)))
      const results = await manager.rounds(composers, rounds, {
        ...raw,
        parallel: true,
        maxGroups: limits.maxTxnGroups,
        maxRounds: limits.maxRounds,
        ...(validityWindow ? { validityWindow } : {}),
        ...(protocol ? { protocol } : {}),
      })
      return results.map((r) => ({
        round: r.round,
        groups: r.groups.map((o) => gkFromDTOutcome(o, r.protocolOverride)),
        ...(r.protocolOverride ? { protocolOverride: r.protocolOverride } : {}),
      }))
    },
  }
}

/** The name of the error `ghostkitQueryBackend` throws for groups it can't query; `auto` then simulates the run. */
const GK_QUERY_UNSUPPORTED = 'GhostkitQueryUnsupported'

/** Why a transaction can't be a query call, or undefined if it can. */
function gkNotQueryable(txn: gkAlgosdk.Transaction): string | undefined {
  const app = txn.applicationCall
  if (txn.type !== gkAlgosdk.TransactionType.appl || !app) return `it has a ${txn.type} transaction`
  if (app.onComplete !== gkAlgosdk.OnApplicationComplete.NoOpOC) return 'an app call is not a NoOp'
  // `access` and `rejectVersion` are missing from older algosdk versions
  if ((app as { access?: readonly unknown[] }).access?.length) return 'an app call has an access list'
  if ((app as { rejectVersion?: number }).rejectVersion) return 'an app call sets rejectVersion'
  if (txn.note?.length) return 'an app call has a note'
  if (txn.lease?.some((b) => b !== 0)) return 'an app call has a lease'
  if (txn.rekeyTo) return 'an app call rekeys'
  if (app.appIndex === 0n) return app.approvalProgram.length > 0 ? undefined : 'an app create has no approval program'
  return app.approvalProgram.length > 0 || app.clearProgram.length > 0 ? 'an app call of a deployed app has programs' : undefined
}

const gkSameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const gkSameSchema = (a: GkQuerySchema | undefined, b: GkQuerySchema | undefined) =>
  a?.numUint === b?.numUint && a?.numByteSlice === b?.numByteSlice

/** The query target of an app call: its program and schemas, or the app it calls, and its sender. */
function gkQueryTargetOf(txn: gkAlgosdk.Transaction): GkQueryTarget {
  const app = txn.applicationCall!
  const sender = txn.sender.toString()
  // the zero address runs as the round's fee sink, as does no sender
  const from = sender === GK_ZERO_ADDRESS ? {} : { sender }
  if (app.appIndex !== 0n) return { appId: app.appIndex, ...from }
  const schema = (numUint: number, numByteSlice: number) => (numUint || numByteSlice ? { numUint, numByteSlice } : undefined)
  const globalSchema = schema(app.numGlobalInts, app.numGlobalByteSlices)
  const localSchema = schema(app.numLocalInts, app.numLocalByteSlices)
  return {
    program: app.approvalProgram,
    ...(app.clearProgram.length > 0 ? { clearProgram: app.clearProgram } : {}),
    ...(globalSchema ? { globalSchema } : {}),
    ...(localSchema ? { localSchema } : {}),
    ...from,
  }
}

const gkSameTarget = (a: GkQueryTarget, b: GkQueryTarget) =>
  a.sender === b.sender &&
  a.appId === b.appId &&
  gkSameSchema(a.globalSchema, b.globalSchema) &&
  gkSameSchema(a.localSchema, b.localSchema) &&
  gkSameBytes(a.program, b.program) &&
  gkSameBytes(a.clearProgram, b.clearProgram)

/** The query call of an app call: its args and references (box `app` 0 is the created or called app). */
function gkQueryCallOf(txn: gkAlgosdk.Transaction): GkQueryCall {
  const app = txn.applicationCall!
  return {
    ...(app.appArgs.length ? { args: [...app.appArgs] } : {}),
    ...(app.accounts.length ? { accounts: app.accounts.map((a) => a.toString()) } : {}),
    ...(app.foreignApps.length ? { foreignApps: app.foreignApps.map(BigInt) } : {}),
    ...(app.foreignAssets.length ? { foreignAssets: app.foreignAssets.map(BigInt) } : {}),
    ...(app.boxes.length ? { boxes: app.boxes.map((b) => ({ app: BigInt(b.appIndex), name: b.name })) } : {}),
  }
}

/** A query group's failure, worded like algokit-utils' `QueryGroupError`, which `GhostkitError` takes `failedAt` from. */
function gkQueryGroupError(group: number, round: bigint, failure: { kind: 'round' | 'group'; failedAt?: number[]; failureMessage: string; cause: unknown }) {
  const message =
    failure.kind === 'round'
      ? `Could not query group ${group} at round ${round}: ${failure.failureMessage}`
      : `Querying group ${group} at round ${round} failed at transaction ${failure.failedAt![0]}: ${failure.failureMessage}`
  const error = Object.assign(new Error(message), failure)
  error.name = 'GhostkitQueryError'
  return error
}

/**
 * dtalgorand's read-only queries (`POST /v2/query`) through the fork of algokit-utils (`algorand.query.run`): every app
 * call of the groups runs alone, at each round, and the calls of one program or app go in as few requests as the node's
 * query limits allow. No fees, signatures or minimum balances are checked; every resource is available without
 * references; each call gets the node's `maxCallBudget`. Validity, fees and the request options other than `protocol`
 * and `signal` are ignored; groups that can't be queried (other than NoOp app calls that create an app or call one
 * without programs, or with an access list, `rejectVersion`, a note, a lease or a rekey) make it throw an error named
 * `GhostkitQueryUnsupported`.
 *
 * `limits` are the node's simulate limits: ghostkit sizes chunks by them, so that a run that falls back to simulate
 * fits too (and anything that fits in a simulated group fits in queries).
 */
export function ghostkitQueryBackend(
  algorand: GkAlgorandClient,
  { limits = GHOSTKIT_DT_DEFAULT_LIMITS, concurrency }: { limits?: GhostkitSimulateLimits; concurrency?: number } = {},
): GhostkitBackend {
  const manager = gkForkUtils(algorand)?.query
  if (!manager) throw new Error('ghostkit: the query backend needs the dtalgorand fork of algokit-utils (algorand.query)')
  const query = async (groups: GhostkitGroup[], rounds: bigint[], options: GhostkitRequestOptions): Promise<GhostkitRoundOutcome[]> => {
    const signal = options.signal
    if (groups.length === 0) return rounds.map((round) => ({ round, groups: [] }))
    const built = await Promise.all(groups.map(async (g) => (await g(undefined)).buildTransactions()))
    // the calls by target: normally one, the ghost program or app, from the reader
    const targets: { target: GkQueryTarget; calls: GkQueryCall[] }[] = []
    const placement = built.map(({ transactions }) =>
      transactions.map((txn) => {
        const reason = gkNotQueryable(txn)
        if (reason) throw Object.assign(new Error(`ghostkit: can't query the group: ${reason}`), { name: GK_QUERY_UNSUPPORTED })
        const target = gkQueryTargetOf(txn)
        let t = targets.length - 1
        if (t < 0 || !gkSameTarget(targets[t].target, target)) {
          t = targets.findIndex((x) => gkSameTarget(x.target, target))
          if (t < 0) t = targets.push({ target, calls: [] }) - 1
        }
        return { target: t, call: targets[t].calls.push(gkQueryCallOf(txn)) - 1 }
      }),
    )
    const protocol = options.protocol ?? 'round'
    const results = await Promise.all(
      targets.map(({ target, calls }) =>
        manager.run({ ...target, rounds, protocol, calls }, { signal, ...(concurrency ? { concurrency } : {}) }),
      ),
    )
    return rounds.map((requested, r) => {
      // With several targets (not in normal ghostkit use: one program or app, one reader), each `run` pins the latest
      // round on its own, and the round reported is the first target's
      const round = results[0][r].round
      const outcomes = placement.map((txns, g): GhostkitGroupOutcome => {
        const override = results[txns[0]?.target ?? 0][r].protocolOverride
        const extra = override ? { protocolOverride: override } : {}
        const logs: Uint8Array[][] = []
        let cost = 0
        for (let i = 0; i < txns.length; i++) {
          const outcome = results[txns[i].target][r].calls[txns[i].call]
          if (!outcome.ok) {
            const { error } = outcome
            const failureMessage = error.failureMessage ?? error.message
            const failure =
              error.kind === 'round'
                ? { kind: 'round' as const, failureMessage, cause: error }
                : { kind: 'group' as const, failedAt: [i], failureMessage, cause: error }
            return { ok: false, error: gkQueryGroupError(g, round, failure), ...extra }
          }
          logs.push(outcome.logs)
          cost += outcome.cost
        }
        return { ok: true, logs, cost, ...extra }
      })
      const override = results[0][r].protocolOverride
      return { round: requested === 0n ? round : requested, groups: outcomes, ...(override ? { protocolOverride: override } : {}) }
    })
  }
  return {
    name: 'query',
    limits,
    simulate: async (groups, { round, ...options }) => (await query(groups, [round ?? 0n], options))[0].groups,
    simulateRounds: (groups, rounds, { validityWindow: _ignored, ...options }) => query(groups, rounds, options),
  }
}

/**
 * What `ghostkitChangeRounds` lists the change rounds of. Keys, box names and prefixes given as strings are UTF-8, as
 * box names are in algokit-utils.
 */
export type GhostkitChangeSource =
  /** An app's params and global state; with `key`, only the rounds in which that global state key changed. */
  | { app: bigint | number; key?: string | Uint8Array; box?: never; boxPrefix?: never; asset?: never; account?: never }
  /** One of an app's boxes. */
  | { app: bigint | number; box: string | Uint8Array; key?: never; boxPrefix?: never; asset?: never; account?: never }
  /** An app's boxes whose names start with `boxPrefix`, such as one ARC-56 box map (`''` for all of its boxes). */
  | { app: bigint | number; boxPrefix: string | Uint8Array; key?: never; box?: never; asset?: never; account?: never }
  /** An asset's params. */
  | { asset: bigint | number; app?: never; account?: never; key?: never; box?: never; boxPrefix?: never }
  /** An account's base record: balance, status, minimum balance, ... (not its holdings or app states). */
  | { account: string | gkAlgosdk.Address; asset?: never; app?: never; key?: never; box?: never; boxPrefix?: never }
  /** One of an account's asset holdings. */
  | { account: string | gkAlgosdk.Address; asset: bigint | number; app?: never; key?: never; box?: never; boxPrefix?: never }
  /** An account's local state in one app; with `key`, only the rounds in which that local state key changed. */
  | { account: string | gkAlgosdk.Address; app: bigint | number; key?: string | Uint8Array; asset?: never; box?: never; boxPrefix?: never }

/** Options of `ghostkitChangeRounds`. */
export type GhostkitChangeRoundsOptions = {
  /** The first round to list (inclusive); default 1. */
  minRound?: GhostkitRound
  /** The last round to list (inclusive); default the latest. */
  maxRound?: GhostkitRound
  /** `asc` (default) lists the earliest changes first, `desc` the latest first. The rounds come in this order. */
  order?: 'asc' | 'desc'
  /** At most this many rounds (default 1,000). */
  limit?: number
  /** Stops the listing; the call rejects with the signal's reason. */
  signal?: AbortSignal
}

/** The versions listings of the dtalgorand fork of algokit-utils (`algorand.dt`), as far as ghostkit uses them. */
type GkVersionsFeed = AsyncGenerator<{ round: bigint }, unknown, unknown>
type GkVersionsOptions = { minRound?: bigint; maxRound?: bigint; order: 'asc' | 'desc'; limit: number; signal: AbortSignal }
type GkDTManager = {
  iterateAppVersions(appId: bigint, options: GkVersionsOptions & { key?: string | Uint8Array }): GkVersionsFeed
  iterateBoxVersions(appId: bigint, name: string | Uint8Array, options: GkVersionsOptions): GkVersionsFeed
  iterateBoxesVersions(appId: bigint, options: GkVersionsOptions & { prefix?: string | Uint8Array }): GkVersionsFeed
  iterateAssetVersions(assetId: bigint, options: GkVersionsOptions): GkVersionsFeed
  iterateAccountVersions(address: string | gkAlgosdk.Address, options: GkVersionsOptions & { exclude: string[] }): GkVersionsFeed
  iterateAccountAssetVersions(address: string | gkAlgosdk.Address, assetId: bigint, options: GkVersionsOptions): GkVersionsFeed
  iterateAccountAppVersions(
    address: string | gkAlgosdk.Address,
    appId: bigint,
    options: GkVersionsOptions & { key?: string | Uint8Array },
  ): GkVersionsFeed
}

/** The versions listing of one change source. */
function gkChangeFeed(dt: GkDTManager, source: GhostkitChangeSource, options: GkVersionsOptions): GkVersionsFeed {
  const s = source as { app?: bigint | number; asset?: bigint | number; account?: string | gkAlgosdk.Address } & {
    key?: string | Uint8Array
    box?: string | Uint8Array
    boxPrefix?: string | Uint8Array
  }
  const key = s.key !== undefined ? { key: s.key } : {}
  if (s.account !== undefined) {
    if (s.asset !== undefined) return dt.iterateAccountAssetVersions(s.account, BigInt(s.asset), options)
    if (s.app !== undefined) return dt.iterateAccountAppVersions(s.account, BigInt(s.app), { ...options, ...key })
    return dt.iterateAccountVersions(s.account, { ...options, exclude: ['all'] })
  }
  if (s.asset !== undefined) return dt.iterateAssetVersions(BigInt(s.asset), options)
  if (s.app !== undefined) {
    if (s.box !== undefined) return dt.iterateBoxVersions(BigInt(s.app), s.box, options)
    if (s.boxPrefix !== undefined) {
      return dt.iterateBoxesVersions(BigInt(s.app), { ...options, ...(s.boxPrefix.length ? { prefix: s.boxPrefix } : {}) })
    }
    return dt.iterateAppVersions(BigInt(s.app), { ...options, ...key })
  }
  throw new Error('ghostkit: a change source needs an app, an asset or an account')
}

/**
 * dtalgorand nodes only: the rounds in which any of `sources` changed, merged and deduplicated, from the node's
 * `/versions` listings. Pass them to `atRounds` to read a ghost at every change and nowhere between, instead of
 * sampling rounds evenly.
 *
 * - A round is the round of a change: a ghost read at it sees the state after the change (`round - 1n` sees it before).
 * - Round 0 (genesis allocations) is never listed: to `atRounds`, 0 is the latest round.
 * - `next` is set when `limit` cut the list: pass it as `minRound` (`asc`) or `maxRound` (`desc`) to continue. With
 *   several sources and no `maxRound`, the latest round is read once, so every listing ends at the same round.
 * - The node's versions errors pass through: a listing over the node's time limit (504) or a history it can't serve
 *   (503) isn't retried, so narrow the range. Pages can be short or empty (`key`, `boxPrefix`); they are followed to the end.
 *
 * Needs the dtalgorand forks of algokit-utils (`algorand.dt`) and algosdk, and a dtalgorand node with time travel
 * (`getNode()` has `limits.timeTravel`). On stock algod or a node with time travel off, the fork of algokit-utils
 * rejects the call with dtalgosdk's `DTUnsupportedError` before listing anything.
 *
 * @example
 * const { rounds } = await ghostkitChangeRounds(algorand, [{ app: poolAppId, box: 'stakers' }], { minRound, maxRound })
 * const series = await sdk.atRounds(rounds, (s) => s.stakerBalances({ methodArgsOrArgsArray: { pool: poolAppId } }))
 */
export async function ghostkitChangeRounds(
  algorand: GkAlgorandClient,
  sources: GhostkitChangeSource[],
  { minRound, maxRound, order = 'asc', limit = 1_000, signal }: GhostkitChangeRoundsOptions = {},
): Promise<{ rounds: bigint[]; next?: bigint }> {
  const dt = gkForkUtils(algorand)?.dt
  if (!dt) throw new Error('ghostkit: change rounds need the dtalgorand fork of algokit-utils (algorand.dt)')
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`ghostkit: limit must be a positive integer, not ${limit}`)
  if (order !== 'asc' && order !== 'desc') throw new Error(`ghostkit: order must be 'asc' or 'desc', not ${order}`)
  gkThrowIfAborted(signal)
  if (sources.length === 0) return { rounds: [] }
  let last = maxRound !== undefined ? BigInt(maxRound) : undefined
  if (last === undefined && sources.length > 1) {
    last = (await algorand.client.algod.status().do(undefined, signal ? { signal } : undefined)).lastRound
    gkThrowIfAborted(signal)
  }

  // the listings stop with the call: on the caller's abort, an error, or when enough rounds are taken
  const stop = new AbortController()
  const onAbort = () => stop.abort(signal!.reason)
  signal?.addEventListener('abort', onAbort)
  const desc = order === 'desc'
  const options: GkVersionsOptions = {
    ...(minRound !== undefined ? { minRound: BigInt(minRound) } : {}),
    ...(last !== undefined ? { maxRound: last } : {}),
    order,
    limit: Math.min(limit + 1, 1_000),
    signal: stop.signal,
  }
  const feeds: GkVersionsFeed[] = []
  try {
    for (const source of sources) feeds.push(gkChangeFeed(dt, source, options))
    const heads: (bigint | undefined)[] = feeds.map(() => undefined)
    /** Moves feed `i` to its next round other than 0, or to its end (`undefined`). */
    const pull = async (i: number) => {
      for (;;) {
        const r = await feeds[i].next()
        if (r.done) return void (heads[i] = undefined)
        if (r.value.round !== 0n) return void (heads[i] = r.value.round)
      }
    }
    await Promise.all(feeds.map((_, i) => pull(i)))
    const rounds: bigint[] = []
    for (;;) {
      let best: bigint | undefined
      for (const h of heads) if (h !== undefined && (best === undefined || (desc ? h > best : h < best))) best = h
      if (best === undefined) return { rounds }
      if (rounds.length === limit) {
        const end = rounds[rounds.length - 1]
        return { rounds, next: desc ? end - 1n : end + 1n }
      }
      rounds.push(best)
      // every feed at this round moves past it, so a round listed by several feeds, or twice by one, is taken once
      await Promise.all(
        heads.map(async (_, i) => {
          while (heads[i] === best) await pull(i)
        }),
      )
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!stop.signal.aborted) stop.abort(new Error('ghostkit: change rounds done'))
    await Promise.allSettled(feeds.map((f) => f.return(undefined)))
  }
}

/** Decodes a transaction's logs: every log but the last, which must be the ABI return. */
function gkDecodeLogs<T>(logs: Uint8Array[][], returnType: string, structs: GkArc56Contract['structs']): T[] {
  return logs.flatMap((txnLogs, i) => {
    const last = txnLogs[txnLogs.length - 1]
    if (!last || last.length < 4 || GK_RETURN_PREFIX.some((b, j) => last[j] !== b)) {
      throw new Error(`transaction ${i} has no ABI return log; ghostkit methods must be ABI methods that return a value`)
    }
    // decode a copy: logs can be views into one response buffer, and algosdk's ABI decoder ignores a view's byteOffset
    return txnLogs.slice(0, -1).map((log) => gkDecodeValue(log.slice(), returnType, structs) as T)
  })
}

/** A call as the generated SDK method describes it. */
type GkCallSpec = { signature: string; chunk?: GhostkitChunkOptions }
type GkParamsBuilder = (callParams: any) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * How a run's groups pay fees: what the reader can spend (`max`), a fixed amount on each group's first app call, or the
 * minimum fees.
 */
type GkFeePlan = { kind: 'max'; spendable: bigint; minFee: bigint } | { kind: 'fixed'; amount: bigint } | { kind: 'min' }

/** How a run builds its groups: who sends them, how they pay fees, and where their suggested params come from. */
type GkBuild = { reader: string; fees: GkFeePlan; params: () => Promise<GkSuggestedParams> }

/** A call ready to simulate: its groups, and how to decode its results. */
type GkPreparedCall = {
  method: string
  returnType: string
  groupCount: number
  /** the call's groups, built as the run says */
  groupsFor(build: GkBuild): GhostkitGroup[]
  /** app calls per group, and arg counts per app call, for debug */
  shape: Record<string, number>[][]
  options?: GhostkitSimulateOptions
  /** whether the reader must be the real sender: an ABI `account` argument can encode it (index 0) */
  needsReader: boolean
  /** why the call must be simulated, not queried */
  simulateOnly?: string
}

type GkPending = {
  prepared: Promise<GkPreparedCall>
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/** What an SDK instance (and its atRound / batch views) shares. */
type GkShared = {
  programs?: { approval: Uint8Array; clear: Uint8Array }
  methods?: Map<string, GkArc56Contract['methods'][number]>
  returnTypes: Map<string, string>
  warned: Set<string>
}

type GkTarget = { kind: 'latest' } | { kind: 'round'; round: bigint } | { kind: 'rounds'; rounds: bigint[] }

type GkSuggestedParams = Awaited<ReturnType<GkAlgorandClient['getSuggestedParams']>>

/**
 * What ghostkit learns about a node, shared by every SDK instance on the same AlgorandClient: suggested params, the
 * fee sink, the node's simulate support, and the reader's spendable balance (`ghostFee: 'max'`).
 */
type GkClientCache = {
  params?: { value: GkSuggestedParams; at: number }
  paramsInFlight?: Promise<GkSuggestedParams>
  feeSink?: Promise<string>
  node?: Promise<GhostkitNode>
  /** by reader and round ('latest' for the latest), with when it expires */
  spendable: Map<string, { value: Promise<bigint | undefined>; expires: number }>
}
// Every generated SDK inlines its own copy of this runtime, so the caches live on a global registry for SDKs of
// different contracts to share. The key is versioned: change it when GkClientCache changes shape.
const gkClientCaches: WeakMap<GkAlgorandClient, GkClientCache> = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('ghostkit.clientCaches.v2')
] ??= new WeakMap()) as WeakMap<GkAlgorandClient, GkClientCache>
const gkCacheOf = (algorand: GkAlgorandClient): GkClientCache => {
  let cache = gkClientCaches.get(algorand)
  if (!cache) gkClientCaches.set(algorand, (cache = { spendable: new Map() }))
  return cache
}
/** Caches a promise, forgetting it if it rejects so that the next caller tries again. */
function gkRemember<K extends 'feeSink' | 'node'>(cache: GkClientCache, key: K, make: () => NonNullable<GkClientCache[K]>) {
  const existing = cache[key]
  if (existing) return existing as NonNullable<GkClientCache[K]>
  const made = make()
  cache[key] = made
  ;(made as Promise<unknown>).catch(() => {
    if (cache[key] === made) cache[key] = undefined
  })
  return made
}

/** The base of every ghostkit SDK. */
export class GhostkitBase<TFactory, TClient> {
  public algorand: GkAlgorandClient
  /** The account ghost calls are sent from; the network's fee sink when unset. */
  public readerAccount?: string
  public ghostAppId?: bigint
  /** The algokit-generated factory, for typed clients of deployed apps. */
  public factory: TFactory
  protected client: TClient
  public appSpec: GkArc56Contract
  public cacheParamsTimeout = 3_000 // ms
  public debug = false
  public backend: 'auto' | 'query' | 'dt' | 'stock' | GhostkitBackend = 'auto'
  public ghostFee: GhostkitFee = 1_000_000n

  protected _gkMeta: GhostkitMeta
  protected _gkShared: GkShared
  protected _gkRound?: bigint
  protected _gkCollector?: GkPending[]

  constructor(
    params: GhostkitSDKParams,
    spec: {
      appSpec: GkArc56Contract
      meta: GhostkitMeta
      createFactory: (algorand: GkAlgorandClient, defaultSender: string) => TFactory
      createClient: (factory: TFactory, appId: bigint) => TClient
    },
  ) {
    this.algorand = params.algorand
    this.readerAccount = params.readerAccount
    this.ghostAppId = params.ghostAppId
    if (params.cacheParamsTimeout !== undefined) this.cacheParamsTimeout = params.cacheParamsTimeout
    this.debug = params.debug ?? false
    if (params.backend) this.backend = params.backend
    if (params.ghostFee !== undefined) this.ghostFee = params.ghostFee
    this.appSpec = spec.appSpec
    this._gkMeta = spec.meta
    this.factory = spec.createFactory(this.algorand, params.readerAccount ?? GK_FALLBACK_READER)
    this.client = spec.createClient(this.factory, params.ghostAppId ?? 13n)
    this._gkShared = { returnTypes: new Map(), warned: new Set() }
  }

  /**
   * The same SDK, simulating as of the end of `round`. A stock node can only simulate its last few rounds (usually 4);
   * a dtalgorand node with time travel any round since genesis.
   */
  atRound(round: GhostkitRound): this {
    return this._gkView({ _gkRound: BigInt(round) })
  }

  /**
   * Runs the calls `fn` makes at each round, and returns their results per round. `fn` must return the calls'
   * promises (one, or an array) without awaiting them.
   *
   * On a dtalgorand node the rounds and calls go in as few requests as its limits allow, rounds any distance apart (with
   * queries, one request per up to `maxCalls` app calls × `maxRounds` rounds, 1,024 × 16 by default); on a stock node
   * each call is simulated at each round on its own, and only the last few rounds are available.
   *
   * @example
   * const balances = await sdk.atRounds([46_000_000n, 47_000_000n], (s) => s.acctBalanceData({ methodArgsOrArgsArray: { accounts } }))
   * for (const r of balances) if (r.ok) console.log(r.round, r.value)
   */
  async atRounds<const T extends Promise<unknown> | readonly Promise<unknown>[]>(
    rounds: GhostkitRound[],
    fn: (sdk: this) => T,
    options?: GhostkitRoundsOptions,
  ): Promise<GhostkitRoundResult<GkAwaitedAll<T>>[]> {
    const { calls, returned, wasArray } = this._gkCollectWithShape(fn)
    if (rounds.length === 0) return []
    const prepared = await Promise.all(calls.map((c) => c.prepared))
    const indexes = returned.map((p) => calls.findIndex((c) => c.promise === p))
    const results = await this._gkRun(prepared, { kind: 'rounds', rounds: rounds.map(BigInt) }, options ?? {})
    return results.map(({ round, protocolOverride, calls: callResults }) => {
      const base = { round: round!, ...(protocolOverride ? { protocolOverride } : {}) }
      const failed = callResults.find((c) => !c.ok)
      if (failed && !failed.ok) return { ...base, ok: false as const, error: failed.error }
      const values = indexes.map((i) => (callResults[i] as { value: unknown }).value)
      return { ...base, ok: true as const, value: (wasArray ? values : values[0]) as GkAwaitedAll<T> }
    })
  }

  /**
   * Simulates the calls `fn` makes together: on a dtalgorand node in one request (or as few as its limits allow; with
   * queries, up to `maxCalls` app calls per request, 1,024 by default), on a stock node one request per call,
   * concurrently. `fn` must return the calls' promises (one, or an array) without
   * awaiting them. Rejects with the first failed call's error.
   *
   * @example
   * const [timestamps, balances] = await sdk.batch((s) => [s.blkTimestamp({ ... }), s.acctBalanceData({ ... })])
   */
  async batch<const T extends Promise<unknown> | readonly Promise<unknown>[]>(
    fn: (sdk: this) => T,
    options?: Omit<GhostkitSimulateOptions, 'round'>,
  ): Promise<GkAwaitedAll<T>> {
    const { calls, returned, wasArray } = this._gkCollectWithShape(fn)
    if (calls.length) {
      try {
        const prepared = await Promise.all(calls.map((c) => c.prepared))
        const target: GkTarget = this._gkRound !== undefined ? { kind: 'round', round: this._gkRound } : { kind: 'latest' }
        const [{ calls: results }] = await this._gkRun(prepared, target, options ?? {})
        results.forEach((r, i) => (r.ok ? calls[i].resolve(r.value) : calls[i].reject(r.error)))
      } catch (e) {
        calls.forEach((c) => c.reject(e))
      }
    }
    return (wasArray ? Promise.all(returned) : returned[0]) as Promise<GkAwaitedAll<T>>
  }

  /**
   * What ghostkit found about the node and the loaded libraries; the backend `auto` picks by it. Found once per
   * AlgorandClient.
   */
  getNode(): Promise<GhostkitNode> {
    return gkRemember(gkCacheOf(this.algorand), 'node', () => ghostkitDetectNode(this.algorand))
  }

  /**
   * Fetches what the first call waits for: the node's limits, and suggested params unless the node has queries, which
   * need none. Calls fetch them anyway; this lets them arrive while the app does other work. Simulates at the latest
   * round use the params for `cacheParamsTimeout` ms, at past rounds for an hour.
   */
  async prefetch(): Promise<void> {
    const backend = await this._gkResolveBackend()
    if (backend.name !== 'query') await this._gkParams(GK_PAST_PARAMS_MAX_AGE)
  }

  /** Runs a generated method's call: now, or as part of `batch` / `atRounds`. */
  protected _gkCall<T>(spec: GkCallSpec, input: GhostkitMethodInput<unknown>, params: GkParamsBuilder): Promise<T[]> {
    if (this._gkCollector) {
      if (input.extraSimulateArgs) {
        // thrown, not rejected: batch() / atRounds() then reject with it
        throw new Error('ghostkit: inside batch() or atRounds(), pass simulate options to them instead of extraSimulateArgs')
      }
      let resolve!: (value: unknown) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res
        reject = rej
      })
      promise.catch(() => {}) // a call that fn didn't return must not be an unhandled rejection
      const prepared = this._gkPrepare(spec, input, params)
      prepared.catch(() => {})
      this._gkCollector.push({ prepared, promise, resolve, reject })
      return promise as Promise<T[]>
    }
    return (async () => {
      const prepared = await this._gkPrepare(spec, input, params)
      const pinned = input.extraSimulateArgs?.round
      if (pinned !== undefined && this._gkRound !== undefined && BigInt(pinned) !== this._gkRound) {
        throw new Error(`ghostkit: extraSimulateArgs.round ${pinned} conflicts with atRound(${this._gkRound})`)
      }
      const round = pinned !== undefined ? BigInt(pinned) : this._gkRound
      const target: GkTarget = round !== undefined ? { kind: 'round', round } : { kind: 'latest' }
      const [{ calls }] = await this._gkRun([prepared], target, {})
      const [result] = calls
      if (!result.ok) throw result.error
      return result.value as T[]
    })()
  }

  private _gkCollectWithShape<T>(fn: (sdk: this) => T) {
    const calls: GkPending[] = []
    const returnedValue = fn(this._gkView({ _gkCollector: calls }))
    const wasArray = Array.isArray(returnedValue)
    const returned = (wasArray ? returnedValue : [returnedValue]) as Promise<unknown>[]
    for (const p of returned) {
      if (!calls.some((c) => c.promise === p)) {
        throw new Error('ghostkit: the callback must return the promises of the SDK calls it makes, without awaiting them')
      }
    }
    return { calls, returned, wasArray }
  }

  private _gkView(overrides: { _gkRound?: bigint; _gkCollector?: GkPending[] }): this {
    return Object.assign(Object.create(this) as this, overrides)
  }

  private _gkWarn(key: string, message: string) {
    if (this._gkShared.warned.has(key)) return
    this._gkShared.warned.add(key)
    console.warn(`[ghostkit] ${message}`)
  }

  /**
   * The backend for this call, by what `getNode()` found: the forced backends `dt` and `query` throw on a node or
   * libraries without what they need. Detection is cached per AlgorandClient, so this costs no request after the first.
   */
  private async _gkResolveBackend(): Promise<GhostkitBackend> {
    const mode = this.backend
    if (typeof mode === 'object') return mode
    if (mode === 'stock') return ghostkitStockBackend(this.algorand)
    const node = await this.getNode()
    if (mode === 'dt' || mode === 'query') {
      if (node.kind !== 'dt') throw new Error(`ghostkit: backend '${mode}' can't be used: ${node.reason}`)
      if (mode === 'query' && !node.query) throw new Error("ghostkit: backend 'query' can't be used: the node has queries off")
    }
    if (node.kind !== 'dt') return ghostkitStockBackend(this.algorand)
    const query = mode === 'query' || (mode === 'auto' && node.query)
    return query ? ghostkitQueryBackend(this.algorand, { limits: node.limits }) : ghostkitDTBackend(this.algorand, node.limits)
  }

  /** The backend `auto` simulates with when a run can't be queried. */
  private async _gkSimulateBackend(): Promise<GhostkitBackend> {
    const node = await this.getNode()
    return node.kind === 'dt' ? ghostkitDTBackend(this.algorand, node.limits) : ghostkitStockBackend(this.algorand)
  }

  /** The query limits for the pre-checks of a run on the query backend. */
  private async _gkQueryLimits(): Promise<GhostkitQueryLimits | undefined> {
    const node = await this.getNode()
    return node.kind === 'dt' ? node.query : undefined
  }

  /** The reader: `readerAccount`, or the fee sink, known for MainNet and TestNet and otherwise read from the genesis once. */
  private async _gkReader(): Promise<string> {
    if (this.readerAccount) return this.readerAccount
    const { genesisHash } = await this._gkParams(GK_PAST_PARAMS_MAX_AGE)
    const known = genesisHash && GK_KNOWN_FEE_SINKS[gkAlgosdk.bytesToBase64(genesisHash)]
    if (known) return known
    return gkRemember(gkCacheOf(this.algorand), 'feeSink', async () => {
      const genesis = await this.algorand.client.algod.genesis().do()
      const fees = (typeof genesis === 'string' ? JSON.parse(genesis) : genesis)?.fees
      if (typeof fees !== 'string') throw new Error('ghostkit: no fee sink in the genesis; set readerAccount')
      return fees
    })
  }

  /**
   * Suggested params no older than `maxAge` ms, shared by every SDK on the AlgorandClient. They come from
   * `algorand.getSuggestedParams()`, so its own cache applies too; ghostkit never changes it. Concurrent callers share
   * one request.
   */
  private async _gkParams(maxAge: number): Promise<GkSuggestedParams> {
    const cache = gkCacheOf(this.algorand)
    if (cache.params && Date.now() - cache.params.at <= maxAge) return { ...cache.params.value }
    if (!cache.paramsInFlight) {
      const inFlight = this.algorand.getSuggestedParams()
      cache.paramsInFlight = inFlight
      inFlight
        .then((value) => (cache.params = { value, at: Date.now() }))
        .catch(() => {})
        .finally(() => {
          if (cache.paramsInFlight === inFlight) cache.paramsInFlight = undefined
        })
    }
    return { ...(await cache.paramsInFlight) }
  }

  /** A composer whose suggested params come from `params` (`_gkParams`, or none), without touching the AlgorandClient's cache. */
  private _gkComposer(params: () => Promise<GkSuggestedParams>): GkTransactionComposer {
    return new GkTransactionComposer({
      algod: this.algorand.client.algod,
      getSigner: () => gkEmptySigner,
      getSuggestedParams: params,
      appManager: this.algorand.app,
    })
  }

  private _gkPrograms() {
    this._gkShared.programs ??= {
      approval: gkAlgosdk.base64ToBytes(this.appSpec.byteCode!.approval),
      clear: gkAlgosdk.base64ToBytes(this.appSpec.byteCode!.clear),
    }
    return this._gkShared.programs
  }

  private _gkMethod(signature: string) {
    this._gkShared.methods ??= new Map(this.appSpec.methods.map((m) => [new gkAlgosdk.ABIMethod(m).getSignature(), m]))
    const method = this._gkShared.methods.get(signature)
    if (!method) throw new Error(`ghostkit: method not found in the app spec: ${signature}`)
    return method
  }

  private _gkReturnType(signature: string) {
    let type = this._gkShared.returnTypes.get(signature)
    if (!type) {
      const { returns } = this._gkMethod(signature)
      type = returns.struct ?? returns.type
      this._gkShared.returnTypes.set(signature, type)
    }
    return type
  }

  /** Whether the ghost only runs under consensus v42 or later. */
  private _gkNeedsV42() {
    return this._gkMeta.avmVersion >= 13 || this._gkMeta.extraProgramPages > 3
  }

  private async _gkPrepare(spec: GkCallSpec, input: GhostkitMethodInput<unknown>, params: GkParamsBuilder): Promise<GkPreparedCall> {
    const method = spec.signature.slice(0, spec.signature.indexOf('('))
    const { methodArgsOrArgsArray, extraMethodCallArgs } = input
    const isList = Array.isArray(methodArgsOrArgsArray)
    const argsList = (isList ? methodArgsOrArgsArray : [methodArgsOrArgsArray]) as Record<string, unknown>[]
    if (Array.isArray(extraMethodCallArgs) && extraMethodCallArgs.length !== argsList.length) {
      throw new Error(`ghostkit: ${method}: extraMethodCallArgs has ${extraMethodCallArgs.length} entries for ${argsList.length} calls`)
    }
    const extraAt = (i: number) => (Array.isArray(extraMethodCallArgs) ? extraMethodCallArgs[i] : extraMethodCallArgs) ?? {}

    // one group of all the app calls, or chunks of one call's array argument
    const chunk = input.chunk === false ? undefined : (input.chunk ?? spec.chunk)
    let groupEntries: { args: Record<string, unknown>; extra: GhostkitExtraMethodCallArgs }[][]
    if (chunk) {
      if (isList) throw new Error(`ghostkit: ${method}: chunk takes a single methodArgsOrArgsArray object, not a list`)
      if (Array.isArray(extraMethodCallArgs)) throw new Error(`ghostkit: ${method}: chunk takes a single extraMethodCallArgs object`)
      const backend = await this._gkResolveBackend()
      groupEntries = this._gkChunk(spec.signature, argsList[0], chunk, backend.limits).map((txns) =>
        txns.map((args) => ({ args, extra: extraAt(0) })),
      )
    } else {
      if (argsList.length > GK_MAX_GROUP_SIZE) {
        throw new Error(`ghostkit: ${method}: ${argsList.length} app calls don't fit in one group of ${GK_MAX_GROUP_SIZE}`)
      }
      groupEntries = [argsList.map((args, i) => ({ args, extra: extraAt(i) }))]
    }

    const ghost = !this.ghostAppId
    const programs = ghost ? this._gkPrograms() : undefined
    const schema = this.appSpec.state.schema
    // the minimum balance the reader holds for each ghost app it creates in a group
    const appMinBalance = ghost
      ? GK_APP_MIN_BALANCE * BigInt(1 + this._gkMeta.extraProgramPages) +
        GK_GLOBAL_UINT_MIN_BALANCE * BigInt(schema.global.ints) +
        GK_GLOBAL_BYTES_MIN_BALANCE * BigInt(schema.global.bytes)
      : 0n
    const ownFee = (extra: GhostkitExtraMethodCallArgs) => extra.staticFee !== undefined || extra.extraFee !== undefined

    /** The static fee of each app call of a group under the plan; undefined leaves the call's own or the minimum fee. */
    const feesFor = (entries: { extra: GhostkitExtraMethodCallArgs }[], plan: GkFeePlan): (bigint | undefined)[] => {
      const fees = entries.map((): bigint | undefined => undefined)
      if (plan.kind === 'min' || ownFee(entries[0].extra)) return fees
      if (plan.kind === 'fixed') {
        fees[0] = plan.amount
        return fees
      }
      // max: the first pays what's left after the ghost apps' minimum balance and the others' own fees; the others nothing
      let budget = plan.spendable - appMinBalance * BigInt(entries.length)
      for (let i = 1; i < entries.length; i++) {
        const { staticFee, extraFee } = entries[i].extra
        if (staticFee !== undefined) budget -= staticFee.microAlgo
        else if (extraFee !== undefined) budget -= plan.minFee + extraFee.microAlgo
        else fees[i] = 0n
      }
      // a reader that can't even pay the minimum fee keeps the defaults, and the simulate fails with an overspend
      if (budget >= plan.minFee) fees[0] = budget
      else fees.fill(undefined)
      return fees
    }

    const groupsFor = ({ reader, fees: plan, params: suggested }: GkBuild): GhostkitGroup[] =>
      groupEntries.map((entries) => async (validity) => {
      const composer = this._gkComposer(suggested)
      const fees = feesFor(entries, plan)
      for (let i = 0; i < entries.length; i++) {
        const { args, extra } = entries[i]
        const callParams: Record<string, unknown> = { args, sender: reader, signer: gkEmptySigner, ...extra }
        if (fees[i] !== undefined) callParams.staticFee = GkAlgoAmount.MicroAlgos(fees[i]!)
        if (validity && extra.firstValidRound === undefined && extra.lastValidRound === undefined) Object.assign(callParams, validity)
        const call = (await params(callParams)) as GkAppCallMethodCall
        if (programs) {
          const { appId: _appId, ...rest } = call
          composer.addAppCreateMethodCall({
            ...rest,
            approvalProgram: programs.approval,
            clearStateProgram: programs.clear,
            schema: {
              globalInts: schema.global.ints,
              globalByteSlices: schema.global.bytes,
              localInts: schema.local.ints,
              localByteSlices: schema.local.bytes,
            },
            extraProgramPages: this._gkMeta.extraProgramPages,
          })
        } else {
          composer.addAppCallMethodCall(call)
        }
      }
      return composer
    })

    // a query sends each app call alone, as the block after the round makes it: fields it can't set go to simulate
    const abiArgs = this._gkMethod(spec.signature).args
    const unqueryableField = (
      ['firstValidRound', 'lastValidRound', 'validityWindow', 'note', 'lease', 'rekeyTo', 'accessReferences', 'rejectVersion'] as const
    ).find(
      (field) => groupEntries.some((entries) => entries.some(({ extra }) => (extra as Record<string, unknown>)[field] !== undefined)),
    )
    const simulateOnly = abiArgs.some((a) => gkAlgosdk.abiTypeIsTransaction(a.type))
      ? `${method} has transaction arguments`
      : unqueryableField
        ? `extraMethodCallArgs sets ${unqueryableField}`
        : undefined

    return {
      method,
      returnType: this._gkReturnType(spec.signature),
      groupCount: groupEntries.length,
      groupsFor,
      shape: groupEntries.map((entries) =>
        entries.map(({ args }) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]))),
      ),
      options: input.extraSimulateArgs,
      needsReader: abiArgs.some((a) => a.type === 'account'),
      ...(simulateOnly ? { simulateOnly } : {}),
    }
  }

  /** Splits a call's array argument into groups of app calls, sized to the node's limits. */
  private _gkChunk(
    signature: string,
    args: Record<string, unknown>,
    chunk: GhostkitChunkOptions,
    limits: GhostkitSimulateLimits,
  ): Record<string, unknown>[][] {
    const method = this._gkMethod(signature)
    const name = method.name
    const arg = method.args.find((a) => a.name === chunk.arg)
    if (!arg) throw new Error(`ghostkit: ${name} has no argument ${chunk.arg} to chunk`)
    const items = args[chunk.arg]
    if (!Array.isArray(items) || !arg.type.endsWith('[]')) throw new Error(`ghostkit: ${name}: ${chunk.arg} is not a dynamic array`)
    if (items.length === 0) return [[args]]

    // app arg bytes: the selector, the other arguments, and the array's length prefix and items. The array is one app
    // arg, so it also stays within the per-arg limit.
    const elementType = gkAlgosdk.ABIType.from(arg.type.slice(0, -2))
    const otherBytes = method.args
      .filter((a) => a !== arg)
      .reduce((n, a) => {
        if (gkAlgosdk.abiTypeIsReference(a.type)) return n + 1
        if (gkAlgosdk.abiTypeIsTransaction(a.type)) throw new Error(`ghostkit: ${name}: can't chunk a method with transaction arguments`)
        // algokit's encoder returns a Uint8Array as is, so for an ABI type such as byte[] encode it with algosdk, which
        // adds the length prefix the app call will carry
        const value = args[a.name!] as never
        const asIs = a.struct || a.type.startsWith('AVM') || !((value as unknown) instanceof Uint8Array)
        return n + (asIs ? gkEncodeValue(value, a.struct ?? a.type, this.appSpec.structs) : gkAlgosdk.ABIType.from(a.type).encode(value)).length
      }, 4)
    const maxArgBytes = chunk.maxArgBytes ?? (this._gkNeedsV42() ? 16_384 : 4_096)
    const maxArrayBytes = Math.min(maxArgBytes - otherBytes, GK_MAX_ARG_BYTES)
    if (maxArrayBytes < 2) throw new Error(`ghostkit: ${name}: the other arguments leave no room for ${chunk.arg} in an app call`)
    let perTxn = chunk.maxPerTxn ?? Infinity
    if (!elementType.isDynamic()) {
      perTxn = Math.min(perTxn, Math.floor((maxArrayBytes - 2) / elementType.byteLen()))
    } else if (chunk.maxPerTxn === undefined) {
      throw new Error(`ghostkit: ${name}: set chunk.maxPerTxn, since the items of ${chunk.arg} vary in size`)
    }
    const refsPerItem = chunk.refsPerItem ?? 1
    const perGroupRefs =
      refsPerItem > 0 ? Math.floor((GK_MAX_GROUP_SIZE * GK_REFS_PER_TXN * limits.resourceLimitMultiplier) / refsPerItem) : Infinity
    perTxn = Math.min(perTxn, perGroupRefs)
    if (!(perTxn >= 1)) throw new Error(`ghostkit: ${name}: not even one item of ${chunk.arg} fits in an app call`)
    const perGroup = Math.min(chunk.maxPerGroup ?? Infinity, GK_MAX_GROUP_SIZE * perTxn, perGroupRefs)

    const groups: Record<string, unknown>[][] = []
    for (let g = 0; g < items.length; g += perGroup) {
      const groupItems = items.slice(g, g + perGroup)
      const txns: Record<string, unknown>[] = []
      for (let t = 0; t < groupItems.length; t += perTxn) txns.push({ ...args, [chunk.arg]: groupItems.slice(t, t + perTxn) })
      groups.push(txns)
    }
    // items of varying size are split by maxPerTxn alone, so check each app call's bytes here
    if (elementType.isDynamic()) {
      for (const txn of groups.flat()) {
        const chunkItems = txn[chunk.arg] as unknown[]
        const bytes = gkAlgosdk.ABIType.from(arg.type).encode(chunkItems as never).length
        if (bytes <= maxArrayBytes) continue
        throw new Error(
          chunkItems.length === 1
            ? `ghostkit: ${name}: an item of ${chunk.arg} takes ${bytes} bytes, more than the ${maxArrayBytes} that fit in an app call`
            : `ghostkit: ${name}: ${chunkItems.length} items of ${chunk.arg} take ${bytes} bytes, more than the ${maxArrayBytes} that fit in an app call; lower chunk.maxPerTxn`,
        )
      }
    }
    return groups
  }

  /**
   * Runs prepared calls at the target. With `auto`, a run on the query backend goes to simulate when it can't be queried
   * (`_gkQueryBlocker`, `_gkQueryFallback`).
   */
  private async _gkRun(
    calls: GkPreparedCall[],
    target: GkTarget,
    options: GhostkitRoundsOptions,
  ): Promise<{ round?: bigint; protocolOverride?: GhostkitProtocolOverride; calls: ({ ok: true; value: unknown[] } | { ok: false; error: GhostkitError })[] }[]> {
    let backend = await this._gkResolveBackend()
    let fallback: string | undefined
    if (backend.name === 'query') {
      const auto = this.backend === 'auto'
      fallback = await this._gkQueryBlocker(calls, target, options)
      if (fallback && !auto) throw new Error(`ghostkit: backend 'query' can't run this call: ${fallback}`)
      if (!fallback) {
        try {
          return await this._gkRunOn(backend, calls, target, options)
        } catch (e) {
          const signal = { ...options, ...calls[0]?.options }.signal
          fallback = auto && !signal?.aborted ? this._gkQueryFallback(e) : undefined
          if (!fallback) throw e
        }
      }
      backend = await this._gkSimulateBackend()
    }
    return this._gkRunOn(backend, calls, target, options, fallback)
  }

  /** Why a run must be simulated rather than queried, or undefined if it can be queried. */
  private async _gkQueryBlocker(calls: GkPreparedCall[], target: GkTarget, options: GhostkitRoundsOptions): Promise<string | undefined> {
    const merged = { ...options, ...calls[0]?.options } as GhostkitRoundsOptions & {
      execTraceConfig?: { enable?: boolean }
      extraOpcodeBudget?: number | bigint
      allowMoreLogging?: boolean
    }
    if (merged.execTraceConfig?.enable) return 'execution traces need simulate'
    const own = calls.find((c) => c.simulateOnly)?.simulateOnly
    if (own) return own
    if (target.kind === 'rounds' && (merged.validityWindow === 'skip' || merged.validityWindow === null)) {
      return `validityWindow ${merged.validityWindow} needs simulate`
    }
    const limits = await this._gkQueryLimits()
    if (!limits) return undefined
    // simulate pools 700 per app call with the extra budget; a query gives each app call maxCallBudget
    const extraBudget = Number(merged.extraOpcodeBudget ?? 170_000)
    const groupSize = Math.max(1, ...calls.flatMap((c) => c.shape.map((g) => g.length)))
    if (extraBudget + GK_APP_CALL_BUDGET * groupSize > limits.maxCallBudget) {
      return `extraOpcodeBudget ${extraBudget} and ${GK_APP_CALL_BUDGET} per app call of a group of ${groupSize} are more than the node's maxCallBudget ${limits.maxCallBudget}`
    }
    if ((merged.allowMoreLogging ?? true) && limits.maxCallLogBytes < GK_MORE_LOGGING_BYTES) {
      return `allowMoreLogging needs ${GK_MORE_LOGGING_BYTES} log bytes per app call; the node's maxCallLogBytes is ${limits.maxCallLogBytes}`
    }
    return undefined
  }

  /**
   * Why `auto` simulates a run whose query failed with `e`, or undefined to throw. Two failures are only the query's:
   * a group the query backend can't send, and a round after the node's latest one, which fails a whole query request
   * (400) but only that round of a simulate. The node's other 400s would fail the simulate too.
   */
  private _gkQueryFallback(e: unknown): string | undefined {
    const error = e as Error | undefined
    if (error?.name === GK_QUERY_UNSUPPORTED) return error.message
    if (gkStatus(e) === 400) {
      const message = gkErrorText(e)
      if (/round \d+ is after the latest round/.test(message)) return `the node rejected the query: ${message}`
    }
    return undefined
  }

  /**
   * What the reader can spend at a round (the latest if undefined) over its minimum balance; undefined if unknown. Only a
   * dtalgorand node with time travel reads accounts at past rounds; other nodes give the latest balance, the best guess.
   */
  private _gkSpendable(round: bigint | undefined): Promise<bigint | undefined> {
    return this._gkReader().then((reader) => this._gkSpendableOf(reader, round))
  }

  private _gkSpendableOf(reader: string, round: bigint | undefined): Promise<bigint | undefined> {
    const spendableCache = gkCacheOf(this.algorand).spendable
    const key = `${reader}@${round ? round : 'latest'}`
    const now = Date.now()
    const cached = spendableCache.get(key)
    if (cached && cached.expires > now) return cached.value
    const entry = { value: Promise.resolve<bigint | undefined>(undefined), expires: now + this.cacheParamsTimeout }
    entry.value = (async () => {
      const node = round !== undefined ? await this.getNode() : undefined
      const algod = this.algorand.client.algod
      let account: GkAccountBalance
      if (round !== undefined && node?.kind === 'dt' && node.limits.timeTravel) {
        // dtalgosdk checks that the node answered for the round (X-Algod-TT-Round), so a node without time travel behind
        // the same address (a load balancer) fails here rather than giving its latest balance as the round's
        account = await gkDTAlgod()!.from(algod).accountInformation(reader).exclude('all').round(round).do()
        // the balance at a past round never changes
        entry.expires = Infinity
      } else {
        account = await algod.accountInformation(reader).exclude('all').do()
      }
      const spendable = account.amount - account.minBalance
      return spendable > 0n ? spendable : 0n
    })().catch((e) => {
      this._gkWarn('spendable', `couldn't read the reader's balance (${(e as Error).message}); paying minimum fees`)
      return undefined
    })
    spendableCache.set(key, entry)
    return entry.value
  }

  /** How the run's groups pay fees: see `ghostFee`. */
  private async _gkFeePlan(target: GkTarget, minFee: bigint): Promise<GkFeePlan> {
    if (this.ghostFee !== 'max') {
      const amount = BigInt(this.ghostFee)
      return amount > 0n ? { kind: 'fixed', amount } : { kind: 'min' }
    }
    const rounds = target.kind === 'latest' ? [undefined] : target.kind === 'round' ? [target.round] : target.rounds
    const spendable = await gkMapLimit(rounds, 8, (round) => this._gkSpendable(round))
    const known = spendable.filter((v): v is bigint => v !== undefined)
    if (known.length === 0) return { kind: 'min' }
    // the rounds share their transactions, so they pay what the reader can spend at every round where it can spend
    // anything; rounds where it can't fail on their own
    const positive = known.filter((v) => v > 0n)
    const least = positive.length ? positive.reduce((a, b) => (b < a ? b : a)) : 0n
    return { kind: 'max', spendable: least, minFee }
  }

  /** Runs prepared calls on a backend; `fallback` is why `_gkRun` fell back to it, for debug. */
  private async _gkRunOn(backend: GhostkitBackend, calls: GkPreparedCall[], target: GkTarget, options: GhostkitRoundsOptions, fallback?: string) {
    const { validityWindow, protocol, round: _round, ...rest } = { ...options, ...calls[0]?.options } as GhostkitRoundsOptions & {
      round?: unknown
    }
    const raw = { extraOpcodeBudget: 170_000, allowMoreLogging: true, allowUnnamedResources: true, ...rest }
    // every backend, custom ones included, rejects an aborted call with the reason, before and after its requests
    gkThrowIfAborted(rest.signal)
    // Ghosts are compiled for recent AVM versions (and maybe v42's larger programs), which older rounds' protocols
    // reject. On a dtalgorand node past rounds run under the latest protocol, a no-op at rounds already on it.
    const past = target.kind !== 'latest'
    const autoProtocol = protocol === undefined && past && gkExtended(backend) ? 'latest' : undefined
    const request = { ...raw, ...((protocol ?? autoProtocol) ? { protocol: (protocol ?? autoProtocol)! } : {}) }

    // queries check no fees or validity, and need the real reader only for `account` arguments: no requests for them
    const query = backend.name === 'query'
    let fees: GkFeePlan = { kind: 'min' }
    let minFee = 1_000n
    let build: GkBuild
    if (query) {
      const reader = this.readerAccount ?? (calls.some((c) => c.needsReader) ? await this._gkReader() : GK_ZERO_ADDRESS)
      build = { reader, fees, params: async () => ({ ...GK_QUERY_PARAMS }) }
    } else {
      // calls at the latest round need fresh params for their validity window; calls at past rounds set their own
      const paramsMaxAge = target.kind === 'latest' ? this.cacheParamsTimeout : GK_PAST_PARAMS_MAX_AGE
      const [params, reader] = await Promise.all([this._gkParams(paramsMaxAge), this._gkReader()])
      minFee = BigInt(params.minFee)
      fees = await this._gkFeePlan(target, minFee)
      build = { reader, fees, params: () => this._gkParams(paramsMaxAge) }
    }
    const groups = calls.flatMap((c) => c.groupsFor(build))
    const feeLabel = fees.kind === 'max' ? `max(${fees.spendable})` : fees.kind === 'fixed' ? `${fees.amount}` : 'min'
    const label = calls.length === 1 ? calls[0].method : `batch(${calls.map((c) => c.method).join(',')})`
    const at = target.kind === 'latest' ? 'latest' : target.kind === 'round' ? `${target.round}` : `rounds(${target.rounds.length})`
    const debug = this.debug ? { id: Math.random().toString(36).substring(2, 10), start: performance.now() } : undefined
    if (debug) {
      if (fallback) console.warn(`[DEBUG] Ghostkit fallback id=${debug.id} m=${label} to=${backend.name} reason=${fallback}`)
      console.warn(
        `[DEBUG] Ghostkit pre id=${debug.id} m=${label} target=${this.ghostAppId ?? 'ghost'} backend=${backend.name} at=${at}` +
          ` groups=${groups.length} txns=${calls.reduce((n, c) => n + c.shape.reduce((m, g) => m + g.length, 0), 0)}` +
          `${query ? '' : ` fee=${feeLabel}`}${request.protocol ? ` protocol=${request.protocol}` : ''} ${JSON.stringify(calls.map((c) => c.shape))}`,
      )
    }

    let rounds: GhostkitRoundOutcome[]
    if (target.kind === 'rounds') {
      const mode = validityWindow === undefined ? 'rewrite' : (validityWindow ?? undefined)
      rounds = await backend.simulateRounds(groups, target.rounds, { ...request, ...(mode ? { validityWindow: mode } : {}) })
    } else {
      const round = target.kind === 'round' ? target.round : undefined
      rounds = [{ round: round ?? 0n, groups: await backend.simulate(groups, { ...request, round }) }]
    }
    gkThrowIfAborted(rest.signal)
    const simEnd = debug ? performance.now() : 0

    const structs = this.appSpec.structs
    const results = rounds.map(({ round, groups: outcomes, protocolOverride }) => {
      let next = 0
      const roundOrUndefined = target.kind === 'latest' ? undefined : round
      const callResults = calls.map((call) => {
        const own = outcomes.slice(next, (next += call.groupCount))
        const failed = own.find((o) => !o.ok)
        if (failed && !failed.ok) {
          return {
            ok: false as const,
            error: new GhostkitError(call.method, roundOrUndefined, failed.error, this._gkHint(backend, target, failed.error, fees)),
          }
        }
        try {
          const value = own.flatMap((o) => gkDecodeLogs<unknown>((o as { logs: Uint8Array[][] }).logs, call.returnType, structs))
          return { ok: true as const, value }
        } catch (e) {
          return { ok: false as const, error: new GhostkitError(call.method, roundOrUndefined, e) }
        }
      })
      return { round: roundOrUndefined, ...(protocolOverride ? { protocolOverride } : {}), calls: callResults }
    })

    if (debug) {
      const end = performance.now()
      // what the groups would pay on chain: each group's usage (millionths of a minimum fee) times the minimum fee, rounded up
      const usages = rounds.flatMap((r) => r.groups).flatMap((o) => (o.ok && o.groupUsage !== undefined ? [BigInt(o.groupUsage)] : []))
      const usage = usages.reduce((a, b) => a + b, 0n)
      const needed = usages.reduce((n, u) => n + (minFee * u + 999_999n) / 1_000_000n, 0n)
      // what the app calls used of their opcode budget, as queries report it
      const costs = rounds.flatMap((r) => r.groups).flatMap((o) => (o.ok && o.cost !== undefined ? [o.cost] : []))
      console.warn(
        `[DEBUG] Ghostkit post id=${debug.id} m=${label} tSim=${(simEnd - debug.start).toFixed(2)}ms tProc=${(end - simEnd).toFixed(2)}ms` +
          ` t=${(end - debug.start).toFixed(2)}ms${usages.length ? ` usage=${usage} feeNeeded=${needed}` : ''}` +
          `${costs.length ? ` cost=${costs.reduce((a, b) => a + b, 0)}` : ''}`,
      )
    }
    return results
  }

  /** A hint for errors that a different node or reader would avoid. */
  private _gkHint(backend: GhostkitBackend, target: GkTarget, error: Error, fees: GkFeePlan): string | undefined {
    const message = error.message ?? ''
    const reader = this.readerAccount ?? 'the fee sink'
    if (/fees is less than|fee .* too small/.test(message)) {
      return fees.kind === 'max'
        ? `the group needs more in fees than the reader (${reader}) can spend: ${fees.spendable} microAlgo; set a readerAccount with more`
        : `ghostFee is ${fees.kind === 'fixed' ? `${fees.amount} microAlgo` : 'the minimum fee'}; 'max' pays what the reader can spend`
    }
    if (/overspend|balance .* below min/i.test(message)) {
      return `the reader (${reader}) can't pay the fees or the ghost app's minimum balance at this round; set a readerAccount funded at it`
    }
    if (/program version \d+ greater than protocol supported version/.test(message)) {
      return gkExtended(backend)
        ? "the ghost's AVM version is newer than this round's protocol allows; leave protocol unset or set it to 'latest'"
        : "the ghost's AVM version is newer than this round's protocol allows; running it there needs a dtalgorand node and the dtalgorand forks of algokit-utils and algosdk"
    }
    if (target.kind !== 'latest' && backend.name === 'stock' && gkStatus(error) !== undefined) {
      return 'a stock node only simulates its last few rounds; use a dtalgorand node with time travel for older rounds'
    }
    // a query reports a round it can't run at as the groups' error, without an HTTP status
    const roundFailed = gkStatus(error) !== undefined || (error as { kind?: string }).kind === 'round'
    if (target.kind !== 'latest' && gkExtended(backend) && !backend.limits.timeTravel && roundFailed) {
      return "this dtalgorand node doesn't have time travel, so only its last few rounds can be simulated"
    }
    return undefined
  }
}
/* END GHOSTKIT RUNTIME */
