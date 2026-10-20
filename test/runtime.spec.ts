import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { GhostBigSDK } from './generated/GhostBigSDK'
import { GhostChunkSDK } from './generated/GhostChunkSDK'
import {
  APP_SPEC,
  GHOST_META,
  GHOSTKIT_DT_DEFAULT_LIMITS,
  GHOSTKIT_RESERVED_MEMBERS,
  GhostkitError,
  GhostV11SDK,
  ghostkitDetectNode,
} from './generated/GhostV11SDK'
import { GhostV13SDK } from './generated/GhostV13SDK'
import { fakeBackend, LAST_ROUND, offlineAlgorand, randomAddresses, READER } from './helpers'

/** Whether the loaded algokit-utils is the dtalgorand fork (it adds `algorand.simulate`). */
const forkUtils = Object.getOwnPropertyDescriptor(AlgorandClient.prototype, 'simulate') !== undefined

function sdkWith<T>(Sdk: new (p: ConstructorParameters<typeof GhostV11SDK>[0]) => T, fake = fakeBackend(), extra = {}) {
  // a fixed fee budget: the default, 'max', reads the reader's balance from a node (see the stub node tests)
  const params = { algorand: offlineAlgorand(), readerAccount: READER, cacheParamsTimeout: 0, backend: fake.backend, ghostFee: 100_000n, ...extra }
  return { sdk: new Sdk(params), ...fake }
}

const sizes = (groups: { applicationCall?: { appArgs: readonly Uint8Array[] } }[][]) =>
  groups.map((g) => g.map((t) => (t.applicationCall!.appArgs[1][0] << 8) | t.applicationCall!.appArgs[1][1]))

describe('ghost calls', () => {
  test('creates the ghost from its bytecode, with the fee budget on the first call', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    const accounts = randomAddresses(2)
    const data = await sdk.acctBalanceData({ methodArgsOrArgsArray: [{ accounts }, { accounts: accounts.slice(0, 1) }] })
    expect(data.map((d) => d.address)).toEqual([...accounts, accounts[0]])
    expect(data.map((d) => d.balance)).toEqual([1n, 2n, 1n])

    const [first, second] = calls[0].groups[0]
    expect(first.applicationCall!.appIndex).toBe(0n)
    expect(Buffer.from(first.applicationCall!.approvalProgram).toString('base64')).toBe(APP_SPEC.byteCode!.approval)
    expect(first.applicationCall!.extraPages).toBe(GHOST_META.extraProgramPages)
    expect(first.sender.toString()).toBe(READER)
    expect(first.fee).toBe(100_000n)
    expect(second.fee).toBe(1_000n)
  })

  test('sizes extra pages to the program', async () => {
    const { sdk, calls } = sdkWith(GhostBigSDK)
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: randomAddresses(1) } })
    expect(calls[0].groups[0][0].applicationCall!.extraPages).toBe(4)
  })

  test('keeps a fee the call sets, and ghostFee 0 leaves the minimum fee', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: [] }, extraMethodCallArgs: { staticFee: (5_000).microAlgo() } })
    expect(calls[0].groups[0][0].fee).toBe(5_000n)
    sdk.ghostFee = 0
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: [] } })
    expect(calls[1].groups[0][0].fee).toBe(1_000n)
  })

  test('calls a deployed app with ghostAppId', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK, fakeBackend(), { ghostAppId: 1234n })
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: randomAddresses(1) } })
    const [txn] = calls[0].groups[0]
    expect(txn.applicationCall!.appIndex).toBe(1234n)
    expect(txn.applicationCall!.approvalProgram).toHaveLength(0)
  })

  test('passes simulate options over the defaults', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: [] }, extraSimulateArgs: { extraOpcodeBudget: 1 } })
    expect(calls[0].options).toMatchObject({ extraOpcodeBudget: 1, allowMoreLogging: true, allowUnnamedResources: true })
  })

  test('checks extraMethodCallArgs lines up with the calls', async () => {
    const { sdk } = sdkWith(GhostV11SDK)
    await expect(
      sdk.acctBalanceData({ methodArgsOrArgsArray: [{ accounts: [] }, { accounts: [] }], extraMethodCallArgs: [{}] }),
    ).rejects.toThrow(/1 entries for 2 calls/)
  })

  test('wraps failures in a GhostkitError', async () => {
    const { sdk } = sdkWith(GhostV11SDK, fakeBackend({ fail: () => true }))
    const promise = sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: [] } })
    await expect(promise).rejects.toBeInstanceOf(GhostkitError)
    await expect(promise).rejects.toThrow(/acctBalanceData failed: group 0 failed/)
  })

  test('the SDK has no own members that a method could shadow', () => {
    const { sdk } = sdkWith(GhostV11SDK)
    for (const key of Object.keys(sdk)) {
      expect(GHOSTKIT_RESERVED_MEMBERS.includes(key) || key.startsWith('_gk'), key).toBe(true)
    }
  })
})

