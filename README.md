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

## Ghostkit

Ghostkit is an "SDK generator" that builds on top of the algokit generated client for the ghost contracts.

It exposes an SDK that accepts the following parameters:

- algorand: AlgorandClient
- readerAccount?: string
  - Optional. Sets the account from which to simulate the app calls.
    - Must be funded.
    - Defaults to the testnet fee sink, which should be funded on all public Algorand networks, as well as on localnet.
- ghostAppId?: bigint
  - Optional. If set, calls are made against this deployed application instead of a ghost (simulated) contract. See [Why ghost contract?](#why-ghost-contract) for the trade-offs.
- debug?: boolean
  - Optional. Defaults to `false`. When enabled, each SDK call logs diagnostics to the console (see [Debugging](#debugging)).

Each generated method also accepts per-call options — see [Extra method-call args](#extra-method-call-args-fees--validity) (`extraMethodCallArgs`) and [Simulate options](#simulate-options) (`extraSimulateArgs`).

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
  extraMethodCallArgs: { firstValidRound: 3n, lastValidRound: 3n }
  // ExtraMethodCallArgs: Extra app call arguments, e.g. staticFee, etc.
  // You usually won't need to set validity unless you're dealing with blocks.
})

// data: [1759625702n, 1759625705n]
```

Struct example:

```typescript
const data = await ghostSDK.blkData({
  methodArgsOrArgsArray: { firstRound: 1n, lastRound: 2n },
  extraMethodCallArgs: { firstValidRound: 3n, lastValidRound: 3n }
})

/* data: [
 *   {
 *     round: 2n,
 *     timestamp: 1759625702n,
 *     txnCounter: 1n,
 *     proposer: '3PARL4WNBLOSJNYRAQUNOZIFHI5PD5CPAHNP3WYY4KP2ZHC4XNO2SREQZY'
 *   },
 *   {
 *     round: 3n,
 *     timestamp: 1759625705n,
 *     txnCounter: 3n,
 *     proposer: 'L5BLJ4FNK6FNM7V5NUVT5QI6NQAERLLHYT24XH6RS2DUC4WDHPM5LOLGBY'
 *   }
 * ]
 */
```

### Extra method-call args (fees & validity)

Every generated method takes an optional `extraMethodCallArgs`, a pass-through to algokit's `CommonAppCallParams` (with `appId`/`sender`/`method`/`args`/`onComplete` omitted — the SDK fills those in). So you can set `staticFee`, `extraFee`, `firstValidRound`, `lastValidRound`, `note`, lease, etc. on the underlying app call.

**Funding inner app calls.** A ghost method that issues inner transactions (e.g. an inner ABI call into another app) must carry the fee budget for them on the outer call. Add one inner-transaction min fee per inner call via `extraFee`:

```typescript
// method makes one inner asset/app lookup per input — fund them all
await ghostSDK.getAssetsTiny({
  methodArgsOrArgsArray: { assetIds, abelAppId },
  extraMethodCallArgs: { extraFee: (assetIds.length * 1000).microAlgo() }, // 1000 µAlgo each
})
```

**Per-chunk form.** `extraMethodCallArgs` may be a single object (applied to every app call) or an **array aligned 1:1** with the array form of `methodArgsOrArgsArray` — the SDK uses `extraMethodCallArgs[i]` for the i-th app call. Use this to give each chunk its own fee or validity window.

For the block-validity interplay with simulate rounds, see [Simulate options](#simulate-options).

### Chunking large inputs

`methodArgsOrArgsArray` accepts **either a single args object or an array of them**. When you pass an array, each entry becomes a separate app call within the _same_ simulate, and the decoded results are concatenated in order. This is how you stay under the AVM limits while fetching everything in one round trip.

Two limits force you to chunk:

- **App args < 2KB per app call.** All of a single app call's ABI arguments must fit in ~2KB. For an `address[]`, each address is 32 bytes, so a single app call tops out at 63 accounts (`63 × 32 = 2016`, not 64 because the ABI method selector also takes space.)
- **128 foreign references per simulate.** Across the whole simulate you can reference at most 128 accounts/assets/apps.

So for an `address[]` input you split it into chunks of 63 and pass them as an array. For example, 128 accounts could be split `63, 63, 2` (three app calls) — but each extra app call adds overhead, so it may be better to cap at `126` and do `63, 63` (two app calls) rather than spend a third app call on just 2 extra outputs. You can test this for your use case with debug mode.

```typescript
// helper: split an array into fixed-size chunks
const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size))

// 126 accounts -> [63, 63] -> two app calls in one simulate
const accounts: string[] = /* up to 126 addresses */ []
const methodArgsOrArgsArray = chunk(accounts, 63).map((accounts) => ({ accounts }))

