/* BEGIN GHOSTKIT RUNTIME */
// Shared by every ghostkit SDK: ghostkit inlines this file into each SDK it generates, after the algokit-generated
// typed client. It must only import algosdk and algokit-utils, under names that can't clash with the generated client
// (exports start with `Ghostkit`/`GHOSTKIT_`, private names with `gk`). It runs on stock algokit-utils and algosdk, and
// uses the dtalgorand forks' extended simulate when they and the node support it.

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
   * dtalgorand nodes only: simulate under a later consensus protocol (`v24`..`v42`, `latest`, `future` or a version
   * string), as if an upgrade took effect right after the round. Defaults to `latest` at past rounds, since a ghost's
   * AVM version is usually newer than old rounds allow (a no-op at rounds already on the latest protocol); `null`
   * simulates each round under its own protocol.
   */
  protocol?: string | null
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
   * consensus v42 (beyond 2,048 bytes costs a small fee surcharge, which the fee budget covers), else 2,048. The chunked
   * array is one argument, so it also stays within 4,096 bytes, the limit for any one argument.
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

/** What ghostkit found about the node and libraries. */
export type GhostkitNode =
  | { kind: 'dt'; limits: GhostkitSimulateLimits }
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

/** The default limits of a dtalgorand node, which `backend: 'dt'` assumes for a node that doesn't report its own. */
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
  | { ok: true; logs: Uint8Array[][]; groupUsage?: number; protocolOverride?: GhostkitProtocolOverride }
  | { ok: false; error: Error; protocolOverride?: GhostkitProtocolOverride }

/** The outcomes of the groups at one round. */
export type GhostkitRoundOutcome = { round: bigint; groups: GhostkitGroupOutcome[]; protocolOverride?: GhostkitProtocolOverride }

/** A ghost group, built on demand: valid in `validity` if given (unless its calls set their own), else as composed by default. */
export type GhostkitGroup = (validity?: { firstValidRound: bigint; lastValidRound: bigint }) => Promise<GkTransactionComposer>

/** Request-level simulate options as backends get them. */
export type GhostkitRequestOptions = Omit<GhostkitSimulateOptions, 'round' | 'protocol'> & { protocol?: string }