describe('atRound', () => {
  test('simulates at the round, valid only in the next block', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    const [ts] = await sdk.atRound(500).blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })
    expect(ts).toBe(10n + 500n)
    expect(calls[0].options.round).toBe(500n)
    const [txn] = calls[0].groups[0]
    expect([txn.firstValid, txn.lastValid]).toEqual([501n, 501n])
  })

  test('keeps a validity window the call sets', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await sdk.atRound(500).blkTimestamp({
      methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n },
      extraMethodCallArgs: { firstValidRound: 490n, lastValidRound: 520n },
    })
    expect([calls[0].groups[0][0].firstValid, calls[0].groups[0][0].lastValid]).toEqual([490n, 520n])
  })

  test('takes extraSimulateArgs.round as before, but not a different one from atRound', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await sdk.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n }, extraSimulateArgs: { round: 7 } })
    expect(calls[0].options.round).toBe(7n)
    await expect(
      sdk.atRound(8).blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n }, extraSimulateArgs: { round: 7 } }),
    ).rejects.toThrow(/conflicts/)
  })
})

describe('batch', () => {
  test('simulates the calls together and returns each result', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    const accounts = randomAddresses(3)
    const [timestamps, balances] = await sdk.batch((s) => [
      s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 2n } }),
      s.acctBalanceData({ methodArgsOrArgsArray: { accounts } }),
    ])
    expect(timestamps).toEqual([10n + LAST_ROUND, 20n + LAST_ROUND])
    expect(balances.map((b) => b.address)).toEqual(accounts)
    expect(calls).toHaveLength(1)
    expect(calls[0].groups).toHaveLength(2)
  })

  test('takes a single call', async () => {
    const { sdk } = sdkWith(GhostV11SDK)
    const timestamps = await sdk.batch((s) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } }))
    expect(timestamps).toEqual([10n + LAST_ROUND])
  })

  test('rejects with the failed call, while the others resolve', async () => {
    const { sdk } = sdkWith(GhostV11SDK, fakeBackend({ fail: (_, i) => i === 1 }))
    let first: Promise<bigint[]> | undefined
    await expect(
      sdk.batch((s) => {
        first = s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })
        return [first, s.blkTxnCounter({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })]
      }),
    ).rejects.toThrow(/blkTxnCounter failed/)
    await expect(first).resolves.toEqual([10n + LAST_ROUND])
  })

  test('needs the calls returned unawaited, and simulate options on batch', async () => {
    const { sdk } = sdkWith(GhostV11SDK)
    await expect(
      sdk.batch(async (s) => {
        return [await s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })] as never
      }),
    ).rejects.toThrow(/without awaiting/)
    await expect(
      sdk.batch((s) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n }, extraSimulateArgs: { extraOpcodeBudget: 1 } })),
    ).rejects.toThrow(/pass simulate options to them/)
  })

  test('at a pinned round', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await sdk.atRound(42).batch((s) => [s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })])
    expect(calls[0].options.round).toBe(42n)
  })
})

