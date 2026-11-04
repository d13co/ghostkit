// Offline test helpers: an AlgorandClient that never needs a node, and a backend that runs the example ghost in JS.
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { vi } from 'vitest'
import type { GhostkitBackend, GhostkitGroup, GhostkitGroupOutcome, GhostkitSimulateLimits } from './generated/GhostV11SDK'
import { APP_SPEC as CHUNK_APP_SPEC } from './generated/GhostChunkSDK'
import { GHOSTKIT_STOCK_LIMITS } from './generated/GhostV11SDK'

export const READER = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE'
export const LAST_ROUND = 1_000n

/** An AlgorandClient pointed at nothing (or a stub node's port), with suggested params cached for good. */
export function offlineAlgorand(port = 9, { genesisHash = new Uint8Array(32) }: { genesisHash?: Uint8Array } = {}) {
  const algorand = AlgorandClient.fromConfig({ algodConfig: { server: 'http://127.0.0.1', port, token: 'a'.repeat(64) } })
  algorand.setSuggestedParamsCache(
    {
      fee: 0n,
      minFee: 1000n,
      flatFee: false,
      firstValid: LAST_ROUND,
      lastValid: LAST_ROUND + 1000n,
      genesisID: 'test-v1',
      genesisHash,
    },
    new Date(Date.now() + 3_600_000),
  )
  return algorand
}

// the example's methods, and GhostChunk's extra ones
const methods = CHUNK_APP_SPEC.methods.map((m) => new algosdk.ABIMethod(m))
const RETURN_PREFIX = Uint8Array.from([0x15, 0x1f, 0x7c, 0x75])
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)))

/** What the example ghost logs for a transaction, computed in JS: balance = 1 + index in the call, minBalance = 100,000. */
export function runExampleGhost(txn: algosdk.Transaction, round: bigint): Uint8Array[] {
  return runExampleGhostArgs(txn.applicationCall!.appArgs, round)
}

/** What the example ghost logs for an app call with these app args (see `runExampleGhost`). */
export function runExampleGhostArgs(appArgs: readonly Uint8Array[], round: bigint): Uint8Array[] {
  const [selector, ...args] = appArgs
  const method = methods.find((m) => m.getSelector().every((b, i) => b === selector[i]))!
  // reference arguments (account, asset, application) are indexes, left undecoded
  const decoded = method.args.map((a, i) => (typeof a.type === 'string' ? args[i] : a.type.decode(args[i])))
  const returnType = method.returns.type as algosdk.ABIType
  const logs: Uint8Array[] = []
  switch (method.name) {
    case 'acctBalanceData':
      ;(decoded[0] as string[]).forEach((address, i) => logs.push(returnType.encode([address, BigInt(i + 1), 100_000n])))
      break
    case 'blkTimestamp':
    case 'blkTxnCounter':
      for (let r = decoded[0] as bigint; r <= (decoded[1] as bigint); r++) logs.push(returnType.encode(r * 10n + round))
      break
    case 'accountBalance':
      logs.push(returnType.encode(7n))
      break
    default:
      throw new Error(`fake ghost: ${method.name} not implemented`)
  }
  // the ABI return log, with a zero value (the example's return types are all static)
  return [...logs, concat(RETURN_PREFIX, new Uint8Array(returnType.byteLen()))]
}

export type FakeCall = {
  kind: 'simulate' | 'simulateRounds'
  options: Record<string, unknown>
  rounds?: bigint[]
  /** the transactions of each group, as built */
  groups: algosdk.Transaction[][]
}

/** A backend that builds the groups and runs them with `runExampleGhost`; `fail(round, groupIndex)` makes a group fail. */
export function fakeBackend({
  name = 'stock',
  limits = GHOSTKIT_STOCK_LIMITS,
  fail = () => false,
}: { name?: string; limits?: GhostkitSimulateLimits; fail?: (round: bigint, groupIndex: number) => boolean } = {}) {
  const calls: FakeCall[] = []
  const run = async (group: GhostkitGroup, index: number, round: bigint, validity?: { firstValidRound: bigint; lastValidRound: bigint }) => {
    const { transactions } = await (await group(validity)).buildTransactions()
    const outcome: GhostkitGroupOutcome = fail(round, index)
      ? { ok: false, error: new Error(`group ${index} failed at round ${round}`) }
      : { ok: true, logs: transactions.map((t) => runExampleGhost(t, round)) }
    return { transactions, outcome }
  }
  const backend: GhostkitBackend = {
    name,
    limits,
    async simulate(groups, { round, ...options }) {
      const at = round ?? LAST_ROUND
      const results = await Promise.all(
        groups.map((g, i) => run(g, i, at, round !== undefined ? { firstValidRound: round + 1n, lastValidRound: round + 1n } : undefined)),
      )
      calls.push({ kind: 'simulate', options: { ...options, ...(round !== undefined ? { round } : {}) }, groups: results.map((r) => r.transactions) })
      return results.map((r) => r.outcome)
    },
    async simulateRounds(groups, rounds, options) {
      const perRound = await Promise.all(rounds.map((round) => Promise.all(groups.map((g, i) => run(g, i, round)))))
      calls.push({ kind: 'simulateRounds', options, rounds, groups: perRound[0].map((r) => r.transactions) })
      return rounds.map((round, r) => ({ round, groups: perRound[r].map((x) => x.outcome) }))
    },
  }
  return { backend, calls }
}

