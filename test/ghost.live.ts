// Live checks. Each node's suite is skipped unless its server is set:
//   ALGOD_SERVER=http://localhost:4001       a stock algod on LocalNet (consensus v42), token ALGOD_TOKEN (default aaa…)
//   DT_ALGOD_SERVER=http://host:port         a MainNet dtalgorand node with time travel, token DT_ALGOD_TOKEN
// Runs with both builds of algokit-utils (see vitest.config.ts): the dtalgorand fork batches simulates and queries (on a
// node with POST /v2/query), stock doesn't.
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { beforeAll, describe, expect, test } from 'vitest'
import { GhostBigSDK } from './generated/GhostBigSDK'
import { GhostChunkSDK } from './generated/GhostChunkSDK'
import { GhostV11SDK, GhostkitError, ghostkitChangeRounds } from './generated/GhostV11SDK'
import { GhostV13SDK } from './generated/GhostV13SDK'

const DEFAULT_TOKEN = 'a'.repeat(64)

const clientFor = (server: string, token: string) => {
  const url = new URL(server)
  return AlgorandClient.fromConfig({ algodConfig: { server: `${url.protocol}//${url.hostname}`, port: url.port, token } })
}

/** Whether the loaded algokit-utils is the dtalgorand fork. */
const forkUtils = (algorand: AlgorandClient) => typeof (algorand as unknown as { simulate?: { groups?: unknown } }).simulate?.groups === 'function'

const randomAddresses = (n: number) => Array.from({ length: n }, () => algosdk.generateAccount().addr.toString())

async function rest<T>(server: string, token: string, path: string): Promise<T> {
  const res = await fetch(new URL(path, server), { headers: { 'X-Algo-API-Token': token } })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

const localServer = process.env.ALGOD_SERVER
describe.skipIf(!localServer)('stock algod (LocalNet)', () => {
  const token = process.env.ALGOD_TOKEN ?? DEFAULT_TOKEN
  const algorand = clientFor(localServer ?? 'http://localhost', token)
  const sdk = new GhostV11SDK({ algorand })
  let last: bigint

  beforeAll(async () => {
    last = (await algorand.client.algod.status().do()).lastRound
  })

  test('detects a stock node', async () => {
    const node = await sdk.getNode()
    expect(node.kind).toBe('stock')
    if (node.kind === 'stock') {
      expect(node.reason).toMatch(forkUtils(algorand) ? /not a dtalgorand node/ : /algokit-utils is not the dtalgorand fork/)
    }
  })

  test('reads balances from the network fee sink by default', async () => {
    const genesis = JSON.parse(await algorand.client.algod.genesis().do()) as { fees: string }
    const [data] = await sdk.acctBalanceData({ methodArgsOrArgsArray: { accounts: [genesis.fees] } })
    const info = await algorand.account.getInformation(genesis.fees)
    expect(data.address).toBe(genesis.fees)
    // the reader created the ghost app in the simulate, so its minimum balance includes the app's
    expect(data.minBalance).toBe(info.minBalance.microAlgo + 100_000n)
  })

  test('reads block data at a pinned round', async () => {
    const [blk] = await sdk.atRound(last).blkData({ methodArgsOrArgsArray: { firstRound: last, lastRound: last } })
    const header = await algorand.client.algod.block(last).headerOnly(true).do()
    expect(blk.round).toBe(last)
    expect(blk.timestamp).toBe(header.block.header.timestamp)
  })

  test('batches calls', async () => {
    // pinned: on LocalNet algokit-utils' default 1,000-round validity window leaves only the latest block readable
    const [timestamps, balances] = await sdk.atRound(last).batch((s) => [
      s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: last - 2n, lastRound: last } }),
      s.acctBalanceData({ methodArgsOrArgsArray: { accounts: randomAddresses(3) } }),
    ])
    expect(timestamps).toHaveLength(3)
    expect(balances.map((b) => b.balance)).toEqual([0n, 0n, 0n])
  })

  test('simulates at recent rounds, one request each', async () => {
    const results = await sdk.atRounds([last - 1n, last], (s) =>
      s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: last - 3n, lastRound: last - 3n } }),
    )
    expect(results.map((r) => r.round)).toEqual([last - 1n, last])
    for (const r of results) expect(r.ok).toBe(true)
  })

  test('explains why an old round fails', async () => {
    const promise = sdk.atRound(1n).blkTimestamp({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 1n } })
    await expect(promise).rejects.toThrow(GhostkitError)
    await expect(promise).rejects.toThrow(/only simulates its last few rounds/)
  })

  test('runs an AVM 13 ghost', async () => {
    const v13 = new GhostV13SDK({ algorand })
    expect((await v13.acctBalanceData({ methodArgsOrArgsArray: { accounts: randomAddresses(2) } })).length).toBe(2)
  })

  test('runs a ghost with more than 3 extra pages, paying the surcharge out of what the reader can spend', async () => {
    const big = new GhostBigSDK({ algorand })
    const accounts = randomAddresses(2)
    expect(await big.acctBalanceData({ methodArgsOrArgsArray: { accounts } })).toHaveLength(2)
    // the minimum fee doesn't cover the extra pages
    big.ghostFee = 0
    await expect(big.acctBalanceData({ methodArgsOrArgsArray: { accounts } })).rejects.toThrow(/ghostFee is the minimum fee/)
  })

  test("says so when the reader can't pay", async () => {
    const unfunded = new GhostV11SDK({ algorand, readerAccount: randomAddresses(1)[0] })
    await expect(unfunded.acctBalanceData({ methodArgsOrArgsArray: { accounts: randomAddresses(1) } })).rejects.toThrow(
      /can't pay the fees or the ghost app's minimum balance/,
    )
  })

  test('chunks a large input to the consensus limits', async () => {
    const chunked = new GhostChunkSDK({ algorand })
    const accounts = randomAddresses(300)
    const balances = await chunked.acctBalanceData({ methodArgsOrArgsArray: { accounts } })
    expect(balances.map((b) => b.address)).toEqual(accounts)
    // the same input in one app call is too large
    await expect(chunked.acctBalanceData({ methodArgsOrArgsArray: { accounts }, chunk: false })).rejects.toThrow()
  })
})