describe('atRounds', () => {
  test('returns each round, with validity windows rewritten by default', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK, fakeBackend({ fail: (round) => round === 20n }))
    const results = await sdk.atRounds([10, 20n, 30], (s) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } }))
    expect(calls[0]).toMatchObject({ kind: 'simulateRounds', rounds: [10n, 20n, 30n], options: { validityWindow: 'rewrite' } })
    expect(results.map((r) => r.round)).toEqual([10n, 20n, 30n])
    expect(results.map((r) => (r.ok ? r.value : r.error.round))).toEqual([[20n], 20n, [40n]])
  })

  test('returns a tuple per round for several calls', async () => {
    const { sdk } = sdkWith(GhostV11SDK)
    const accounts = randomAddresses(1)
    const [r] = await sdk.atRounds([5], (s) => [
      s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } }),
      s.acctBalanceData({ methodArgsOrArgsArray: { accounts } }),
    ])
    if (!r.ok) throw r.error
    const [timestamps, balances] = r.value
    expect(timestamps).toEqual([15n])
    expect(balances[0].address).toBe(accounts[0])
  })

  test('validityWindow null leaves the windows alone', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await sdk.atRounds([5], (s) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } }), { validityWindow: null })
    expect(calls[0].options.validityWindow).toBeUndefined()
  })
})

describe('protocol', () => {
  const dt = () => fakeBackend({ name: 'dt', limits: GHOSTKIT_DT_DEFAULT_LIMITS })
  const call = (s: GhostV11SDK | GhostV13SDK) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })

  test('runs past rounds under the latest protocol on a dtalgorand node', async () => {
    const { sdk, calls } = sdkWith(GhostV13SDK, dt())
    await call(sdk.atRound(5))
    await sdk.atRounds([5], (s) => call(s))
    await call(sdk)
    expect(calls.map((c) => c.options.protocol)).toEqual(['latest', 'latest', undefined])
  })

  test('null keeps each round under its own protocol, and a name is passed on', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK, dt())
    await sdk.atRounds([5], (s) => call(s), { protocol: null })
    await sdk.atRounds([5], (s) => call(s), { protocol: 'v40' })
    expect(calls.map((c) => c.options.protocol)).toEqual([undefined, 'v40'])
  })

  test('is not set for a stock node', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await call(sdk.atRound(5))
    expect(calls[0].options.protocol).toBeUndefined()
  })
})

describe('chunking', () => {
  const accounts = randomAddresses(300)

  test('sizes app calls by app arg bytes and groups by unnamed resources (stock limits)', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    const data = await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts' } })
    expect(data.map((d) => d.address)).toEqual(accounts)
    // 63 addresses fit in 2,048 bytes of app args; 128 unnamed resources per group at 1x
    expect(sizes(calls[0].groups)).toEqual([[63, 63, 2], [63, 63, 2], [44]])
  })

  test('uses the resource multiplier of a dtalgorand node', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK, fakeBackend({ name: 'dt', limits: { ...GHOSTKIT_DT_DEFAULT_LIMITS, resourceLimitMultiplier: 1024 } }))
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts' } })
    expect(sizes(calls[0].groups)).toEqual([[63, 63, 63, 63, 48]])
  })

  test("uses v42's larger app args for a ghost that needs v42", async () => {
    const { sdk, calls } = sdkWith(GhostV13SDK, fakeBackend({ name: 'dt', limits: { ...GHOSTKIT_DT_DEFAULT_LIMITS, resourceLimitMultiplier: 1024 } }))
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts' } })
    expect(sizes(calls[0].groups)).toEqual([[300]])
  })

  test('honours refsPerItem, maxPerTxn and maxPerGroup', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: accounts.slice(0, 100) }, chunk: { arg: 'accounts', refsPerItem: 2 } })
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: accounts.slice(0, 100) }, chunk: { arg: 'accounts', maxPerTxn: 10, maxPerGroup: 30 } })
    expect(sizes(calls[0].groups)).toEqual([[63, 1], [36]])
    expect(sizes(calls[1].groups)).toEqual([[10, 10, 10], [10, 10, 10], [10, 10, 10], [10]])
  })

  test("defaults to the method's @ghostkit-chunk tag, which chunk: false turns off", async () => {
    const { sdk, calls } = sdkWith(GhostChunkSDK)
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts } })
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: false })
    expect(calls[0].groups).toHaveLength(3)
    expect(sizes(calls[1].groups)).toEqual([[300]])
  })

  test('rejects inputs it cannot split', async () => {
    const { sdk } = sdkWith(GhostV11SDK)
    await expect(
      sdk.acctBalanceData({ methodArgsOrArgsArray: [{ accounts }], chunk: { arg: 'accounts' } }),
    ).rejects.toThrow(/single methodArgsOrArgsArray/)
    await expect(
      sdk.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 2n }, chunk: { arg: 'firstRound' } }),
    ).rejects.toThrow(/not a dynamic array/)
  })

  test('a chunked call in a batch keeps its results together', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    const [ts, data] = await sdk.batch((s) => [
      s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } }),
      s.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts' } }),
    ])
    expect(ts).toHaveLength(1)
    expect(data.map((d) => d.address)).toEqual(accounts)
    expect(calls[0].groups).toHaveLength(4)
  })
})

