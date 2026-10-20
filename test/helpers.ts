// Offline test helpers: an AlgorandClient that never needs a node, and a backend that runs the example ghost in JS.
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import type { GhostkitBackend, GhostkitGroup, GhostkitGroupOutcome, GhostkitSimulateLimits } from './generated/GhostV11SDK'
import { APP_SPEC, GHOSTKIT_STOCK_LIMITS } from './generated/GhostV11SDK'

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

const methods = APP_SPEC.methods.map((m) => new algosdk.ABIMethod(m))
const RETURN_PREFIX = Uint8Array.from([0x15, 0x1f, 0x7c, 0x75])
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)))

/** What the example ghost logs for a transaction, computed in JS: balance = 1 + index in the call, minBalance = 100,000. */
export function runExampleGhost(txn: algosdk.Transaction, round: bigint): Uint8Array[] {
  const [selector, ...args] = txn.applicationCall!.appArgs
  const method = methods.find((m) => m.getSelector().every((b, i) => b === selector[i]))!
  const decoded = method.args.map((a, i) => (a.type as algosdk.ABIType).decode(args[i]))
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