const dtServer = process.env.DT_ALGOD_SERVER
describe.skipIf(!dtServer)('dtalgorand node (MainNet)', () => {
  const token = process.env.DT_ALGOD_TOKEN ?? DEFAULT_TOKEN
  const algorand = clientFor(dtServer ?? 'http://localhost', token)
  const sdk = new GhostV11SDK({ algorand })
  const fork = forkUtils(algorand)
  // Only queries override the protocol (simulate runs each round under its own), so without them the ghost (AVM 11)
  // only runs at rounds that allow it; set in beforeAll, once it's known whether the node has queries
  let OLD = 64_000_000n
  let MID = 65_000_000n
  // the rewards pool has existed since genesis
  const proposer = '737777777777777777777777777777777777777777777777777UFEJ2CI'
  let last: bigint
  // whether the node has queries on (POST /v2/query), which the fork then uses; every dtalgorand node reports its capabilities
  let hasQuery = false
  const backend = 'auto'

  beforeAll(async () => {
    last = (await algorand.client.algod.status().do()).lastRound
    const capabilities = await rest<{ query?: unknown }>(dtServer!, token, '/v2/capabilities')
    hasQuery = capabilities.query !== undefined
    if (fork && hasQuery) {
      OLD = 20_000_000n
      MID = 40_000_000n
    }
  })

  test('detects the node by its capabilities, and its queries', async () => {
    const node = await new GhostV11SDK({ algorand }).getNode()
    expect(node.kind).toBe(fork ? 'dt' : 'stock')
    expect(node.kind === 'dt' && node.query !== undefined).toBe(fork && hasQuery)
  })

  test('queries give what the multi-group simulate gives', async (ctx) => {
    if (!fork || !hasQuery) ctx.skip()
    const feeSink = 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA'
    // rounds whose own protocol runs the ghost, since simulate can't override it; queries run them under it too
    const rounds = [64_000_000n, 65_000_000n, last - 10n]
    const read = async (via: 'query' | 'dt') => {
      const s = new GhostV11SDK({ algorand, backend: via })
      const balances = await s.atRounds(rounds, (v) => v.acctBalanceData({ methodArgsOrArgsArray: { accounts: [proposer, feeSink] } }), {
        protocol: null,
      })
      const blocks = await Promise.all(
        rounds.map((r) =>
          s.atRound(r).blkData({ methodArgsOrArgsArray: { firstRound: r - 3n, lastRound: r }, extraSimulateArgs: { protocol: null } }),
        ),
      )
      // a query reports how the round's protocol applied; simulate doesn't
      return { balances: balances.map(({ protocolOverride: _override, ...r }) => r), blocks }
    }
    const queried = await read('query')
    const simulated = await read('dt')
    for (const r of queried.balances) if (!r.ok) throw r.error
    expect(queried).toEqual(simulated)
  })

  test('an unfunded reader reads through queries', async (ctx) => {
    if (!fork || !hasQuery) ctx.skip()
    const unfunded = new GhostV11SDK({ algorand, readerAccount: randomAddresses(1)[0] })
    const [data] = await unfunded.acctBalanceData({ methodArgsOrArgsArray: { accounts: [proposer] } })
    expect(data.address).toBe(proposer)
  })

  test('runs a ghost with more than 3 extra pages at the latest round', async () => {
    const big = new GhostBigSDK({ algorand, backend })
    const accounts = randomAddresses(2)
    expect(await big.acctBalanceData({ methodArgsOrArgsArray: { accounts } })).toHaveLength(2)
    expect(await big.acctBalanceData({ methodArgsOrArgsArray: { accounts } })).toHaveLength(2)
  })

  test('reads balances at rounds years apart, matching the node', async () => {
    const rounds = [OLD, MID, last - 10n]
    const results = await sdk.atRounds(rounds, (s) => s.acctBalanceData({ methodArgsOrArgsArray: { accounts: [proposer] } }))
    expect(results.map((r) => r.round)).toEqual(rounds)
    for (const r of results) {
      if (!r.ok) throw r.error
      const account = await rest<{ amount: number; 'min-balance': number }>(
        dtServer!,
        token,
        `/v2/accounts/${proposer}?round=${r.round}&exclude=all`,
      )
      expect(r.value[0].balance).toBe(BigInt(account.amount))
      expect(r.value[0].minBalance).toBe(BigInt(account['min-balance']))
    }
  })

  test('reads the blocks below each round', async () => {
    const read = (round: bigint) =>
      sdk.atRounds([round], (s) => s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: OLD - 5n, lastRound: OLD } }))
    const [atOld] = await read(OLD)
    if (!atOld.ok) throw atOld.error
    const header = await rest<{ block: { ts: number } }>(dtServer!, token, `/v2/blocks/${OLD}?header-only=true&format=json`)
    expect(atOld.value).toHaveLength(6)
    expect(atOld.value[5]).toBe(BigInt(header.block.ts))
    // a round can only read the 1,000 blocks below it
    const [atMid] = await read(MID)
    expect(atMid.ok).toBe(false)
    if (!atMid.ok) expect(atMid.error.message).toMatch(/not available/)
  })

  test('batches calls at a past round', async () => {
    const [timestamps, balances] = await sdk.atRound(MID).batch((s) => [
      s.blkTimestamp({ methodArgsOrArgsArray: { firstRound: MID - 1n, lastRound: MID } }),
      s.acctBalanceData({ methodArgsOrArgsArray: { accounts: [proposer] } }),
    ])
    expect(timestamps).toHaveLength(2)
    expect(balances[0].address).toBe(proposer)
  })

  test('runs an AVM 13 ghost at a pre-v42 round under the latest protocol with queries, and fails without them', async () => {
    const v13 = new GhostV13SDK({ algorand, backend })
    const results = await v13.atRounds([OLD], (s) => s.acctBalanceData({ methodArgsOrArgsArray: { accounts: [proposer] } }))
    if (fork && hasQuery) {
      const [r] = results
      if (!r.ok) throw r.error
      expect(r.protocolOverride?.applied).toBe(true)
      // without the override the program is too new for the round
      const off = await v13.atRounds([OLD], (s) => s.acctBalanceData({ methodArgsOrArgsArray: { accounts: [proposer] } }), {
        protocol: null,
      })
      expect(off[0].ok).toBe(false)
    } else {
      // round 64M runs consensus v41, which allows up to AVM 12
      const [r] = results
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.message).toMatch(fork ? /a dtalgorand node with queries on runs it under the latest/ : /dtalgorand forks/)
    }
  })

  test('chunks to the node limits', async () => {
    const chunked = new GhostChunkSDK({ algorand, backend })
    const accounts = randomAddresses(400)
    const balances = await chunked.atRound(MID).acctBalanceData({ methodArgsOrArgsArray: { accounts } })
    expect(balances.map((b) => b.address)).toEqual(accounts)
  })

  describe('change rounds', () => {
    const feeSink = 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA'
    const USDC = 31_566_704n
    // Reti's validator registry: `numV` counts validators, `v` + id boxes hold them
    const REGISTRY = 2_714_516_089n

    test('lists an asset and an account, merged once per round', async (ctx) => {
      if (!fork) ctx.skip()
      expect(await ghostkitChangeRounds(algorand, [{ asset: USDC }], { maxRound: 60_000_000n })).toEqual({ rounds: [8_874_561n] })
      // the fee sink changes every round
      const merged = await ghostkitChangeRounds(algorand, [{ asset: USDC }, { account: feeSink }], { minRound: 8_874_560n, maxRound: 8_874_562n })
      expect(merged).toEqual({ rounds: [8_874_560n, 8_874_561n, 8_874_562n] })
    })

    test('the latest changes first, read by a ghost at each', async (ctx) => {
      if (!fork) ctx.skip()
      const { rounds, next } = await ghostkitChangeRounds(algorand, [{ account: feeSink }], { order: 'desc', maxRound: 60_000_000n, limit: 2 })
      expect({ rounds, next }).toEqual({ rounds: [60_000_000n, 59_999_999n], next: 59_999_998n })
      const results = await sdk.atRounds(rounds, (s) => s.acctBalanceData({ methodArgsOrArgsArray: { accounts: [feeSink] } }))
      for (const r of results) {
        if (!r.ok) throw r.error
        const account = await rest<{ amount: number }>(dtServer!, token, `/v2/accounts/${feeSink}?round=${r.round}&exclude=all`)
        expect(r.value[0].balance).toBe(BigInt(account.amount))
      }
    })

    describe('with key and prefix filters', () => {
      test('a global state key', async (ctx) => {
        if (!fork) ctx.skip()
        const { rounds, next } = await ghostkitChangeRounds(algorand, [{ app: REGISTRY, key: 'numV' }], { order: 'desc', maxRound: 66_000_000n, limit: 2 })
        expect({ rounds, next }).toEqual({ rounds: [65_770_003n, 65_687_419n], next: 65_687_418n })
        // numV changed in each of these rounds
        const numV = async (round: bigint) => {
          const app = await rest<{ params: { 'global-state': { key: string; value: { uint: number } }[] } }>(
            dtServer!,
            token,
            `/v2/applications/${REGISTRY}?round=${round}`,
          )
          return app.params['global-state'].find((kv) => kv.key === btoa('numV'))?.value.uint
        }
        for (const r of rounds) expect(await numV(r)).not.toBe(await numV(r - 1n))
      })

      test('a box prefix', async (ctx) => {
        if (!fork) ctx.skip()
        const { rounds, next } = await ghostkitChangeRounds(algorand, [{ app: REGISTRY, boxPrefix: 'v' }], { maxRound: 66_000_000n, limit: 3 })
        expect({ rounds, next }).toEqual({ rounds: [46_519_818n, 46_519_867n, 46_520_427n], next: 46_520_428n })
      })
    })
  })
})
