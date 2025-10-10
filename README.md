# Ghostkit & Ghost contracts on Algorand

Ghost contracts: Contracts that do not exist on chain. They are simulated (created on the fly) to return data efficiently from the AVM.

Ghostkit: toy to generate client SDKs for Ghost contracts from ARC-56 specs.

## Why?

### Why AVM code from client?

In AVM context, you have access to a lot resources that can be fetched/filtered/combined with a single simulate:

- 128x apps, assets, accounts*
  - e.g. get asset or app information in bulk
  - e.g. get account balances for ALGO or assets in bulk
  - e.g. call ABI read methods of deployed apps and combine in interesting ways

- 1000x blocks
  - e.g. timestamp + txn counter to calculate TPS

_* You can simulate with 128x account references instead of the usual 64x for real calls_

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

- must support OnCreate 
- must be marked read-only

**Note: The return type of the ABI method is used by the SDK as a hint for decoding the logged data.** The actual value returned by the method is ignored by the SDK, but a return statement is required to satisfy the function signature.

### Simple Example

This method logs the timestamps of blocks between `firstRound` and `lastRound`, inclusive:

```typescript
@abimethod({ readonly: true, onCreate: 'require' })
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

@abimethod({ readonly: true, onCreate: 'require' })
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

Here is how to initialize the SDK:

```typescript
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { GhostofavmSDK } from '../smart_contracts/artifacts/ghostofavm/GhostofavmSDK';

const algorand = AlgorandClient.mainNet()
const ghostSDK = new GhostofavmSDK({ algorand })

```

Your ABI methods will result in SDK method calls that wrap the ABI methods, with typed arguments.

They will return an array of typed responses from your method, in the order that they were logged.

```
const data = await ghostSDK.blkTimestamp(
  { firstRound: 1n, lastRound: 2n },
  { firstValidRound: 3n, lastValidRound: 3n } // ExtraMethodCallArgs: Extra app call arguments, e.g. staticFee, etc.
  // You usually won't need to set validity unless you're dealing with blocks.
);

// data: [1759625702n, 1759625705n]
```

Struct example:

```
const data = await ghostSDK.blkData(
  { firstRound: 1n, lastRound: 2n },
  { firstValidRound: 3n, lastValidRound: 3n }
);

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

### Warnings and Limitations

⚠ **Warning: Alpha status**. This project is experimental, the API/SDK structure can be considered unstable, etc.

⚠ **Warning: You must enforce your own reference limits**. You can have 128 references in each app/SDK call, so manage your inputs accordingly.

⚠ **Limitation: App args must be < 2KB**. A future version of this could attempt to figure out how to split your inputs into multiple grouped app calls, but currently each sdk call will be 1 app call to your abi method, so your inputs must respect the AVM 2KB app args limit. E.g. if you try to look up 128 accounts, you would run into this (128 x 32 = 4096.)


### Compiling

You can create Ghost SDKs using the `ghostkit` npm module, which currently accepts the `build` command and a number of ARC-56 JSON spec files. It will create Ghost SDK files in the same directory as each spec file.

```bash
$ npm run build:ghostkit

> smart_contracts@1.0.0 build:ghostkit
> ghostkit build smart_contracts/artifacts/*/*.arc56.json

[Ghostkit] Building smart_contracts/artifacts/ghostofavm/Ghostofavm.arc56.json... OK
[Ghostkit] Built to: smart_contracts/artifacts/ghostofavm/GhostofavmSDK.ts
```

You can also execute it directly with npx:

```bash
$ npx ghostkit build smart_contracts/artifacts/*/*.arc56.json

[Ghostkit] Building smart_contracts/artifacts/ghostofavm/Ghostofavm.arc56.json... OK
[Ghostkit] Built to: smart_contracts/artifacts/ghostofavm/GhostofavmSDK.ts
```

Note: this project is set up to automatically generate the ghostofavm Ghost SDK when you build the ghostofavm algokit project.

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