describe('with a stub node', () => {
  type Route = { status: number; body?: unknown }
  let server: Server
  /** responses by path; a function gets the query */
  let routes: Record<string, Route | ((query: URLSearchParams) => Route)> = {}
  let requests: string[] = []
  const port = () => (server.address() as AddressInfo).port

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x')
      requests.push(`${url.pathname}${url.search}`)
      const r = routes[url.pathname]
      const route = (typeof r === 'function' ? r(url.searchParams) : r) ?? { status: 404, body: { message: 'Not Found' } }
      res.writeHead(route.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(route.body ?? {}))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
  beforeEach(() => {
    routes = {}
    requests = []
  })

  describe('node detection', () => {
    const limits = {
      'max-txn-groups': 8,
      'max-rounds': 4,
      'max-extra-opcode-budget': 640000,
      'resource-limit-multiplier': 64,
      'time-travel': true,
      'developer-api': false,
    }

    test.runIf(forkUtils)('reads the limits a dtalgorand node reports', async () => {
      routes = { '/v2/transactions/simulate/limits': { status: 200, body: limits } }
      expect(await ghostkitDetectNode(offlineAlgorand(port()))).toEqual({
        kind: 'dt',
        limits: { maxTxnGroups: 8, maxRounds: 4, maxExtraOpcodeBudget: 640000, resourceLimitMultiplier: 64, timeTravel: true, developerApi: false },
      })
    })

    test('takes a node without simulate limits for a stock node', async () => {
      const node = await ghostkitDetectNode(offlineAlgorand(port()))
      expect(node.kind).toBe('stock')
      if (node.kind === 'stock') expect(node.reason).toMatch(forkUtils ? /no simulate limits/ : /algokit-utils is not the dtalgorand fork/)
    })

    test('probes once per AlgorandClient, for every ghostkit SDK on it', async () => {
      routes = { '/v2/transactions/simulate/limits': { status: 200, body: limits } }
      const algorand = offlineAlgorand(port())
      const [a, b] = [new GhostV11SDK({ algorand }), new GhostV13SDK({ algorand })]
      await Promise.all([a.getNode(), a.getNode(), b.getNode()])
      await a.atRound(5).getNode()
      expect(requests.filter((r) => r.startsWith('/v2/transactions/simulate/limits'))).toHaveLength(forkUtils ? 1 : 0)
    })
  })

  describe('the fee sink', () => {
    const call = (s: GhostV11SDK) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })
    const sender = (fake: ReturnType<typeof fakeBackend>, i: number) => fake.calls[i].groups[0][0].sender.toString()

    test('is read from the genesis once per AlgorandClient', async () => {
      routes = { '/genesis': { status: 200, body: { network: 'stubnet', fees: READER } } }
      const algorand = offlineAlgorand(port())
      const fake = fakeBackend()
      await Promise.all([call(new GhostV11SDK({ algorand, backend: fake.backend })), call(new GhostV11SDK({ algorand, backend: fake.backend }))])
      expect(requests.filter((r) => r === '/genesis')).toHaveLength(1)
      expect(sender(fake, 0)).toBe(READER)
    })

    test('is known for MainNet without a request', async () => {
      const algorand = offlineAlgorand(port(), { genesisHash: Uint8Array.from(Buffer.from('wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=', 'base64')) })
      const fake = fakeBackend()
      await call(new GhostV11SDK({ algorand, backend: fake.backend }))
      expect(requests).toEqual([])
      expect(sender(fake, 0)).toBe('Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA')
    })
  })

  describe("ghostFee 'max'", () => {
    const sdkOn = <T>(Sdk: new (p: ConstructorParameters<typeof GhostV11SDK>[0]) => T, fake = fakeBackend()) => ({
      sdk: new Sdk({ algorand: offlineAlgorand(port()), readerAccount: READER, cacheParamsTimeout: 0, backend: fake.backend, ghostFee: 'max' }),
      ...fake,
    })
    /**
     * The reader's balance and minimum balance by round, and at the latest round (999), which a node answers with for
     * rounds it can't read, as a stock node does.
     */
    const reader = (byRound: Record<string, [number, number]>) => {
      routes[`/v2/accounts/${READER}`] = (query) => {
        const asked = query.get('round')
        const known = asked !== null && asked in byRound
        const [amount, minBalance] = (known ? byRound[asked] : byRound.latest) ?? [0, 0]
        return { status: 200, body: { address: READER, round: known ? Number(asked) : 999, amount, 'min-balance': minBalance } }
      }
    }
    const accounts = randomAddresses(2)

    test("pays what the reader can spend, less the ghost apps' minimum balance, on the first app call", async () => {
      reader({ latest: [10_000_000, 100_000] })
      const { sdk, calls } = sdkOn(GhostV11SDK)
      await sdk.acctBalanceData({ methodArgsOrArgsArray: [{ accounts }, { accounts }] })
      // 9,900,000 spendable, less 100,000 for each of the 2 ghost apps
      expect(calls[0].groups[0].map((t) => t.fee)).toEqual([9_700_000n, 0n])
      expect(requests).toContain(`/v2/accounts/${READER}?exclude=all`)
    })

    test("counts the ghost app's extra pages", async () => {
      reader({ latest: [10_000_000, 100_000] })
      const { sdk, calls } = sdkOn(GhostBigSDK)
      await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts } })
      expect(calls[0].groups[0][0].fee).toBe(9_900_000n - 500_000n)
    })

    test('leaves app calls that set their own fees, and takes those fees out of the budget', async () => {
      reader({ latest: [10_000_000, 100_000] })
      const { sdk, calls } = sdkOn(GhostV11SDK)
      await sdk.acctBalanceData({
        methodArgsOrArgsArray: [{ accounts }, { accounts }, { accounts }],
        extraMethodCallArgs: [{}, { staticFee: (2_000).microAlgo() }, { extraFee: (3_000).microAlgo() }],
      })
      expect(calls[0].groups[0].map((t) => t.fee)).toEqual([9_900_000n - 300_000n - 2_000n - 4_000n, 2_000n, 4_000n])
      await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, extraMethodCallArgs: { staticFee: (5_000).microAlgo() } })
      expect(calls[1].groups[0][0].fee).toBe(5_000n)
    })

    test('reads the balance at each past round on a dtalgorand node, and pays the least that any round can', async () => {
      reader({ '10': [5_000_000, 100_000], '20': [0, 0], '30': [50_000_000, 100_000] })
      const { sdk, calls } = sdkOn(GhostV11SDK, fakeBackend({ name: 'dt', limits: GHOSTKIT_DT_DEFAULT_LIMITS }))
      await sdk.atRounds([10, 20, 30], (s) => s.acctBalanceData({ methodArgsOrArgsArray: { accounts } }))
      // round 20 can't pay anything and fails on its own; round 10 can spend the least of the others
      expect(calls[0].groups[0][0].fee).toBe(4_900_000n - 100_000n)
      expect(requests.filter((r) => r.startsWith('/v2/accounts')).sort()).toEqual(
        ['10', '20', '30'].map((r) => `/v2/accounts/${READER}?exclude=all&round=${r}`),
      )
    })

    test("reads the balance at a pinned round, or the latest if the node can't", async () => {
      reader({ '5': [1_000_000, 100_000], latest: [50_000_000, 100_000] })
      const { sdk, calls } = sdkOn(GhostV11SDK)
      await sdk.atRound(5).acctBalanceData({ methodArgsOrArgsArray: { accounts } })
      await sdk.atRound(6).acctBalanceData({ methodArgsOrArgsArray: { accounts } })
      expect(calls.map((c) => c.groups[0][0].fee)).toEqual([800_000n, 49_800_000n])
      // round 5's balance is kept; round 6's answer was the latest balance, which isn't
      reader({ '5': [2_000_000, 100_000], latest: [60_000_000, 100_000] })
      await sdk.atRound(5).acctBalanceData({ methodArgsOrArgsArray: { accounts } })
      await sdk.atRound(6).acctBalanceData({ methodArgsOrArgsArray: { accounts } })
      expect(calls.slice(2).map((c) => c.groups[0][0].fee)).toEqual([800_000n, 59_800_000n])
    })

    test("pays the minimum fee when the reader can't pay more, or its balance can't be read", async () => {
      reader({ latest: [100_500, 100_000] })
      const { sdk, calls } = sdkOn(GhostV11SDK)
      await sdk.acctBalanceData({ methodArgsOrArgsArray: [{ accounts }, { accounts }] })
      expect(calls[0].groups[0].map((t) => t.fee)).toEqual([1_000n, 1_000n])
      routes = {}
      await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts } })
      expect(calls[1].groups[0][0].fee).toBe(1_000n)
    })

    test('explains fee failures', async () => {
      reader({ latest: [10_000_000, 100_000] })
      const fake = fakeBackend()
      fake.backend.simulate = async () => [{ ok: false, error: new Error('txgroup with 1000 fees is less than 3000 (usage=3000000 * base=1000)') }]
      const { sdk } = sdkOn(GhostV11SDK, fake)
      await expect(sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts } })).rejects.toThrow(/than the reader \(.+\) can spend: 9900000 microAlgo/)
      sdk.ghostFee = 0
      await expect(sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts } })).rejects.toThrow(/ghostFee is the minimum fee; 'max' pays/)
    })
  })
})

