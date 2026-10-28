import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { GhostBigSDK } from './generated/GhostBigSDK'
import { GhostChunkSDK } from './generated/GhostChunkSDK'
import {
  APP_SPEC,
  GHOST_META,
  GHOSTKIT_DT_DEFAULT_LIMITS,
  GHOSTKIT_RESERVED_MEMBERS,
  GHOSTKIT_STOCK_LIMITS,
  type GhostkitBackend,
  GhostkitError,
  GhostV11SDK,
  ghostkitDetectNode,
  ghostkitQueryBackend,
  ghostkitStockBackend,
} from './generated/GhostV11SDK'
import { GhostV13SDK } from './generated/GhostV13SDK'
import { fakeBackend, fakeQuery, fakeSimulate, LAST_ROUND, offlineAlgorand, randomAddresses, READER } from './helpers'

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

describe('abort', () => {
  const blk = (s: GhostV11SDK) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })
  const aborted = () => {
    const controller = new AbortController()
    controller.abort()
    return controller.signal
  }

  test('an aborted call rejects with the reason on the stock backend, and sends nothing', async () => {
    const algorand = offlineAlgorand()
    const sdk = new GhostV11SDK({ algorand, readerAccount: READER, ghostFee: 100_000n, cacheParamsTimeout: 0, backend: 'stock' })
    const signal = aborted()
    const params = vi.spyOn(algorand, 'getSuggestedParams')
    await expect(sdk.batch((s) => blk(s), { signal })).rejects.toBe(signal.reason)
    await expect(sdk.atRounds([10, 20], (s) => blk(s), { signal })).rejects.toBe(signal.reason)
    expect(params).not.toHaveBeenCalled()
    await expect(sdk.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n }, extraSimulateArgs: { signal } })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  test('the stock backend rejects when the signal aborts during a simulate, and fails only the group otherwise', async () => {
    const backend = ghostkitStockBackend(offlineAlgorand())
    const controller = new AbortController()
    const abortsMidway = async () => {
      controller.abort()
      throw new Error('fetch failed')
    }
    await expect(backend.simulateRounds([abortsMidway], [10n, 20n], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(backend.simulate([abortsMidway], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })

    const fails = async () => {
      throw new Error('fetch failed')
    }
    const live = new AbortController()
    const outcomes = await backend.simulateRounds([fails], [10n], { signal: live.signal })
    expect(outcomes[0].groups[0]).toMatchObject({ ok: false, error: { message: 'fetch failed' } })
  })

  test('a call aborted while a backend runs rejects with the reason, whatever the backend returns', async () => {
    const fake = fakeBackend({ fail: () => true })
    const controller = new AbortController()
    const simulateRounds = fake.backend.simulateRounds.bind(fake.backend)
    fake.backend.simulateRounds = async (...args) => {
      const outcomes = await simulateRounds(...args)
      controller.abort(new Error('navigated away'))
      return outcomes
    }
    const { sdk } = sdkWith(GhostV11SDK, fake)
    await expect(sdk.atRounds([10, 20], (s) => blk(s), { signal: controller.signal })).rejects.toThrow('navigated away')
    expect(fake.calls).toHaveLength(1)
  })

  test('without an abort, a failed round still resolves with ok: false', async () => {
    const { sdk } = sdkWith(GhostV11SDK, fakeBackend({ fail: (round) => round === 20n }))
    const results = await sdk.atRounds([10, 20], (s) => blk(s), { signal: new AbortController().signal })
    expect(results.map((r) => r.ok)).toEqual([true, false])
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
    // 127 addresses fit in 4,096 bytes of app args; 128 unnamed resources per group at 1x
    expect(sizes(calls[0].groups)).toEqual([[127, 1], [127, 1], [44]])
  })

  test('uses the resource multiplier of a dtalgorand node', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK, fakeBackend({ name: 'dt', limits: { ...GHOSTKIT_DT_DEFAULT_LIMITS, resourceLimitMultiplier: 1024 } }))
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts' } })
    expect(sizes(calls[0].groups)).toEqual([[127, 127, 46]])

    // capped at 2,048 bytes, to avoid the fee surcharge beyond it
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts', maxArgBytes: 2_048 } })
    expect(sizes(calls[1].groups)).toEqual([[63, 63, 63, 63, 48]])
  })

  test("uses v42's larger app args for a ghost that needs v42", async () => {
    const { sdk, calls } = sdkWith(GhostV13SDK, fakeBackend({ name: 'dt', limits: { ...GHOSTKIT_DT_DEFAULT_LIMITS, resourceLimitMultiplier: 1024 } }))
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts' } })
    // 511 addresses fit in 16,384 bytes of app args, but the array is one app arg of at most 4,096 bytes: 127 addresses
    expect(sizes(calls[0].groups)).toEqual([[127, 127, 46]])
  })

  test('keeps the chunked array within 4,096 bytes on a stock node and with a larger maxArgBytes', async () => {
    const v13 = sdkWith(GhostV13SDK)
    await v13.sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts' } })
    // 128 unnamed resources per group would allow 128 addresses in one app call: 4,098 bytes
    expect(sizes(v13.calls[0].groups)).toEqual([[127, 1], [127, 1], [44]])

    const v11 = sdkWith(GhostV11SDK, fakeBackend({ name: 'dt', limits: { ...GHOSTKIT_DT_DEFAULT_LIMITS, resourceLimitMultiplier: 1024 } }))
    await v11.sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: { arg: 'accounts', maxArgBytes: 16_384 } })
    expect(sizes(v11.calls[0].groups)).toEqual([[127, 127, 46]])
  })

  test('honours refsPerItem, maxPerTxn and maxPerGroup', async () => {
    const { sdk, calls } = sdkWith(GhostV11SDK)
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: accounts.slice(0, 100) }, chunk: { arg: 'accounts', refsPerItem: 2 } })
    await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: accounts.slice(0, 100) }, chunk: { arg: 'accounts', maxPerTxn: 10, maxPerGroup: 30 } })
    expect(sizes(calls[0].groups)).toEqual([[64], [36]])
    expect(sizes(calls[1].groups)).toEqual([[10, 10, 10], [10, 10, 10], [10, 10, 10], [10]])
  })

  test('sizes app calls next to other arguments, and checks arrays of dynamic items', async () => {
    const { sdk } = sdkWith(GhostChunkSDK)
    type ChunkFn = (signature: string, args: Record<string, unknown>, chunk: object, limits: object) => Record<string, unknown[]>[][]
    const chunkOf = (signature: string, args: Record<string, unknown>, chunk: object) =>
      (sdk as unknown as { _gkChunk: ChunkFn })._gkChunk(signature, args, chunk, GHOSTKIT_DT_DEFAULT_LIMITS)
    const sizesOf = (groups: Record<string, unknown[]>[][], arg: string) => groups.map((g) => g.map((t) => t[arg].length))

    // a 3,000-byte memo (3,002 encoded, with its length prefix) leaves 4,096 - 4 - 3,002 - 2 bytes: 34 addresses
    const memoBalances = 'memoBalances(address[],byte[])uint64'
    const groups = chunkOf(memoBalances, { accounts: accounts.slice(0, 40), memo: new Uint8Array(3_000) }, { arg: 'accounts' })
    expect(sizesOf(groups, 'accounts')).toEqual([[34, 6]])
    expect(() => chunkOf(memoBalances, { accounts, memo: new Uint8Array(4_100) }, { arg: 'accounts' })).toThrow(/leave no room for accounts/)

    // 20-byte tags take 24 bytes each with their length and offset: 170 fit in 4,096 bytes, the per-arg limit
    const tagLengths = 'tagLengths(string[],byte[])uint64'
    const tags = Array.from({ length: 200 }, (_, i) => `${i}`.padStart(20, '0'))
    const args = { tags, memo: new Uint8Array(0) }
    const big = { arg: 'tags', refsPerItem: 0, maxPerTxn: 100, maxArgBytes: 16_384 }
    expect(sizesOf(chunkOf(tagLengths, args, big), 'tags')).toEqual([[100, 100]])
    expect(() => chunkOf(tagLengths, args, { ...big, maxPerTxn: 171 })).toThrow(/171 items of tags take 4106 bytes, more than the 4096 .*lower chunk.maxPerTxn/)
    expect(() => chunkOf(tagLengths, { tags: ['x'.repeat(5_000)], memo: new Uint8Array(0) }, big)).toThrow(/an item of tags takes/)
    await expect(sdk.tagLengths({ methodArgsOrArgsArray: args, chunk: { arg: 'tags', maxPerTxn: 171, refsPerItem: 0 } })).rejects.toThrow(/lower chunk.maxPerTxn/)
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

describe('decoding', () => {
  test('decodes logs that are views into one response buffer', async () => {
    // a dtalgorand simulate response's logs share one buffer; algosdk's ABI decoder ignores a view's byteOffset
    const note = algosdk.ABIType.from('(address,string)')
    const addresses = algosdk.ABIType.from('address[]')
    const backend: GhostkitBackend = {
      name: 'stock',
      limits: GHOSTKIT_STOCK_LIMITS,
      simulate: (groups) =>
        Promise.all(
          groups.map(async (group) => {
            const { transactions } = await (await group()).buildTransactions()
            const logs = transactions.map((t) => {
              const accounts = addresses.decode(t.applicationCall!.appArgs[1]) as string[]
              const encoded = [
                ...accounts.map((a, i) => note.encode([a, `note ${i}`])),
                Uint8Array.from([0x15, 0x1f, 0x7c, 0x75, ...note.encode([accounts[0], ''])]),
              ]
              const buffer = new Uint8Array(3 + encoded.reduce((n, e) => n + e.length, 0)).fill(0xff)
              let offset = 3
              return encoded.map((e) => {
                buffer.set(e, offset)
                offset += e.length
                return buffer.subarray(offset - e.length, offset)
              })
            })
            return { ok: true as const, logs }
          }),
        ),
      simulateRounds: () => Promise.reject(new Error('not used')),
    }
    const { sdk } = sdkWith(GhostChunkSDK, { backend, calls: [] })
    const accounts = randomAddresses(3)
    const notes = await sdk.accountNotes({ methodArgsOrArgsArray: { accounts } })
    expect(notes).toEqual(accounts.map((a, i) => [a, `note ${i}`]))
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

  describe.runIf(forkUtils)('queries', () => {
    const simulateLimits = {
      'max-txn-groups': 16,
      'max-rounds': 16,
      'max-extra-opcode-budget': 640000,
      'resource-limit-multiplier': 128,
      'time-travel': true,
      'developer-api': false,
    }
    const queryLimits = { 'max-calls': 1024, 'max-call-budget': 320000, 'max-call-log-bytes': 65536, 'max-response-bytes': 0, 'max-rounds': 16 }
    /** Serves the simulate limits, with these query limits (none for null). */
    const serve = (query: Record<string, number> | null = queryLimits) => {
      routes['/v2/transactions/simulate/limits'] = { status: 200, body: { ...simulateLimits, ...(query ? { query } : {}) } }
    }
    const blk = (s: GhostV11SDK | GhostChunkSDK) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })
    /** An SDK on the stub node, its algorand.query.run and algorand.simulate faked. */
    function setup<T extends GhostV11SDK | GhostChunkSDK | GhostBigSDK>(
      Sdk: new (p: ConstructorParameters<typeof GhostV11SDK>[0]) => T,
      params: Partial<ConstructorParameters<typeof GhostV11SDK>[0]> = {},
      fakes: Parameters<typeof fakeQuery>[1] = {},
    ) {
      const algorand = offlineAlgorand(port())
      const sdk = new Sdk({ algorand, cacheParamsTimeout: 0, ...params })
      return { sdk, algorand, ...fakeQuery(algorand, fakes), simulated: fakeSimulate(algorand) }
    }
    beforeEach(() => serve())

    test('detects a node with queries', async () => {
      const node = await ghostkitDetectNode(offlineAlgorand(port()))
      expect(node).toEqual({
        kind: 'dt',
        limits: { maxTxnGroups: 16, maxRounds: 16, maxExtraOpcodeBudget: 640000, resourceLimitMultiplier: 128, timeTravel: true, developerApi: false },
        query: { maxCalls: 1024, maxRounds: 16, maxCallBudget: 320000, maxCallLogBytes: 65536, maxResponseBytes: 0 },
      })
      serve(null)
      expect((await ghostkitDetectNode(offlineAlgorand(port()))) as { query?: unknown }).not.toHaveProperty('query')
    })

    test('queries the ghost program at the latest round, with no params, fee sink or balance requests', async () => {
      const { sdk, algorand, runs, simulated } = setup(GhostV11SDK, { ghostFee: 'max' })
      const fetches = vi.spyOn(algorand, 'getSuggestedParams')
      const accounts = randomAddresses(2)
      const data = await sdk.acctBalanceData({ methodArgsOrArgsArray: [{ accounts }, { accounts: accounts.slice(0, 1) }] })
      expect(data.map((d) => d.address)).toEqual([...accounts, accounts[0]])
      expect(data.map((d) => d.balance)).toEqual([1n, 2n, 1n])
      expect(runs).toHaveLength(1)
      const { params } = runs[0]
      expect(Buffer.from(params.program!).toString('base64')).toBe(APP_SPEC.byteCode!.approval)
      expect(Buffer.from(params.clearProgram!).toString('base64')).toBe(APP_SPEC.byteCode!.clear)
      expect(params.sender).toBeUndefined() // the zero address: the round's fee sink
      expect(params.rounds).toEqual([0n])
      expect(params.protocol).toBe('round')
      expect(params.calls).toHaveLength(2)
      expect(params.calls.map((c) => c.args!.length)).toEqual([2, 2])
      expect(fetches).not.toHaveBeenCalled()
      expect(simulated.groups).not.toHaveBeenCalled()
      expect(requests.filter((r) => !r.startsWith('/v2/transactions/simulate/limits'))).toEqual([])
    })

    test('runs past rounds under the latest protocol; null under their own, and a name as given', async () => {
      const { sdk, runs } = setup(GhostV11SDK)
      expect(await blk(sdk.atRound(500))).toEqual([10n + 500n])
      await sdk.atRounds([5], (s) => blk(s), { protocol: null })
      await sdk.atRounds([5], (s) => blk(s), { protocol: 'v40' })
      await blk(sdk)
      expect(runs.map((r) => [r.params.rounds, r.params.protocol])).toEqual([
        [[500n], 'latest'],
        [[5n], 'round'],
        [[5n], 'v40'],
        [[0n], 'round'],
      ])
    })

    test('sends from readerAccount, and from the fee sink for an account argument', async () => {
      const { sdk, runs } = setup(GhostChunkSDK, { readerAccount: READER })
      await blk(sdk)
      expect(runs[0].params.sender).toBe(READER)
      routes['/genesis'] = { status: 200, body: { network: 'stubnet', fees: READER } }
      const other = setup(GhostChunkSDK)
      const [balance] = await other.sdk.accountBalance({ methodArgsOrArgsArray: { account: READER } })
      expect(balance).toBe(7n)
      expect(other.runs[0].params.sender).toBe(READER)
      expect(requests.filter((r) => r === '/genesis')).toHaveLength(1)
    })

    test('atRounds: one request for every round, and a round that fails on its own', async () => {
      const { sdk, runs } = setup(GhostV11SDK, {}, { roundError: (round) => (round === 20n ? 'round 20 is not available' : undefined) })
      const results = await sdk.atRounds([10, 20n, 30], (s) => blk(s))
      expect(runs).toHaveLength(1)
      expect(runs[0].params.rounds).toEqual([10n, 20n, 30n])
      expect(results.map((r) => r.round)).toEqual([10n, 20n, 30n])
      expect(results.map((r) => (r.ok ? r.value : r.error.round))).toEqual([[20n], 20n, [40n]])
      const failed = results[1]
      if (failed.ok) throw new Error('round 20 should fail')
      expect(failed.error.message).toMatch(/Could not query group 0 at round 20: round 20 is not available/)
    })

    test('batch: the calls go in one request, a chunked call keeps its results together', async () => {
      const { sdk, runs } = setup(GhostChunkSDK)
      const accounts = randomAddresses(300)
      const [ts, data] = await sdk.batch((s) => [blk(s), s.acctBalanceData({ methodArgsOrArgsArray: { accounts } })])
      expect(ts).toEqual([10n + LAST_ROUND])
      expect(data.map((d) => d.address)).toEqual(accounts)
      expect(runs).toHaveLength(1)
      // chunked as for the dtalgorand simulate: 127 addresses per app call
      expect(runs[0].params.calls).toHaveLength(1 + 3)
    })

    test('a failed app call fails its group, with where and why', async () => {
      const failure = 'logic eval error: program version 13 greater than protocol supported version 6'
      const { sdk } = setup(GhostV11SDK, {}, { fail: (_, callIndex) => (callIndex === 1 ? failure : undefined) })
      const promise = sdk.atRound(5).blkTimestamp({ methodArgsOrArgsArray: [{ firstRound: 1n, lastRound: 1n }, { firstRound: 1n, lastRound: 1n }] })
      await expect(promise).rejects.toBeInstanceOf(GhostkitError)
      const error = (await promise.catch((e) => e)) as GhostkitError
      expect(error.failedAt).toEqual([1])
      expect(error.failureMessage).toBe(failure)
      expect(error.message).toMatch(/Querying group 0 at round 5 failed at transaction 1: .*leave protocol unset or set it to 'latest'/)
    })

    test('routes calls that need simulate to the extended simulate', async () => {
      const { sdk, runs, simulated } = setup(GhostV11SDK, { readerAccount: READER, ghostFee: 0 })
      await sdk.batch((s) => blk(s), { execTraceConfig: { enable: true } } as never)
      await sdk.batch((s) => blk(s), { extraOpcodeBudget: 400_000 })
      await sdk.atRounds([5], (s) => blk(s), { validityWindow: null })
      await sdk.blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n }, extraMethodCallArgs: { note: 'hi' } })
      await sdk.atRound(5).blkTimestamp({
        methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n },
        extraMethodCallArgs: { firstValidRound: 4n, lastValidRound: 6n },
      })
      expect(runs).toHaveLength(0)
      expect(simulated.requests.map((r) => r.kind)).toEqual(['groups', 'groups', 'rounds', 'groups', 'groups'])
      // within the budget: queried
      await sdk.batch((s) => blk(s), { extraOpcodeBudget: 300_000 })
      expect(runs).toHaveLength(1)
    })

    test('simulates when the node logs less than allowMoreLogging', async () => {
      serve({ ...queryLimits, 'max-call-log-bytes': 0 })
      const { sdk, runs, simulated } = setup(GhostV11SDK, { readerAccount: READER, ghostFee: 0 })
      await blk(sdk)
      await sdk.batch((s) => blk(s), { allowMoreLogging: false })
      expect(simulated.requests).toHaveLength(1)
      expect(runs).toHaveLength(1)
    })

    test("backend 'query' throws for calls that need simulate; 'dt' never queries", async () => {
      const { sdk, runs, simulated } = setup(GhostV11SDK, { readerAccount: READER, ghostFee: 0, backend: 'query' })
      await expect(sdk.batch((s) => blk(s), { extraOpcodeBudget: 400_000 })).rejects.toThrow(/backend 'query' can't run this call: extraOpcodeBudget/)
      expect(await blk(sdk)).toHaveLength(1)
      sdk.backend = 'dt'
      await blk(sdk)
      expect(runs).toHaveLength(1)
      expect(simulated.requests).toHaveLength(1)
    })

    test('simulates a run the node rejects (400), and remembers a program it rejects', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        routes['/v2/query'] = { status: 400, body: { message: 'program and clear-program are 9007 bytes, more than the 8192 an app may have' } }
        const algorand = offlineAlgorand(port())
        const sdk = new GhostBigSDK({ algorand, readerAccount: READER, ghostFee: 0, cacheParamsTimeout: 0 })
        const simulated = fakeSimulate(algorand)
        const run = vi.spyOn((algorand as unknown as { query: { run: () => Promise<unknown> } }).query, 'run')
        expect(await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: randomAddresses(2) } })).toHaveLength(2)
        expect(await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: randomAddresses(2) } })).toHaveLength(2)
        expect(run).toHaveBeenCalledTimes(1)
        expect(simulated.requests).toHaveLength(2)
        expect(warn.mock.calls.filter(([m]) => /the node rejected a query/.test(String(m)))).toHaveLength(1)

        // a round after the latest is about the round: the next run queries again, and simulate says the same, silently
        warn.mockClear()
        routes['/v2/query'] = { status: 400, body: { message: 'round 2000 is after the latest round 1000' } }
        const v11 = setup(GhostV11SDK, { readerAccount: READER, ghostFee: 0 })
        v11.spy.mockRestore()
        const queried = vi.spyOn((v11.algorand as unknown as { query: { run: () => Promise<unknown> } }).query, 'run')
        await blk(v11.sdk.atRound(2000))
        await blk(v11.sdk.atRound(2000))
        expect(queried).toHaveBeenCalledTimes(2)
        expect(v11.simulated.requests).toHaveLength(2)
        expect(warn).not.toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
    })

    test('falls back to the extended simulate for good when the node has no queries after all', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const { sdk, spy, simulated } = setup(GhostV11SDK, { readerAccount: READER, ghostFee: 0 })
        spy.mockRejectedValue(Object.assign(new Error('The node has no query endpoint'), { name: 'DTUnsupportedError' }))
        await blk(sdk)
        await blk(sdk)
        expect(spy).toHaveBeenCalledTimes(1)
        expect(simulated.requests).toHaveLength(2)
      } finally {
        warn.mockRestore()
      }
    })

    test('a group the query backend refuses is simulated', async () => {
      const { sdk, spy, simulated } = setup(GhostV11SDK, { readerAccount: READER, ghostFee: 0 })
      spy.mockRejectedValueOnce(Object.assign(new Error("ghostkit: can't query the group"), { name: 'GhostkitQueryUnsupported' }))
      expect(await blk(sdk)).toHaveLength(1)
      expect(simulated.requests).toHaveLength(1)
      await blk(sdk)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    test('the query backend refuses groups that are not plain NoOp app calls', async () => {
      const algorand = offlineAlgorand(port())
      const backend = ghostkitQueryBackend(algorand)
      const group = async () =>
        algorand.newGroup().addPayment({ sender: READER, receiver: READER, amount: (0).microAlgo(), signer: algosdk.makeEmptyTransactionSigner() })
      await expect(backend.simulate([group], {})).rejects.toMatchObject({ name: 'GhostkitQueryUnsupported' })
    })

    test("an abort rejects, and isn't simulated", async () => {
      const { sdk, spy, simulated } = setup(GhostV11SDK, { readerAccount: READER, ghostFee: 0 })
      // aborted while the query runs: the query gets the signal, and auto doesn't fall back to simulate
      const controller = new AbortController()
      spy.mockImplementation(async (_params, options) => {
        controller.abort()
        options?.signal?.throwIfAborted()
        return []
      })
      await expect(sdk.batch((s) => blk(s), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
      expect(spy.mock.calls[0][1]?.signal).toBe(controller.signal)
      // aborted before: nothing is sent
      await expect(sdk.batch((s) => blk(s), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(simulated.requests).toHaveLength(0)
    })

    test('debug lines', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const { sdk } = setup(GhostV11SDK, { readerAccount: READER, ghostFee: 0, debug: true })
        await blk(sdk)
        await sdk.batch((s) => blk(s), { extraOpcodeBudget: 400_000 })
        const lines = warn.mock.calls.map(([m]) => String(m))
        expect(lines[0]).toMatch(/Ghostkit pre .* backend=query at=latest groups=1 txns=1 \[/)
        expect(lines[0]).not.toMatch(/fee=/)
        expect(lines[1]).toMatch(/Ghostkit post .* cost=10$/)
        expect(lines[2]).toMatch(/Ghostkit fallback .* to=dt reason=extraOpcodeBudget 400000/)
        expect(lines[3]).toMatch(/Ghostkit pre .* backend=dt .* fee=min/)
      } finally {
        warn.mockRestore()
      }
    })

    test('prefetch() fetches no params for queries', async () => {
      const { sdk, algorand } = setup(GhostV11SDK)
      const fetches = vi.spyOn(algorand, 'getSuggestedParams')
      await sdk.prefetch()
      expect(fetches).not.toHaveBeenCalled()
      serve(null)
      const other = setup(GhostV11SDK)
      const otherFetches = vi.spyOn(other.algorand, 'getSuggestedParams')
      await other.sdk.prefetch()
      expect(otherFetches).toHaveBeenCalledTimes(1)
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
