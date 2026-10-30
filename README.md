# Ghostkit & Ghost contracts on Algorand

Ghost contracts: Contracts that do not exist on chain. They are simulated (created on the fly) to return data efficiently from the AVM. [Example puya-ts repo](https://github.com/d13co/ghostofavm).

[Ghostkit](https://github.com/d13co/ghostkit): toy to generate client SDKs for Ghost contracts from ARC-56 specs.

### Example uses

SDKs built with Ghostkit, useful as real-world references:

- [reti-ghost-sdk](https://github.com/d13co/reti-ghost-sdk) — read Réti staking pool data in bulk.
- [abel-ghost-sdk](https://github.com/d13co/abel-ghost-sdk) — bulk account/asset reads with input chunking (`@chunked` decorator, see [Chunking large inputs](#chunking-large-inputs)).
- [algo-metrics-sdk](https://github.com/d13co/algo-metrics-sdk) — derive chain metrics from block data in bulk.

## Why?

### Why AVM code from client?

In AVM context, you have access to a lot resources that can be fetched/filtered/combined with a single simulate:

- 128x apps, assets, accounts
  - e.g. get asset or app information in bulk
  - e.g. get account balances for ALGO or assets in bulk
  - e.g. call ABI read methods of deployed apps and combine in interesting ways

- 1000x blocks
  - e.g. timestamp + txn counter to calculate TPS

### Why ghost contract?

Why do it with a ghost contract instead of a deployed application?

Usually because you need portability to all networks (e.g. explorers, supporting localnets, etc.) or zero-dependency code (a deployed application being updated will not break your code.)

Other reasons could include minimizing the operational complexity (read: laziness) of maintaining contracts for the purpose of simulating reads against.

⚠ If you only care about a single network, a deployed application that you simulate against will outperform a ghost contract. Requests will be smaller on the wire, because the application bytecode does not need to be included on every request, and executing will usually be faster (undocumented empirical finding.)

## How

Ghost contracts usually operate on a list of inputs (otherwise a single input could just as efficiently be done with a GET request to algod.)

In order to avoid running into the 4KB bytestring size restriction of the AVM, Ghost contracts return data by logging individual elements (instead of using ABI return of type xyz[].) The ghost contract SDK parses each logged line to the appropriate type, with full struct support.

## Ghost Contracts

Ghost contracts in this repo are written in puya-ts. puya-py should also work.

All ABI methods:

- must support OnCreate (use `onCreate: 'allow'`)
- must be marked read-only

**Note: The return type of the ABI method is used by the SDK as a hint for decoding the logged data.** The actual value returned by the method is ignored by the SDK, but a return statement is required to satisfy the function signature.

### Simple Example

This method logs the timestamps of blocks between `firstRound` and `lastRound`, inclusive:

```typescript
@abimethod({ readonly: true, onCreate: 'allow' })
public blkTimestamp(firstRound: uint64, lastRound: uint64): uint64 {
  for (let round: uint64 = firstRound; round <= lastRound; round++) {
    log(op.Block.blkTimestamp(round))
  }
  return 0
}
```

The uint64 return type is used as a decode hint for the SDK. The value from the `return 0` line is ignored by the SDK.

### Struct Example

You can log a custom struct/type as such:

```typescript
type BlkData = {
  round: uint64
  timestamp: uint64
  txnCounter: uint64
  proposer: Account
}

@abimethod({ readonly: true, onCreate: 'allow' })
public blkData(firstRound: uint64, lastRound: uint64): BlkData {
  for (let round: uint64 = firstRound; round <= lastRound; round++) {
    const blkData: BlkData = {
      round,
      timestamp: op.Block.blkTimestamp(round),
      proposer: op.Block.blkProposer(round),
      txnCounter: op.Block.blkTxnCounter(round),
    }
    log(encodeArc4(blkData))
  }
  return { round: 0, timestamp: 0, proposer: Global.zeroAddress, txnCounter: 0 } // required by ts, ignored by SDK
}
```

The SDK decodes the structs properly as objects with the fields you defined.

Note: see above note in "simple example" re: return type and value.

### Chunk tag

A method that logs one result per item of an array argument, treating each item on its own, can say so in its doc comment, and the SDK then splits large inputs for you (see [Chunking large inputs](#chunking-large-inputs)):

```typescript
/**
 * Balance data of each account.
 * @ghostkit-chunk accounts
 */
@abimethod({ readonly: true, onCreate: 'allow' })
public acctBalanceData(accounts: Account[]): AcctBalanceData { ... }
```

The tag takes optional `refsPerItem=N` (unnamed resources each item touches, default 1), `maxPerTxn=N`, `maxPerGroup=N` and `maxArgBytes=N`, e.g. `@ghostkit-chunk holdings refsPerItem=2`. Arrays of dynamic items (e.g. `string[]`) need `maxPerTxn`.

Puya-ts leaves JSDoc tags out of a method's description in the ARC-56 spec, so with puya-ts write the tag in backticks, which it keeps: ``Balance data of each account. `@ghostkit-chunk accounts` ``. Ghostkit reads it either way and leaves it out of the generated doc comment.

## Ghostkit

Ghostkit is an "SDK generator" that builds on top of the algokit generated client for the ghost contracts.

The SDK runs on any algod with stock algokit-utils and algosdk. With the [dtalgorand](#dtalgorand-nodes) forks of both and a dtalgorand node it also reads any past round and batches simulates, and on a node with read-only queries (`POST /v2/query`) it sends ghost calls as queries; see [Nodes and libraries](#nodes-and-libraries).

The SDK's constructor takes:

- algorand: AlgorandClient
- readerAccount?: string
  - Optional. The account the ghost calls are sent from. Defaults to the network's fee sink, read from algod's genesis, which every network funds at every round. With queries it needn't be funded.
- ghostAppId?: bigint
  - Optional. If set, calls are made against this deployed application instead of a ghost (simulated) contract. See [Why ghost contract?](#why-ghost-contract) for the trade-offs.
- ghostFee?: bigint | number | 'max'
  - Optional. Defaults to `1_000_000` (1 Algo): what each group's first app call pays in fees when simulated (see [Fees](#fees)). `'max'` pays what the reader can spend; `0` the minimum fee. Queries check no fees.
- backend?: 'auto' | 'query' | 'dt' | 'stock' | GhostkitBackend
  - Optional. Defaults to `auto`. How ghost calls are sent: queries or simulates (see [Nodes and libraries](#nodes-and-libraries)).
- cacheParamsTimeout?: number
  - Optional. Defaults to `3000`. Milliseconds that calls at the latest round reuse suggested params for; `0` fetches them for every call (see [Requests and caching](#requests-and-caching)).
- debug?: boolean
  - Optional. Defaults to `false`. When enabled, each SDK call logs diagnostics to the console (see [Debugging](#debugging)).

Here is how to initialize the SDK:

```typescript
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { GhostofavmSDK } from './examples/GhostofavmSDK' // or wherever your generated ghostkit SDK lives

const algorand = AlgorandClient.mainNet()
const ghostSDK = new GhostofavmSDK({ algorand })
```

Your ABI methods will result in SDK method calls that wrap the ABI methods, with typed arguments.

They will return an array of typed responses from your method, in the order that they were logged.

```typescript
const data = await ghostSDK.blkTimestamp({
  methodArgsOrArgsArray: { firstRound: 1n, lastRound: 2n },
})

// data: [1759625702n, 1759625705n]
```

Struct example:

```typescript
const data = await ghostSDK.blkData({ methodArgsOrArgsArray: { firstRound: 1n, lastRound: 2n } })

/* data: [
 *   { round: 1n, timestamp: 1759625702n, txnCounter: 1n, proposer: '3PARL4WNBLOSJNYRAQUNOZIFHI5PD5CPAHNP3WYY4KP2ZHC4XNO2SREQZY' },
 *   { round: 2n, timestamp: 1759625705n, txnCounter: 3n, proposer: 'L5BLJ4FNK6FNM7V5NUVT5QI6NQAERLLHYT24XH6RS2DUC4WDHPM5LOLGBY' },
 * ]
 */
```

Each method takes:

- `methodArgsOrArgsArray`: the method's arguments, or a list of them (one app call each, in one group; the results are concatenated in order).
- `extraMethodCallArgs?`: see [Extra method-call args](#extra-method-call-args-fees--validity).
- `extraSimulateArgs?`: see [Simulate options](#simulate-options).
- `chunk?`: see [Chunking large inputs](#chunking-large-inputs).

Failures throw a `GhostkitError`, which names the method and round, and carries the node's `failureMessage` and `failedAt`.

### Past rounds

`atRound(round)` returns the same SDK, simulating as of the end of that round:

```typescript
const [balance] = await ghostSDK.atRound(45_000_000n).acctBalanceData({ methodArgsOrArgsArray: { accounts: [address] } })
```

`atRounds(rounds, fn)` runs the calls `fn` makes at each round. `fn` returns the calls' promises, one or an array, without awaiting them. Each round's result is `{ round, ok: true, value }` or `{ round, ok: false, error }`:

```typescript
const results = await ghostSDK.atRounds([20_000_000n, 40_000_000n, 60_000_000n], (s) =>
  s.acctBalanceData({ methodArgsOrArgsArray: { accounts } }),
)
for (const r of results) {
  if (r.ok) console.log(r.round, r.value)
  else console.error(r.round, r.error.message)
}

// several calls per round: the value is a tuple
const [first] = await ghostSDK.atRounds([45_000_000n], (s) => [s.blkTimestamp({ ... }), s.acctBalanceData({ ... })])
```

A stock node can only simulate its last few rounds (usually 4). A dtalgorand node with time travel can simulate any round since genesis, and `atRounds` sends the rounds in as few requests as its limits allow, however far apart they are: with queries, one request per up to `maxCalls` app calls (1,024 by default) and `maxRounds` rounds (16). On a stock node, `atRounds` sends one request per call and round.

Older rounds ran older protocols, which reject recent AVM versions: the example ghost is AVM 11, and MainNet round 40,000,000 only allowed up to AVM 10. On a dtalgorand node past rounds therefore run under the latest protocol by default (queries too), as if it took effect right after the round. This changes nothing at rounds that already ran it. Each round's result has a `protocolOverride` that says whether it applied, with notes on any data the old round never produced. Pass `protocol: null` to simulate each round under its own protocol, or a protocol name (`v24`..`v43`, `latest`) for another.

#### Rounds where things changed

On a dtalgorand node, `ghostkitChangeRounds(algorand, sources, options?)` (exported by every generated SDK) lists the rounds in which any of `sources` changed, from the node's `/versions` listings, merged and deduplicated. Pass them to `atRounds` to read a ghost at every change and nowhere between, instead of sampling rounds evenly:

```typescript
import { ghostkitChangeRounds } from './GhostofavmSDK'

const { rounds, next } = await ghostkitChangeRounds(algorand, [{ app: poolAppId, box: 'stakers' }], { minRound, maxRound })
const series = await ghostSDK.atRounds(rounds, (s) => s.stakerBalances({ methodArgsOrArgsArray: { pool: poolAppId } }))
```

Sources:

- `{ app }`: the app's params and global state; `{ app, key }`: only the rounds in which that global state key changed;
- `{ app, box }`: one box; `{ app, boxPrefix }`: the boxes whose names start with the prefix, such as one ARC-56 box map (`''` for all);
- `{ asset }`: the asset's params;
- `{ account }`: the account's base record (balance, status, ...), not its holdings or app states; `{ account, asset }`: one holding; `{ account, app }`: its local state in the app, with `key` for one local key.

Keys, box names and prefixes given as strings are UTF-8. Options: `minRound`, `maxRound` (inclusive), `order` (`'asc'`, the default, lists the earliest changes first; `'desc'` the latest), `limit` (default 1,000 rounds) and `signal`. When `limit` cuts the list, `next` says where to continue: pass it as `minRound` (`asc`) or `maxRound` (`desc`). With several sources and no `maxRound`, the latest round is read once so every listing ends at the same round.

- A listed round is the round of a change: a ghost read at it sees the state after the change. Pass `round - 1n` to see the state before.
- Round 0 (genesis allocations) is never listed: to `atRounds`, 0 means the latest round.
- `key` and `boxPrefix` filter on the node, which examines a bounded number of versions per page, so pages can be short or empty; they are followed to the end.
- The node's versions errors pass through and aren't retried: a listing that runs over the node's time limit (504) or a history it can't serve (503). Narrow the range.
- It needs the dtalgorand forks of algokit-utils (`algorand.dt`; with stock algokit-utils it throws) and algosdk, and a dtalgorand node with time travel (`getNode()` shows `limits.timeTravel`). On stock algod or a node with time travel off, the fork of algokit-utils rejects the call with dtalgosdk's `DTUnsupportedError` before listing anything.

### Batching calls

`batch(fn)` simulates the calls `fn` makes together, and returns their results. On a dtalgorand node they go in one request (or as few as its limits allow; with queries, up to 1,024 app calls per request by default); on a stock node, one request per call, concurrently. It rejects with the first failed call's error:

```typescript
const [timestamps, balances] = await ghostSDK.batch((s) => [
  s.blkTimestamp({ methodArgsOrArgsArray: { firstRound, lastRound } }),
  s.acctBalanceData({ methodArgsOrArgsArray: { accounts } }),
])

// at a past round
await ghostSDK.atRound(45_000_000n).batch((s) => [...])
```

Inside `batch` and `atRounds`, pass simulate options to them (`batch(fn, options)`, `atRounds(rounds, fn, options)`), not to each call.

### Extra method-call args (fees & validity)

Every generated method takes an optional `extraMethodCallArgs`, a pass-through to algokit's `CommonAppCallParams` (with `appId`/`sender`/`method`/`args`/`onComplete` omitted — the SDK fills those in). So you can set `staticFee`, `extraFee`, `firstValidRound`, `lastValidRound`, `note`, lease, etc. on the underlying app call.

A query sends each app call as the block after the round makes it, so calls that set `firstValidRound`, `lastValidRound`, `validityWindow`, `note`, `lease`, `rekeyTo`, `accessReferences` or `rejectVersion` are simulated instead (see [Simulate options](#simulate-options)).

**Per-call form.** `extraMethodCallArgs` may be a single object (applied to every app call) or an **array aligned 1:1** with the array form of `methodArgsOrArgsArray` — the SDK uses `extraMethodCallArgs[i]` for the i-th app call. Use this to give each app call its own fee or validity window.

### Fees

Queries check no fees, signatures or minimum balances: on a node with queries, ghost calls pay nothing, ghostkit reads no balances, and any reader works, even an unfunded one. The rest of this section is about simulate, which ghostkit uses on other nodes and for calls that can't be queried.

Simulate checks fees like a real submission does, and it has no option to skip them. Since consensus v42 (AVM 13), what a group owes depends on what it uses: programs over 4 pages and app args over 2 KB cost a surcharge, and each inner transaction is charged when the program issues it. So the fee a ghost call needs is only known once it has run, and an underpaid simulate stops at the first shortfall instead of reporting the whole bill.

Nothing is ever paid for a simulate, so each group's first app call offers far more than a ghost needs: `ghostFee`, 1 Algo by default, which covers a thousand minimum fees. The other app calls pay the minimum fee. The reader must hold the fee at the round simulated; the default reader, the fee sink, always does.

For ghosts that need more, or readers that hold less, `ghostFee: 'max'` makes the first app call pay everything the reader can spend at the round simulated (its balance, less its minimum balance and that of the ghost apps the group creates) and the others nothing, so a call only fails for fees if no fee the reader could pay would do. It costs a request for the reader's balance: at the round simulated where the node can answer for it (a dtalgorand node with time travel), else at the latest round. The latest balance is cached as long as suggested params, a past round's for good. With `atRounds`, every round pays the least the reader can spend at any of them, since the rounds share their transactions.

`ghostFee: 0` pays minimum fees everywhere. App calls that set their own `staticFee` or `extraFee` keep them. A call that fails for fees says what it paid, or what the reader could spend.

To see what a call would cost on chain, turn on `debug`: the `post` line gives the groups' fee `usage` from simulate and the fee it means (`feeNeeded`, in microAlgo).

The reader also creates the ghost app in each simulate (and query), so its minimum balance goes up by the app's (100,000 microAlgo per page) during the call: a ghost that reads the reader's own minimum balance sees that included.

### Chunking large inputs

A single app call is limited in how much it can take and touch:

- **App args.** At most 4,096 bytes per app arg, and 16 KB per app call, beyond 2 KB for a fee surcharge (consensus v42, which live networks run and dtalgorand backports to past rounds). A 4 KB `address[]` holds 127 addresses (`127 × 32 = 4064`, plus its length).
- **Unnamed resources.** A group can touch 128 accounts, assets, apps and boxes it doesn't list (8 per app call, 16 app calls). A dtalgorand node can multiply this by up to 1024 (`resource-limit-multiplier`).

Pass `chunk` to have the SDK split an array argument across app calls, and groups if needed, sized to these limits and the node's. The results come back as one array, in input order:

```typescript
const balances = await ghostSDK.acctBalanceData({
  methodArgsOrArgsArray: { accounts }, // any number of addresses
  chunk: { arg: 'accounts' },
})
```

`chunk` takes:

- `arg`: the dynamic array argument to split.
- `refsPerItem?`: unnamed resources each item makes the method touch (default 1; e.g. 2 for an account and its asset holding, 0 for none).
- `maxPerTxn?`, `maxPerGroup?`: caps, e.g. to stay within the opcode budget.
- `maxArgBytes?`: app arg bytes per app call, all arguments together. Defaults to 16,384 for a ghost that needs consensus v42 (AVM 13 or more than 3 extra pages), else 4,096; set 2,048 to avoid the fee surcharge on app args over 2 KB. The chunked array is one app arg, so it also stays within 4,096 bytes, the limit for any one argument. Arrays of dynamic items are split by `maxPerTxn`, and the SDK throws if a call would go over either limit.

A method's [chunk tag](#chunk-tag) sets its default `chunk`; `chunk: false` turns it off. Only split methods that log one result per item and treat items independently. For example, `acctBalanceData(accounts)` qualifies, and a method that sums its inputs doesn't.

On a stock node, 300 addresses become 3 groups (`127 + 1`, `127 + 1`, `44`: 128 unnamed resources per group), simulated concurrently. On a dtalgorand node with a 1024× multiplier they fit in one group of 3 app calls (`127 + 127 + 46`).

With queries the chunks are sized the same way, by the node's simulate limits, so that a call that falls back to simulate fits too. A query runs each app call alone, with the node's `maxCallBudget` (320,000 by default) and no limit on unnamed resources, so anything sized for a simulated group fits.

You can still split inputs yourself by passing a list to `methodArgsOrArgsArray`: each entry becomes an app call in one group.

### Simulate options

Every method also takes an optional `extraSimulateArgs`, spread **over** the SDK's simulate defaults:

- `extraOpcodeBudget: 170_000` — bulk loops burn opcodes; this buys headroom (stock nodes allow up to 320,000 per group).
- `allowMoreLogging: true` — results are returned as logs, so the per-app log limit is raised.
- `allowUnnamedResources: true` — foreign account/asset/app references are resolved automatically.

Signatures are skipped: the reader account never signs. `extraSimulateArgs.protocol` overrides the protocol on a dtalgorand node (see [Past rounds](#past-rounds)), and `extraSimulateArgs.round` is the same as `atRound(round)`.

`signal` (an `AbortSignal`) cancels the call's requests, on any backend: the call (or `batch` / `atRounds`, which take it in their options) rejects with the signal's reason, rather than resolving with failed rounds. Reads the SDK shares between calls (the node's limits, suggested params, the fee sink, the reader's balance) carry on for the other callers.

**With queries.** A query has no simulate options of its own: it gives each app call the node's `maxCallBudget` and up to `maxCallLogBytes` of logs, makes every resource available, and runs each app call alone (`global GroupSize` is 1, no `gtxn`, and `global OpcodeBudget` starts at `maxCallBudget` rather than the group's pooled budget). With `backend: 'auto'`, ghostkit simulates a call instead when:

- `execTraceConfig` is enabled;
- `extraOpcodeBudget` plus 700 per app call of the largest group is more than the node's `maxCallBudget` (the default 170,000 fits in 320,000);
- `allowMoreLogging` is on (the default) and the node's `maxCallLogBytes` is less than simulate's 65,536;
- `atRounds` gets `validityWindow: 'skip'` or `null`;
- `extraMethodCallArgs` sets a field a query can't (see [Extra method-call args](#extra-method-call-args-fees--validity)), or the method has transaction arguments;
- the node rejects the query because a round is after its latest one (HTTP 400): a query fails as a whole, while a simulate fails only that round. The node's other rejections are thrown, since a simulate would fail the same way.

`backend: 'query'` throws for these instead.

**Reading block data.** The AVM `block` opcode can only read the ~1,000 blocks below the transaction's `FirstValid`. `atRound(round)` makes the call valid only in the block after `round`, so it can read the 1,000 blocks up to `round`:

```typescript
await ghostSDK.atRound(lastRound).blkData({ methodArgsOrArgsArray: { firstRound, lastRound } })
```

`atRounds` does the same at each round on a dtalgorand node, by having the node move each transaction's validity window to each round (`validityWindow: 'rewrite'`, the default). At the latest round without `atRound`, the validity window comes from algokit-utils: on LocalNet it is 1,000 rounds wide, which leaves no earlier block readable, so use `atRound`.

## Nodes and libraries

### dtalgorand nodes

A [dtalgorand](https://github.com/d13co/dt-algorand) node is an algod that can also read the state at any past round (time travel), simulate several groups and rounds per request, and run read-only queries (`POST /v2/query`): many calls of one program, each alone, at many rounds, without fees, signatures or minimum balances. Ghostkit uses these through the dtalgorand forks of algokit-utils and algosdk:

| | stock algod | dtalgorand node | dtalgorand node with queries |
| --- | --- | --- | --- |
| stock algokit-utils & algosdk | one simulate per group; the last few rounds | one simulate per group; any round, under its own protocol | as without queries |
| dtalgorand forks | one simulate per group; the last few rounds | groups and rounds batched; any round, under the latest protocol; larger resource limits | queries: app calls and rounds batched, no fees or balances; simulate for calls that need it |

With `backend: 'auto'` (the default), the SDK checks once which applies: whether algokit-utils and algosdk are the forks, then whether the node reports its capabilities (`GET /v2/capabilities`). Every dtalgorand node serves them and stock algod doesn't, so this one request tells them apart; no request is checked for signs of stock algod after that. The capabilities also say which of the node's optional features are on: queries (`query`), several rounds per simulate (`simulate.maxRounds` above 0) and time travel (`timeTravel`). `await ghostSDK.getNode()` shows what it found: `getNode().query` has the query limits when the node has queries on. `backend: 'stock'` skips the checks. `backend: 'dt'` always uses the extended simulate, and throws without the forks or on stock algod. `backend: 'query'` always queries: it throws for calls that need simulate (see [Simulate options](#simulate-options)), without the forks, and on a node with queries off.

Queries and simulate give the same results for ghost calls, except where a ghost depends on what only one of them does: queries check no fees or balances (so an unfunded reader works), run each app call alone with `maxCallBudget`, and report only the called app's logs, as simulate does for ghostkit.

The generated SDK compiles against stock algokit-utils as well as the fork: it uses the fork's features only when they are there at runtime.

### Custom backend

To change how simulates are sent, pass a `GhostkitBackend` as `backend`. It gets each group as a function that builds its `TransactionComposer`, and returns each group's logs or error. `ghostkitStockBackend(algorand)`, `ghostkitDTBackend(algorand, limits)` and `ghostkitQueryBackend(algorand, { limits, concurrency })` are exported to build on. The query backend throws an error named `GhostkitQueryUnsupported` for a group it can't query (anything but NoOp app calls that create the ghost or call an app without programs, or with an access list, `rejectVersion`, a note, a lease or a rekey); with `backend: 'auto'` ghostkit then simulates the call. A backend named `query` gets groups built without suggested params (placeholders: a query ignores fees and validity), and ghostkit plans no fees for it.

### Calling deployed apps directly

The generated `ghostSDK.method({...})` wrappers always simulate an on-the-fly create. When you instead want a normal read against an already-deployed app (standard ABI return, no ghost machinery), use the public `factory` field to get a typed `AppClient`:

```typescript
const { return: labels } = await ghostSDK.factory
  .getAppClientById({ appId })
  .send.getAssetLabels({ args: { assetId } })
```

`factory` is the underlying algokit-generated app factory, so the full typed client API is available for real deployed apps. (The SDK's own `client` is `protected` — go through `factory.getAppClientById(...)` instead.)

### Mapping results to inputs

Methods return a flat array of decoded results — one per logged element, in log order. To look results up by input, zip them back by index:

```typescript
const balances = await ghostSDK.acctBalanceData({ methodArgsOrArgsArray: { accounts } })
const byAccount = new Map(accounts.map((addr, i) => [addr, balances[i]]))
```

Handle any contract sentinels while mapping — e.g. a method that returns the zero address for "not set" can be surfaced as `undefined`:

```typescript
new Map(accounts.map((addr, i) => [addr, auths[i] === ZERO_ADDRESS ? undefined : auths[i]]))
```

> **Note:** `debug`, `cacheParamsTimeout`, `ghostFee` and `backend` are public fields re-read on every call, so you can change them on the instance at runtime. (`ghostAppId` is baked into the client at construction.)

### Requests and caching

A call makes one simulate request, or more where the node needs them: on a stock node one per group (and per round with `atRounds`); on a dtalgorand node as many as its limits require. With queries, a call makes one query request per up to `maxCalls` app calls (1,024 by default) × `maxRounds` rounds (16), up to 4 at a time, and nothing else: no suggested params, no fee sink lookup (unless a method has an `account` argument, which can encode the sender) and no balance reads. A busy node (503 "the node is busy") is retried by the HTTP client of an `AlgorandClient` made from a config (`AlgorandClient.fromConfig`, `mainNet()`, ...), honoring `Retry-After`, or after at least 1 s where the header can't be read (browsers, cross-origin); one made with `fromClients` passes the error on. 503s for history the node can't serve (an incomplete index, a time-travel history that isn't served) and query 504s aren't retried: queries that run over the node's time limit are split by algokit-utils; simulates over it are retried, as upstream algokit-utils does. On top of that, for simulates:

- **Suggested params**, for calls at the latest round, when the cached ones are older than `cacheParamsTimeout` (default 3 s; ghost calls tolerate params a few rounds old, since their validity window is 10 rounds). Calls at past rounds set their own validity, so they reuse params of any age. Params come through `algorand.getSuggestedParams()`, so the AlgorandClient's own cache applies too, and ghostkit never changes it.
- **Once per AlgorandClient**: the node's capabilities (`GET /v2/capabilities`, only with the dtalgorand forks loaded, and with `backend: 'stock'` or a custom backend only for `ghostFee: 'max'` at past rounds), and the genesis to find the fee sink (only without `readerAccount`, and not on MainNet or TestNet, whose fee sinks ghostkit knows).
- **With `ghostFee: 'max'`**, the reader's balance, cached like suggested params. At past rounds a dtalgorand node with time travel reads it at the round, and it is kept for good; other nodes give the latest balance. `atRounds` reads it once per round, up to 8 at a time. Possible improvement, not done: on a dtalgorand node with versions `rounds`, one `accountVersions(reader).rounds(...)` request (values, `exclude=all`) gives the balance and minimum balance at up to 1,000 rounds; round 0 would have to stay a latest read, since to versions it is genesis.

These caches are shared by every ghostkit SDK on the same AlgorandClient, including SDKs generated from different contracts, and concurrent calls share requests in flight. A failed request isn't cached. Node detection isn't repeated, so restart to pick up a node whose config changed.

```typescript
const ghostSDK = new GhostofavmSDK({ algorand, cacheParamsTimeout: 10_000 }) // reuse params for 10 s

ghostSDK.cacheParamsTimeout = 0 // or set it at runtime: fetch params for every call
```

### Debugging

Pass `debug: true` when constructing the SDK to log per-call diagnostics to the console:

```typescript
const ghostSDK = new GhostofavmSDK({ algorand, debug: true })

await ghostSDK.acctBalanceData({ methodArgsOrArgsArray: { accounts: [addr1, addr2, addr3] } })

// [DEBUG] Ghostkit pre id=k3f9a1x2 m=acctBalanceData target=ghost backend=dt at=latest groups=1 txns=1 fee=1000000 [[[{"accounts":3}]]]
// [DEBUG] Ghostkit post id=k3f9a1x2 m=acctBalanceData tSim=42.10ms tProc=0.85ms t=42.95ms usage=1000000 feeNeeded=1000
```

Each call (or `batch`/`atRounds`) emits two lines to stderr, correlated by an 8-character `id`:

- **`pre`** (before simulate): `id`, `m` (the method, or `batch(m1,m2)`), `target` (`ghost`, or the app id when `ghostAppId` is set), `backend` (`query`, `dt` or `stock`), `at` (`latest`, a round, or `rounds(n)`), the number of `groups` and app calls (`txns`), the `fee` plan for simulates (`max(<what the reader can spend>)`, a fixed amount, or `min`; none for queries), the `protocol` if overridden, and the argument counts: one list per call, of one list per group, of one object per app call mapping each argument to its array length (or 1).
- **`post`** (after decoding): `id`, `m`, timings in milliseconds: `tSim` (simulate or query round-trip), `tProc` (log decoding) and `t` (total), the groups' fee `usage` (in millionths of a minimum fee) with the fee it means on chain (`feeNeeded`, in microAlgo), when a simulate reports it, and the opcode budget the app calls used (`cost`), when a query reports it.

When an `auto` call goes to simulate instead of a query, a `fallback` line before its `pre` line says why: `[DEBUG] Ghostkit fallback id=… m=… to=dt reason=…`.

When `debug` is off (the default) there is zero overhead — no timing or logging code runs.

### Warnings and Limitations

⚠ **Warning: Alpha status**. This project is experimental, the API/SDK structure can be considered unstable, etc.

⚠ **Methods can't be overloaded or named after SDK members** (`batch`, `atRound`, `factory`, ...). Ghostkit refuses to build such a spec.

### Compiling

You can create Ghost SDKs using the `ghostkit` npm module, which currently accepts the `build` command and a number of ARC-56 JSON spec files. It will create Ghost SDK files in the same directory as each spec file.

```bash
$ npx ghostkit build examples/Ghostofavm.arc56.json
# or node dist/bin.js build examples/Ghostofavm.arc56.json

[Ghostkit] Building examples/Ghostofavm.arc56.json... OK
[Ghostkit] Built to: examples/GhostofavmSDK.ts
```

You can also build multiple files at once by passing multiple paths:

```bash
$ npx ghostkit build path/to/contract1.arc56.json path/to/contract2.arc56.json
```

Note: The SDK will be generated in the same directory as the ARC-56 JSON file. See the `examples/` directory for a complete example. The ARC-56 spec must include the compiled bytecode (`byteCode`). Ghostkit sizes the ghost app's extra program pages to it, and warns when it needs more than 3, which only consensus v42 networks allow.

The generated SDK imports only `@algorandfoundation/algokit-utils` (9.x, stock or the dtalgorand fork) and `algosdk` (3.x).

### Install ghostkit

To install ghostkit on your own project, you must currently use the alpha channel:

```bash
npm i ghostkit@alpha
```

To use the dtalgorand forks in your project, install them in place of `@algorandfoundation/algokit-utils` and `algosdk` so that your project loads one copy of each: `@d13co/dt-algokit-utils` `9.2.3-dt.4.0.0.1` and `dtalgosdk` `3.9.0-dt.4.0.0.1`, aliased to the stock names, e.g. `"@algorandfoundation/algokit-utils": "file:vendor/d13co-dt-algokit-utils-9.2.3-dt.4.0.0.1.tgz"` and `"algosdk": "file:vendor/dtalgosdk-3.9.0-dt.4.0.0.1.tgz"`. Ghostkit supports the current dtalgorand release only, not nodes or forks of earlier ones. Their versions are prereleases, which no `^x.y.z` peer range accepts, so with npm set `legacy-peer-deps=true` in `.npmrc`, or use pnpm `overrides`.

### Development

The dtalgorand forks are vendored in `vendor/` for now (`dtalgosdk-3.9.0-dt.4.0.0.1.tgz`, `d13co-dt-algokit-utils-9.2.3-dt.4.0.0.1.tgz`), which is why `.npmrc` sets `legacy-peer-deps`.

- `npm run build`: compiles ghostkit and regenerates `examples/GhostofavmSDK.ts`.
- `npm run check:example`: type-checks the example SDK and the tests against the fork of algokit-utils, and the example SDK against stock algokit-utils.
- `npm test`: unit tests, offline, once with each algokit-utils.
- `npm run test:live`: live tests, once with each algokit-utils. Set `ALGOD_SERVER` (e.g. `http://localhost:4001`, a LocalNet on consensus v42) and/or `DT_ALGOD_SERVER` (a MainNet dtalgorand node with time travel); tokens in `ALGOD_TOKEN` / `DT_ALGOD_TOKEN`. Run the dtalgorand suite against a node with queries on and one with them off (`MaxAPIQueryCalls: 0`), to cover both queries and the extended simulate; the query-only tests skip on a node with queries off.

The SDK's runtime is `src/templates/runtime.ts`, a regular module that ghostkit inlines into each generated SDK.

### Migrating from 0.0.x

- The default `readerAccount` is now the network's fee sink, read from algod's genesis, instead of the TestNet/LocalNet fee sink address on every network. Pass `readerAccount` to keep a specific account.
- Each group's first app call pays 1 Algo in fees (`ghostFee`); the ghost app gets the extra pages its program needs instead of always 3.
- `cacheParamsTimeout` defaults to 3,000 ms, and the SDK no longer writes to the AlgorandClient's suggested params cache: it keeps its own, shared by every ghostkit SDK on the client.
- `extraSimulateArgs.round` still works, and `atRound` replaces the validity-window trick for block reads.
- Generated methods return the call's promise directly (they are no longer `async` functions).