describe('suggested params', () => {
  const call = (s: GhostV11SDK | GhostV13SDK) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })
  const expiryOf = (algorand: AlgorandClient) => (algorand as unknown as { _cachedSuggestedParamsExpiry: Date })._cachedSuggestedParamsExpiry

  test("are shared by every ghostkit SDK on an AlgorandClient, without changing the client's cache", async () => {
    const algorand = offlineAlgorand()
    const expiry = expiryOf(algorand)
    const fetches = vi.spyOn(algorand, 'getSuggestedParams')
    const fake = fakeBackend()
    const a = new GhostV11SDK({ algorand, readerAccount: READER, backend: fake.backend })
    const b = new GhostV13SDK({ algorand, readerAccount: READER, backend: fake.backend })
    await Promise.all([call(a), call(b), call(a)])
    await a.batch((s) => [call(s), s.blkTxnCounter({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })])
    expect(fetches).toHaveBeenCalledTimes(1)
    expect(expiryOf(algorand)).toBe(expiry)
  })

  test('are fetched again after cacheParamsTimeout for the latest round, and reused at past rounds', async () => {
    const algorand = offlineAlgorand()
    const fetches = vi.spyOn(algorand, 'getSuggestedParams')
    const sdk = new GhostV11SDK({ algorand, readerAccount: READER, backend: fakeBackend().backend, cacheParamsTimeout: 1_000 })
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    try {
      await call(sdk)
      now.mockReturnValue(start + 500)
      await call(sdk)
      expect(fetches).toHaveBeenCalledTimes(1)
      now.mockReturnValue(start + 5_000)
      await call(sdk.atRound(5))
      await sdk.atRounds([5, 6], (s) => call(s))
      expect(fetches).toHaveBeenCalledTimes(1)
      await call(sdk)
      expect(fetches).toHaveBeenCalledTimes(2)
    } finally {
      now.mockRestore()
    }
  })
})
