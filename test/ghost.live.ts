// Live checks. Each node's suite is skipped unless its server is set:
//   ALGOD_SERVER=http://localhost:4001       a stock algod on LocalNet (consensus v42), token ALGOD_TOKEN (default aaa…)
//   DT_ALGOD_SERVER=http://host:port         a MainNet dtalgorand node with time travel, token DT_ALGOD_TOKEN
// Runs with both builds of algokit-utils (see vitest.config.ts): the dtalgorand fork batches simulates, stock doesn't.
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { beforeAll, describe, expect, test } from 'vitest'
import { GhostBigSDK } from './generated/GhostBigSDK'
import { GhostChunkSDK } from './generated/GhostChunkSDK'
import { GhostV11SDK, GhostkitError } from './generated/GhostV11SDK'
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
  // with stock algokit-utils there's no protocol override, so the ghost (AVM 11) only runs at rounds that allow it
  const OLD = fork ? 20_000_000n : 64_000_000n
  const MID = fork ? 40_000_000n : 65_000_000n
  // the rewards pool has existed since genesis
  const proposer = '737777777777777777777777777777777777777777777777777UFEJ2CI'
  let last: bigint
  // a dtalgorand node that doesn't report its simulate limits is only used as one when forced
  let hasLimits = false
  let backend: 'auto' | 'dt' = 'auto'

  beforeAll(async () => {
    last = (await algorand.client.algod.status().do()).lastRound
    const res = await fetch(new URL('/v2/transactions/simulate/limits', dtServer), { headers: { 'X-Algo-API-Token': token } })
    hasLimits = res.ok
    backend = fork && !hasLimits ? 'dt' : 'auto'
    sdk.backend = backend
  })

  test('detects the node by its simulate limits', async () => {
    const node = await new GhostV11SDK({ algorand }).getNode()
    expect(node.kind).toBe(fork && hasLimits ? 'dt' : 'stock')
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

  test(`runs an AVM 13 ghost at a pre-v42 round ${fork ? 'under the latest protocol' : '(fails without dtalgorand)'}`, async () => {
    const v13 = new GhostV13SDK({ algorand, backend })
    const results = await v13.atRounds([OLD], (s) => s.acctBalanceData({ methodArgsOrArgsArray: { accounts: [proposer] } }))
    if (fork) {
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
      if (!r.ok) expect(r.error.message).toMatch(/dtalgorand forks/)
    }
  })

  test('chunks to the node limits', async () => {
    const chunked = new GhostChunkSDK({ algorand, backend })
    const accounts = randomAddresses(400)
    const balances = await chunked.atRound(MID).acctBalanceData({ methodArgsOrArgsArray: { accounts } })
    expect(balances.map((b) => b.address)).toEqual(accounts)
  })
})