const data = await ghostSDK.acctBalanceData({ methodArgsOrArgsArray })
// data is the flattened results across both app calls, in input order
```

The SDK does not chunk for you — you are responsible for splitting inputs to respect both limits. See [`abel-ghost-sdk`'s `index.ts`](https://github.com/d13co/abel-ghost-sdk) for an example that wraps these methods with a `@chunked(126)` decorator and the `63`-sized inner chunking shown above.

### Simulate options

Every method also takes an optional `extraSimulateArgs` (`RawSimulateOptions`). It is spread **over** the SDK's simulate defaults, so it can override any of them. The defaults are:

- `extraOpcodeBudget: 170_000` — bulk loops burn opcodes; this buys headroom.
- `allowMoreLogging: true` — results are returned as logs, so the per-app log limit is raised.
- `allowEmptySignatures: true` — the reader account never actually signs.
- `allowUnnamedResources: true` — foreign account/asset/app references are resolved automatically.

**Reading block data.** The AVM `block` opcode restricts which rounds it can read based on the *transaction's validity window*: reading field F of block A fails unless A falls between `txn.LastValid - 1002` and `txn.FirstValid` (exclusive) — i.e. roughly the ~1000 rounds below `FirstValid`. So to read up to block `simRound`, push the call's validity above it (`firstValidRound = lastValidRound = simRound + 1`) so the target rounds sit just under `FirstValid` and inside the lookback. Set `extraSimulateArgs.round` to `simRound` so simulate evaluates the group with that (future-dated) validity window accepted rather than treating it as expired:

```typescript
const simRound = lastRound // the latest block you want to read
await ghostSDK.blkData({
  methodArgsOrArgsArray: { firstRound, lastRound },
  extraMethodCallArgs: { firstValidRound: simRound + 1n, lastValidRound: simRound + 1n },
  extraSimulateArgs: { round: simRound },
})
```

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

> **Note:** `debug` and `cacheParamsTimeout` are public fields re-read on every call, so you can toggle them on the instance at runtime, not just via the constructor. (`readerAccount` and `ghostAppId` are baked into the factory/client at construction — set those via the constructor.)

### Suggested params caching

Every call needs suggested transaction params. To avoid issuing a `getSuggestedParams` request to the node on every single call, the SDK primes the underlying `AlgorandClient` suggested-params cache after each fetch, so calls made in quick succession reuse the same params instead of hitting algod again.

The window is controlled by the public `cacheParamsTimeout` field (milliseconds, default `75`):

```typescript
const ghostSDK = new GhostofavmSDK({ algorand })

ghostSDK.cacheParamsTimeout = 1000 // cache for 1s
ghostSDK.cacheParamsTimeout = 0    // disable caching — always fetch fresh params
```

Suggested params only change every few seconds (per block), so a short cache window saves redundant node requests when firing many reads back-to-back without meaningfully affecting validity windows. Bump it higher if you batch a lot of calls, or set it to `0` if you need fresh params on every call.

### Debugging

Pass `debug: true` when constructing the SDK to log per-call diagnostics to the console:

```typescript
const ghostSDK = new GhostofavmSDK({ algorand, debug: true })

await ghostSDK.acctBalanceData({ methodArgsOrArgsArray: { accounts: [addr1, addr2, addr3] } })

// [DEBUG] Ghostkit pre id=k3f9a1x2 m=acctBalanceData target=ghost txns=1 [[{"accounts":3}]]
// [DEBUG] Ghostkit post id=k3f9a1x2 m=acctBalanceData tSim=42.10ms tProc=0.85ms t=42.95ms
```

Each call emits two lines to stderr, correlated by an 8-character `id`:

- **`pre`** (before simulate) — `id`, `m` (method name), `target` (`ghost` for a simulated contract, or the app id when `ghostAppId` is set), `txns` (number of app calls in the group), and the argument-count breakdown as JSON.
- **`post`** (after decoding) — `id`, `m`, and timings in milliseconds: `tSim` (simulate round-trip), `tProc` (log decoding), and `t` (total).

The argument-count breakdown is one entry per app call in the group, each an object mapping arg name to its count — the array length for array args, or `1` if it is not an array arg. For the call above:

```json
[[{ "accounts": 3 }]]
```

i.e. a single app call whose `accounts` arg held 3 addresses. A chunked call of `63, 63` accounts would instead show two entries, each `{ "accounts": 63 }`.

When `debug` is off (the default) there is zero overhead — no timing or logging code runs.

### Warnings and Limitations

⚠ **Warning: Alpha status**. This project is experimental, the API/SDK structure can be considered unstable, etc.

⚠ **Warning: You must enforce your own reference limits**. You can have 128 references in each app/SDK call, so manage your inputs accordingly.

⚠ **Limitation: App args must be < 2KB per app call**. Each app call's ABI arguments must respect the AVM 2KB app args limit. E.g. a single app call cannot look up 128 accounts (128 × 32 = 4096 bytes). The SDK does not split inputs for you, but you can pass an array to `methodArgsOrArgsArray` to spread a large input across multiple app calls in one simulate — see [Chunking large inputs](#chunking-large-inputs).


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

[Ghostkit] Building path/to/contract1.arc56.json... OK
[Ghostkit] Built to: path/to/contract1SDK.ts

[Ghostkit] Building path/to/contract2.arc56.json... OK
[Ghostkit] Built to: path/to/contract2SDK.ts
```

Note: The SDK will be generated in the same directory as the ARC-56 JSON file. See the `examples/` directory for a complete example.

### Install ghostkit

To install ghostkit on your own project, you must currently use the alpha channel:

```bash
npm i ghostkit@alpha
```

ℹ **Hint:** Consider copying the `build` and `build:ghostkit` script commands from `projects/ghostofavm/package.json`


### TODO

- [ ] Increase staticFee to give budget for inner app calls.
  - [x] _Workaround for now: Set `{staticFee: ...}` in `ExtraMethodCallArgs` (2nd method argument)_
- [ ] App call splitting to overcome 2KB inputs/app args limitation