/**
 * Runs ghost simulates. ghostkit picks `ghostkitDTBackend` or `ghostkitStockBackend`; pass your own to the SDK
 * constructor's `backend` to change how simulates are sent.
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
  /** The account the ghost calls are sent from. Defaults to the network's fee sink, which is funded at every round. */
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
   * How to simulate: `auto` (default) uses dtalgorand's extended simulate when algokit-utils and algosdk are the
   * dtalgorand forks and the node reports its simulate limits, else one simulate per group. `dt` uses the extended
   * simulate regardless of the node (with dtalgorand's default limits if it reports none), `stock` never; or pass your
   * own `GhostkitBackend`.
   */
  backend?: 'auto' | 'dt' | 'stock' | GhostkitBackend
  /**
   * What each group pays in fees. Simulate checks fees, and a group's needs aren't known before it runs: consensus v42
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
/** Where a dtalgorand node reports its simulate limits; other nodes answer 404. */
const GK_LIMITS_PATH = '/v2/transactions/simulate/limits'

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

const gkSimulateManager = (algorand: GkAlgorandClient): GkSimulateManager | undefined => {
  const manager = (algorand as unknown as { simulate?: Partial<GkSimulateManager> }).simulate
  return typeof manager?.groups === 'function' && typeof manager?.rounds === 'function' ? (manager as GkSimulateManager) : undefined
}

const gkStatus = (e: unknown): number | undefined => {
  const err = e as { status?: number; response?: { status?: number } } | undefined
  return err?.status ?? err?.response?.status
}

const gkAsError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

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

/** The validity window for a simulate at `round`: valid only in block round + 1, so `block` can look back the furthest. */
const gkValidityAt = (round: bigint) => ({ firstValidRound: round + 1n, lastValidRound: round + 1n })

/** Reads a dtalgorand node's simulate limits, or `undefined` if the node doesn't report them. */
async function gkFetchLimits(algorand: GkAlgorandClient): Promise<GhostkitSimulateLimits | undefined> {
  const http = (algorand.client.algod as unknown as { c?: { get?: (o: { relativePath: string }) => Promise<{ text?: string; body?: Uint8Array }> } }).c
  if (typeof http?.get !== 'function') return undefined
  let res: { text?: string; body?: Uint8Array }
  try {
    res = await http.get({ relativePath: GK_LIMITS_PATH })
  } catch (e) {
    if (gkStatus(e) === 404) return undefined
    throw e
  }
  const raw = JSON.parse(res.text ?? new TextDecoder().decode(res.body)) as Record<string, unknown>
  const num = (key: string, fallback: number) => (typeof raw[key] === 'number' ? (raw[key] as number) : fallback)
  return {
    maxTxnGroups: Math.max(1, num('max-txn-groups', GHOSTKIT_DT_DEFAULT_LIMITS.maxTxnGroups)),
    maxRounds: num('max-rounds', GHOSTKIT_DT_DEFAULT_LIMITS.maxRounds),
    maxExtraOpcodeBudget: num('max-extra-opcode-budget', GHOSTKIT_DT_DEFAULT_LIMITS.maxExtraOpcodeBudget),
    resourceLimitMultiplier: Math.max(1, num('resource-limit-multiplier', 1)),
    timeTravel: raw['time-travel'] === true,
    developerApi: raw['developer-api'] === true,
  }
}

/** Why the loaded libraries can't do dtalgorand's extended simulate, or undefined if they can. */
function gkMissingForks(algorand: GkAlgorandClient): string | undefined {
  if (!gkSimulateManager(algorand)) return 'the loaded algokit-utils is not the dtalgorand fork'
  const dtClient = (gkAlgosdk as unknown as { DTAlgodClient?: { features?: readonly string[] } }).DTAlgodClient
  if (!dtClient?.features?.includes('group-results')) return 'the loaded algosdk is not the dtalgorand fork'
  return undefined
}

/**
 * Finds out whether ghost simulates can use dtalgorand's extended simulate: the loaded algokit-utils and algosdk must be
 * the dtalgorand forks, and the node must report its simulate limits (`GET /v2/transactions/simulate/limits`).
 */
export async function ghostkitDetectNode(algorand: GkAlgorandClient): Promise<GhostkitNode> {
  const stock = (reason: string): GhostkitNode => ({ kind: 'stock', limits: GHOSTKIT_STOCK_LIMITS, reason })
  const missing = gkMissingForks(algorand)
  if (missing) return stock(missing)
  const limits = await gkFetchLimits(algorand)
  return limits ? { kind: 'dt', limits } : stock('the node is not a dtalgorand node (no simulate limits)')
}

/** One simulate request per group, as any algod takes them. */
export function ghostkitStockBackend(algorand: GkAlgorandClient, { concurrency = 8 }: { concurrency?: number } = {}): GhostkitBackend {
  const simulateOne = async (group: GhostkitGroup, options: GhostkitRequestOptions, round?: bigint): Promise<GhostkitGroupOutcome> => {
    try {
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
  const manager = gkSimulateManager(algorand)
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

/** Decodes a transaction's logs: every log but the last, which must be the ABI return. */
function gkDecodeLogs<T>(logs: Uint8Array[][], returnType: string, structs: GkArc56Contract['structs']): T[] {
  return logs.flatMap((txnLogs, i) => {
    const last = txnLogs[txnLogs.length - 1]
    if (!last || last.length < 4 || GK_RETURN_PREFIX.some((b, j) => last[j] !== b)) {
      throw new Error(`transaction ${i} has no ABI return log; ghostkit methods must be ABI methods that return a value`)
    }
    return txnLogs.slice(0, -1).map((log) => gkDecodeValue(log, returnType, structs) as T)
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

/** A call ready to simulate: its groups, and how to decode its results. */
type GkPreparedCall = {
  method: string
  returnType: string
  groupCount: number
  /** the call's groups, paying fees by the plan, with suggested params no older than `paramsMaxAge` ms */
  groupsFor(fees: GkFeePlan, paramsMaxAge: number): GhostkitGroup[]
  /** app calls per group, and arg counts per app call, for debug */
  shape: Record<string, number>[][]
  options?: GhostkitSimulateOptions
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
  /** the backend `auto` fell back to after the node turned out not to support the extended simulate */
  fallback?: GhostkitBackend
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
  limits?: Promise<GhostkitSimulateLimits | undefined>
  /** by reader and round ('latest' for the latest), with when it expires */
  spendable: Map<string, { value: Promise<bigint | undefined>; expires: number }>
}
// Every generated SDK inlines its own copy of this runtime, so the caches live on a global registry for SDKs of
// different contracts to share. The key is versioned: change it when GkClientCache changes shape.
const gkClientCaches: WeakMap<GkAlgorandClient, GkClientCache> = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('ghostkit.clientCaches.v1')
] ??= new WeakMap()) as WeakMap<GkAlgorandClient, GkClientCache>
const gkCacheOf = (algorand: GkAlgorandClient): GkClientCache => {
  let cache = gkClientCaches.get(algorand)
  if (!cache) gkClientCaches.set(algorand, (cache = { spendable: new Map() }))
  return cache
}
/** Caches a promise, forgetting it if it rejects so that the next caller tries again. */
function gkRemember<K extends 'feeSink' | 'node' | 'limits'>(cache: GkClientCache, key: K, make: () => NonNullable<GkClientCache[K]>) {
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
  public backend: 'auto' | 'dt' | 'stock' | GhostkitBackend = 'auto'
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
   * On a dtalgorand node the rounds and calls go in as few requests as its limits allow, rounds any distance apart; on a
   * stock node each call is simulated at each round on its own, and only the last few rounds are available.
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
   * Simulates the calls `fn` makes together: on a dtalgorand node in one request (or as few as its limits allow), on a
   * stock node one request per call, concurrently. `fn` must return the calls' promises (one, or an array) without
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

  /** The backend for this call. Detection is cached per AlgorandClient, so this costs no request after the first. */
  private async _gkResolveBackend(): Promise<GhostkitBackend> {
    const mode = this.backend
    if (typeof mode === 'object') return mode
    if (mode === 'stock') return ghostkitStockBackend(this.algorand)
    if (mode === 'dt') {
      // forced: trust that the node is a dtalgorand node, even if it doesn't report its limits
      const missing = gkMissingForks(this.algorand)
      if (missing) throw new Error(`ghostkit: backend 'dt' can't be used: ${missing}`)
      const limits = await gkRemember(gkCacheOf(this.algorand), 'limits', () => gkFetchLimits(this.algorand))
      return ghostkitDTBackend(this.algorand, limits ?? GHOSTKIT_DT_DEFAULT_LIMITS)
    }
    if (this._gkShared.fallback) return this._gkShared.fallback
    const node = await this.getNode()
    return node.kind === 'dt' ? ghostkitDTBackend(this.algorand, node.limits) : ghostkitStockBackend(this.algorand)
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

  /** A composer whose suggested params come from `_gkParams`, without touching the AlgorandClient's cache. */
  private _gkComposer(paramsMaxAge: number): GkTransactionComposer {
    return new GkTransactionComposer({
      algod: this.algorand.client.algod,
      getSigner: () => gkEmptySigner,
      getSuggestedParams: () => this._gkParams(paramsMaxAge),
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

    const reader = await this._gkReader()
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

    const groupsFor = (plan: GkFeePlan, paramsMaxAge: number): GhostkitGroup[] =>
      groupEntries.map((entries) => async (validity) => {
      const composer = this._gkComposer(paramsMaxAge)
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

    return {
      method,
      returnType: this._gkReturnType(spec.signature),
      groupCount: groupEntries.length,
      groupsFor,
      shape: groupEntries.map((entries) =>
        entries.map(({ args }) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]))),
      ),
      options: input.extraSimulateArgs,
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
    const maxArgBytes = chunk.maxArgBytes ?? (this._gkNeedsV42() ? 16_384 : 2_048)
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

  /** Simulates prepared calls at the target, with the dt backend falling back to stock if the node turns out not to support it. */
  private async _gkRun(
    calls: GkPreparedCall[],
    target: GkTarget,
    options: GhostkitRoundsOptions,
  ): Promise<{ round?: bigint; protocolOverride?: GhostkitProtocolOverride; calls: ({ ok: true; value: unknown[] } | { ok: false; error: GhostkitError })[] }[]> {
    // calls at the latest round need fresh params for their validity window; calls at past rounds set their own
    const paramsMaxAge = target.kind === 'latest' ? this.cacheParamsTimeout : GK_PAST_PARAMS_MAX_AGE
    const minFee = BigInt((await this._gkParams(paramsMaxAge)).minFee)
    let backend = await this._gkResolveBackend()
    try {
      return await this._gkRunOn(backend, calls, target, options, minFee, paramsMaxAge)
    } catch (e) {
      const name = (e as Error)?.name
      if (this.backend !== 'auto' || backend.name !== 'dt' || (name !== 'DTUnsupportedError' && name !== 'DTNotAvailableError')) throw e
      this._gkWarn('dt-fallback', `extended simulate failed (${(e as Error).message}); falling back to one simulate per group`)
      backend = ghostkitStockBackend(this.algorand)
      this._gkShared.fallback = backend
      return this._gkRunOn(backend, calls, target, options, minFee, paramsMaxAge)
    }
  }

  /**
   * What the reader can spend at a round (the latest if undefined) over its minimum balance; undefined if unknown. A node
   * that can't read the account at the round (a stock node answers with the latest, a dtalgorand node without time travel
   * fails) gives its latest balance, the best guess.
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
      const http = (
        this.algorand.client.algod as unknown as {
          c: { get(o: { relativePath: string; query?: Record<string, unknown> }): Promise<{ text?: string; body?: Uint8Array }> }
        }
      ).c
      const read = async (query: Record<string, unknown>) => {
        const res = await http.get({ relativePath: `/v2/accounts/${reader}`, query: { exclude: 'all', ...query } })
        const account = JSON.parse(res.text ?? new TextDecoder().decode(res.body)) as { round?: number; amount?: number; 'min-balance'?: number }
        const spendable = BigInt(account.amount ?? 0) - BigInt(account['min-balance'] ?? 0)
        // the balance at a past round never changes
        if (round && account.round !== undefined && BigInt(account.round) === round) entry.expires = Infinity
        return spendable > 0n ? spendable : 0n
      }
      try {
        return await read(round ? { round } : {})
      } catch (e) {
        if (!round) throw e
        this._gkWarn('spendable-round', `couldn't read the reader's balance at past rounds (${(e as Error).message}); using the latest`)
        return await read({})
      }
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

  private async _gkRunOn(
    backend: GhostkitBackend,
    calls: GkPreparedCall[],
    target: GkTarget,
    options: GhostkitRoundsOptions,
    minFee: bigint,
    paramsMaxAge: number,
  ) {
    const { validityWindow, protocol, round: _round, ...rest } = { ...options, ...calls[0]?.options } as GhostkitRoundsOptions & {
      round?: unknown
    }
    const raw = { extraOpcodeBudget: 170_000, allowMoreLogging: true, allowUnnamedResources: true, ...rest }
    // Ghosts are compiled for recent AVM versions (and maybe v42's larger programs), which older rounds' protocols
    // reject. On a dtalgorand node past rounds run under the latest protocol, a no-op at rounds already on it.
    const past = target.kind !== 'latest'
    const autoProtocol = protocol === undefined && past && backend.name === 'dt' ? 'latest' : undefined
    const request = { ...raw, ...((protocol ?? autoProtocol) ? { protocol: (protocol ?? autoProtocol)! } : {}) }

    const fees = await this._gkFeePlan(target, minFee)
    const groups = calls.flatMap((c) => c.groupsFor(fees, paramsMaxAge))
    const feeLabel = fees.kind === 'max' ? `max(${fees.spendable})` : fees.kind === 'fixed' ? `${fees.amount}` : 'min'
    const label = calls.length === 1 ? calls[0].method : `batch(${calls.map((c) => c.method).join(',')})`
    const at = target.kind === 'latest' ? 'latest' : target.kind === 'round' ? `${target.round}` : `rounds(${target.rounds.length})`
    const debug = this.debug ? { id: Math.random().toString(36).substring(2, 10), start: performance.now() } : undefined
    if (debug) {
      console.warn(
        `[DEBUG] Ghostkit pre id=${debug.id} m=${label} target=${this.ghostAppId ?? 'ghost'} backend=${backend.name} at=${at}` +
          ` groups=${groups.length} txns=${calls.reduce((n, c) => n + c.shape.reduce((m, g) => m + g.length, 0), 0)}` +
          ` fee=${feeLabel}${request.protocol ? ` protocol=${request.protocol}` : ''} ${JSON.stringify(calls.map((c) => c.shape))}`,
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
      console.warn(
        `[DEBUG] Ghostkit post id=${debug.id} m=${label} tSim=${(simEnd - debug.start).toFixed(2)}ms tProc=${(end - simEnd).toFixed(2)}ms` +
          ` t=${(end - debug.start).toFixed(2)}ms${usages.length ? ` usage=${usage} feeNeeded=${needed}` : ''}`,
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
      return backend.name === 'dt'
        ? "the ghost's AVM version is newer than this round's protocol allows; leave protocol unset or set it to 'latest'"
        : "the ghost's AVM version is newer than this round's protocol allows; running it there needs a dtalgorand node and the dtalgorand forks of algokit-utils and algosdk"
    }
    if (target.kind !== 'latest' && backend.name === 'stock' && gkStatus(error) !== undefined) {
      return 'a stock node only simulates its last few rounds; use a dtalgorand node with time travel for older rounds'
    }
    if (target.kind !== 'latest' && backend.name === 'dt' && !backend.limits.timeTravel && gkStatus(error) !== undefined) {
      return "this dtalgorand node doesn't have time travel, so only its last few rounds can be simulated"
    }
    return undefined
  }
}
/* END GHOSTKIT RUNTIME */