export const randomAddresses = (n: number) => Array.from({ length: n }, () => algosdk.generateAccount().addr.toString())

/** A `algorand.query.run` request as the fake got it. */
export type FakeQueryRun = {
  params: {
    program?: Uint8Array
    clearProgram?: Uint8Array
    globalSchema?: { numUint: number; numByteSlice: number }
    appId?: bigint
    sender?: string
    rounds?: bigint[]
    protocol?: string
    calls: { args?: Uint8Array[]; accounts?: string[] }[]
  }
  options?: { signal?: AbortSignal; concurrency?: number }
}

type QueryManagerLike = { run: (params: FakeQueryRun['params'], options?: FakeQueryRun['options']) => Promise<unknown> }

/**
 * Answers `algorand.query.run` (the fork of algokit-utils) with `runExampleGhostArgs`, as the fork's `run` returns
 * results: the latest round (0) is `LAST_ROUND`; `fail(round, callIndex)` fails a call, `roundError(round)` a round.
 */
export function fakeQuery(
  algorand: AlgorandClient,
  {
    fail = () => undefined,
    roundError = () => undefined,
  }: { fail?: (round: bigint, callIndex: number) => string | undefined; roundError?: (round: bigint) => string | undefined } = {},
) {
  const runs: FakeQueryRun[] = []
  const query = (algorand as unknown as { query: QueryManagerLike }).query
  const spy = vi.spyOn(query, 'run').mockImplementation(async (params, options) => {
    runs.push({ params, options })
    const rounds = params.rounds?.length ? params.rounds : [0n]
    return rounds.map((requested) => {
      const round = requested === 0n ? LAST_ROUND : requested
      const roundFailure = roundError(round)
      const calls = params.calls.map((call, callIndex) => {
        const failure = roundFailure ?? fail(round, callIndex)
        if (failure === undefined) return { callIndex, round, ok: true, logs: runExampleGhostArgs(call.args ?? [], round), cost: 10 }
        const kind = roundFailure !== undefined ? 'round' : 'call'
        const error = Object.assign(new Error(`Query call ${callIndex} at round ${round} failed: ${failure}`), { kind, failureMessage: failure })
        return { callIndex, round, ok: false, error }
      })
      return { round, calls }
    })
  })
  return { runs, spy }
}

type SimulateManagerLike = { groups: (...args: unknown[]) => Promise<unknown> }

/**
 * Answers `algorand.simulate.groups` (the fork of algokit-utils) with `runExampleGhost`, recording each request. Like a
 * dt5 node and the fork, it refuses more groups than `maxGroups` in one request, fails a group whose transactions an
 * earlier group of the request already had, and `refuse(round)` makes a request at that round fail as a whole.
 */
export function fakeSimulate(algorand: AlgorandClient, { refuse = () => undefined }: { refuse?: (round: bigint) => string | undefined } = {}) {
  const requests: { kind: 'groups'; options: Record<string, unknown>; groups: algosdk.Transaction[][] }[] = []
  const simulate = (algorand as unknown as { simulate: SimulateManagerLike }).simulate
  const groups = vi.spyOn(simulate, 'groups').mockImplementation(async (composers, options) => {
    const opts = options as Record<string, unknown>
    const list = composers as { buildTransactions(): Promise<{ transactions: algosdk.Transaction[] }> }[]
    if (typeof opts.maxGroups === 'number' && list.length > opts.maxGroups) {
      throw new Error(`Can't simulate ${list.length} groups one after the other: maxGroups allows at most ${opts.maxGroups} per request`)
    }
    const round = opts.round !== undefined ? BigInt(opts.round as bigint) : LAST_ROUND
    const refused = refuse(round)
    if (refused) throw Object.assign(new Error(refused), { status: 400 })
    const built = await Promise.all(list.map((c) => c.buildTransactions()))
    requests.push({ kind: 'groups', options: opts, groups: built.map((b) => b.transactions) })
    const seen = new Set<string>()
    return built.map(({ transactions }) => {
      const ids = transactions.map((t) => t.txID())
      if (ids.some((id) => seen.has(id))) return { round, ok: false, error: new Error(`transaction already in ledger: ${ids[0]}`) }
      ids.forEach((id) => seen.add(id))
      return {
        round,
        ok: true,
        result: { confirmations: transactions.map((t) => ({ logs: runExampleGhost(t, round) })), simulateResponse: { txnGroups: [] } },
      }
    })
  })
  return { requests, groups }
}
