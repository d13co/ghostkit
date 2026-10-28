import type { AlgorandClient as GkAlgorandClient } from '@algorandfoundation/algokit-utils/types/algorand-client';
import { type Arc56Contract as GkArc56Contract } from '@algorandfoundation/algokit-utils/types/app-arc56';
import { TransactionComposer as GkTransactionComposer, type CommonAppCallParams as GkCommonAppCallParams, type RawSimulateOptions as GkRawSimulateOptions } from '@algorandfoundation/algokit-utils/types/composer';
import * as gkAlgosdk from 'algosdk';
/** A round number. */
export type GhostkitRound = number | bigint;
/** Extra app call parameters for each ghost call: fees, validity, note, lease, references. */
export type GhostkitExtraMethodCallArgs = Omit<GkCommonAppCallParams, 'appId' | 'sender' | 'method' | 'args' | 'onComplete'>;
/** Simulate options. They are spread over the defaults (`extraOpcodeBudget: 170_000`, `allowMoreLogging`, `allowUnnamedResources`). */
export type GhostkitSimulateOptions = Omit<GkRawSimulateOptions, 'allowEmptySignatures' | 'fixSigners'> & {
    /**
     * dtalgorand nodes only: simulate under a later consensus protocol (`v24`..`v42`, `latest`, `future` or a version
     * string), as if an upgrade took effect right after the round. Defaults to `latest` at past rounds, since a ghost's
     * AVM version is usually newer than old rounds allow (a no-op at rounds already on the latest protocol); `null`
     * simulates each round under its own protocol.
     */
    protocol?: string | null;
    /**
     * Cancels the call's requests; the call rejects with the signal's reason, whatever the backend. Shared reads (limits,
     * suggested params, the fee sink, the reader's balance) carry on for other callers.
     */
    signal?: AbortSignal;
};
/** Options for simulating at several rounds. */
export type GhostkitRoundsOptions = Omit<GhostkitSimulateOptions, 'round'> & {
    /**
     * dtalgorand nodes only: how the node treats the transactions' validity window at each round. `rewrite` (default)
     * moves it to each simulated round, so rounds any distance apart share a request and programs (e.g. `block`) see
     * each round as the current one. `skip` evaluates the transactions as built. `null` uses neither, so the rounds of a
     * request must be within 1,000 rounds of each other.
     */
    validityWindow?: 'skip' | 'rewrite' | null;
};
/**
 * Splits one call's array argument into several app calls, and several groups if needed, sized to the node's limits.
 * The method must log one result per item, in order, and treat each item independently of the others.
 */
export type GhostkitChunkOptions = {
    /** The name of the dynamic array argument to split. */
    arg: string;
    /** Unnamed resources (accounts, assets, apps, boxes, holdings) each item makes the method touch; default 1. */
    refsPerItem?: number;
    /** At most this many items per app call. */
    maxPerTxn?: number;
    /** At most this many items per group, e.g. to stay within the opcode budget. */
    maxPerGroup?: number;
    /**
     * The most app argument bytes per app call, all arguments together. Defaults to 16,384 for a ghost that needs
     * consensus v42, else 4,096 (beyond 2,048 bytes costs a small fee surcharge, which the fee budget covers; set 2,048
     * to avoid it). The chunked array is one argument, so it also stays within 4,096 bytes, the limit for any one argument.
     */
    maxArgBytes?: number;
};
/** The input of a generated SDK method. */
export type GhostkitMethodInput<TArgs> = {
    /** The method's arguments, or a list of them: one app call each, in one group. */
    methodArgsOrArgsArray: TArgs | TArgs[];
    /** Extra app call parameters, for every app call or one per entry of `methodArgsOrArgsArray`. */
    extraMethodCallArgs?: GhostkitExtraMethodCallArgs | GhostkitExtraMethodCallArgs[];
    /** Simulate options for this call. Inside `batch` and `atRounds`, pass them to those instead. */
    extraSimulateArgs?: GhostkitSimulateOptions;
    /** Split an array argument across app calls and groups (see `GhostkitChunkOptions`); `false` turns off the method's default. */
    chunk?: GhostkitChunkOptions | false;
};
/** The simulate limits of a node. */
export type GhostkitSimulateLimits = {
    /** Most groups per simulate request. */
    maxTxnGroups: number;
    /** Most rounds per simulate request; 0 when the node can't simulate several rounds per request. */
    maxRounds: number;
    /** Most extra opcode budget per group. */
    maxExtraOpcodeBudget: number;
    /** The factor on the consensus limits on unnamed resources. */
    resourceLimitMultiplier: number;
    /** Whether any round since genesis can be simulated; otherwise only the last few (usually 4). */
    timeTravel: boolean;
    /** Whether `protocol: 'future'` and execution traces are allowed. */
    developerApi: boolean;
};
/** The query limits of a dtalgorand node with queries (`POST /v2/query`). */
export type GhostkitQueryLimits = {
    /** Most calls per query request. */
    maxCalls: number;
    /** Most rounds per query request. */
    maxRounds: number;
    /** The most opcode budget of each call, which each call gets by default. */
    maxCallBudget: number;
    /** The most log bytes of each call; 0 for the consensus limits (1,024 bytes, 32 logs). */
    maxCallLogBytes: number;
    /** The most bytes of a response's logs and errors; 0 for no limit. */
    maxResponseBytes: number;
};
/**
 * What ghostkit found about the node and libraries. A dtalgorand node has `query` when it has queries and the loaded
 * dtalgorand forks can send them.
 */
export type GhostkitNode = {
    kind: 'dt';
    limits: GhostkitSimulateLimits;
    query?: GhostkitQueryLimits;
} | {
    kind: 'stock';
    limits: GhostkitSimulateLimits;
    reason: string;
};
/** The limits of a stock algod's simulate. */
export declare const GHOSTKIT_STOCK_LIMITS: GhostkitSimulateLimits;
/** The default limits of a dtalgorand node, which `backend: 'dt'` assumes for a node that doesn't report its own. */
export declare const GHOSTKIT_DT_DEFAULT_LIMITS: GhostkitSimulateLimits;
/** How a `protocol` override applied at a round. */
export type GhostkitProtocolOverride = {
    from: string;
    to: string;
    applied: boolean;
    notes?: {
        code: string;
        message: string;
    }[];
};
/** The outcome of one simulated group: the logs of each of its transactions, or why it failed. */
export type GhostkitGroupOutcome = {
    ok: true;
    logs: Uint8Array[][];
    /** simulate: the group's fee usage, in millionths of the minimum fee */
    groupUsage?: number;
    /** query: the opcode budget the group's app calls used */
    cost?: number;
    protocolOverride?: GhostkitProtocolOverride;
} | {
    ok: false;
    error: Error;
    protocolOverride?: GhostkitProtocolOverride;
};
/** The outcomes of the groups at one round. */
export type GhostkitRoundOutcome = {
    round: bigint;
    groups: GhostkitGroupOutcome[];
    protocolOverride?: GhostkitProtocolOverride;
};
/** A ghost group, built on demand: valid in `validity` if given (unless its calls set their own), else as composed by default. */
export type GhostkitGroup = (validity?: {
    firstValidRound: bigint;
    lastValidRound: bigint;
}) => Promise<GkTransactionComposer>;
/** Request-level simulate options as backends get them. */
export type GhostkitRequestOptions = Omit<GhostkitSimulateOptions, 'round' | 'protocol'> & {
    protocol?: string;
};
/**
 * Runs ghost simulates. ghostkit picks `ghostkitQueryBackend`, `ghostkitDTBackend` or `ghostkitStockBackend`; pass
 * your own to the SDK constructor's `backend` to change how simulates are sent.
 */
export interface GhostkitBackend {
    readonly name: string;
    readonly limits: GhostkitSimulateLimits;
    /** Simulates independent groups at `round` (the latest when undefined); one outcome per group, in order. */
    simulate(groups: GhostkitGroup[], options: GhostkitRequestOptions & {
        round?: bigint;
    }): Promise<GhostkitGroupOutcome[]>;
    /** Simulates the same independent groups at each round; one entry per round, in order. */
    simulateRounds(groups: GhostkitGroup[], rounds: bigint[], options: GhostkitRequestOptions & {
        validityWindow?: 'skip' | 'rewrite';
    }): Promise<GhostkitRoundOutcome[]>;
}
/** Facts about a ghost program, written by ghostkit when it generates the SDK. */
export type GhostkitMeta = {
    avmVersion: number;
    extraProgramPages: number;
    approvalBytes: number;
    clearBytes: number;
};
/** A failed ghost call. */
export declare class GhostkitError extends Error {
    /** The method, or `batch(...)` */
    readonly method: string;
    /** The round simulated at, if not the latest */
    readonly round?: bigint;
    /** The path of the failed transaction, if a group failed */
    readonly failedAt?: number[];
    /** The node's failure message, if a group failed */
    readonly failureMessage?: string;
    constructor(method: string, round: bigint | undefined, cause: unknown, hint?: string);
}
/** The result of a call (or calls) at one round. */
export type GhostkitRoundResult<V> = {
    round: bigint;
    protocolOverride?: GhostkitProtocolOverride;
} & ({
    ok: true;
    value: V;
} | {
    ok: false;
    error: GhostkitError;
});
/** Parameters of a generated SDK's constructor. */
export type GhostkitSDKParams = {
    algorand: GkAlgorandClient;
    /**
     * The account the ghost calls are sent from. Defaults to the network's fee sink, which is funded at every round. On a
     * node with queries it needn't be funded: queries check no fees or balances.
     */
    readerAccount?: string;
    /** Call this deployed app instead of creating the ghost on the fly. */
    ghostAppId?: bigint;
    /**
     * Milliseconds that calls at the latest round reuse suggested params for (default 3,000), shared by every SDK on the
     * same AlgorandClient; 0 to fetch them for every call. They come through the AlgorandClient, so its own cache applies
     * too, and ghostkit never changes it. Calls at past rounds reuse params of any age: they set their own validity.
     */
    cacheParamsTimeout?: number;
    /** Log diagnostics of each call. */
    debug?: boolean;
    /**
     * How to run ghost calls. With algokit-utils and algosdk the dtalgorand forks, `auto` (default) uses read-only queries
     * (`POST /v2/query`) when the node has them, with dtalgorand's extended simulate for calls that need simulate (see the
     * README) and as the fallback, and the extended simulate on a dtalgorand node without queries; else one simulate per
     * group. `query` always queries, and throws for calls that need simulate. `dt` always uses the extended simulate
     * (with dtalgorand's default limits if the node reports none), `stock` never; or pass your own `GhostkitBackend`.
     */
    backend?: 'auto' | 'query' | 'dt' | 'stock' | GhostkitBackend;
    /**
     * What each group pays in fees when it is simulated; queries check no fees, so this only applies on simulate.
     * Simulate checks fees, and a group's needs aren't known before it runs: consensus v42
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
    ghostFee?: GhostkitFee;
};
/** What each group pays in fees: see `GhostkitSDKParams.ghostFee`. */
export type GhostkitFee = 'max' | bigint | number;
/** Members of a ghostkit SDK, which an ABI method of a ghost contract can't be named. Names starting with `_gk` are reserved too. */
export declare const GHOSTKIT_RESERVED_MEMBERS: readonly string[];
type GkAwaitedAll<T> = T extends readonly unknown[] ? {
    -readonly [K in keyof T]: Awaited<T[K]>;
} : Awaited<T>;
/**
 * Finds out whether ghost calls can use dtalgorand's queries or extended simulate: the loaded algokit-utils and algosdk
 * must be the dtalgorand forks, and the node must report its simulate limits (`GET /v2/transactions/simulate/limits`),
 * with query limits for queries (and forks that have them).
 */
export declare function ghostkitDetectNode(algorand: GkAlgorandClient): Promise<GhostkitNode>;
/** One simulate request per group, as any algod takes them. */
export declare function ghostkitStockBackend(algorand: GkAlgorandClient, { concurrency }?: {
    concurrency?: number;
}): GhostkitBackend;
/**
 * dtalgorand's extended simulate through the fork of algokit-utils: independent groups go in as few requests as the
 * node allows, and rounds too.
 */
export declare function ghostkitDTBackend(algorand: GkAlgorandClient, limits?: GhostkitSimulateLimits): GhostkitBackend;
/**
 * dtalgorand's read-only queries (`POST /v2/query`) through the fork of algokit-utils (`algorand.query.run`): every app
 * call of the groups runs alone, at each round, and the calls of one program or app go in as few requests as the node's
 * query limits allow. No fees, signatures or minimum balances are checked; every resource is available without
 * references; each call gets the node's `maxCallBudget`. Validity, fees and the request options other than `protocol`
 * and `signal` are ignored; groups that can't be queried (other than NoOp app calls that create an app or call one
 * without programs, or with an access list, `rejectVersion`, a note, a lease or a rekey) make it throw an error named
 * `GhostkitQueryUnsupported`.
 *
 * `limits` are the node's simulate limits: ghostkit sizes chunks by them, so that a run that falls back to simulate
 * fits too (and anything that fits in a simulated group fits in queries).
 */
export declare function ghostkitQueryBackend(algorand: GkAlgorandClient, { limits, concurrency }?: {
    limits?: GhostkitSimulateLimits;
    concurrency?: number;
}): GhostkitBackend;
/**
 * What `ghostkitChangeRounds` lists the change rounds of. Keys, box names and prefixes given as strings are UTF-8, as
 * box names are in algokit-utils.
 */
export type GhostkitChangeSource = 
/** An app's params and global state; with `key`, only the rounds in which that global state key changed. */
{
    app: bigint | number;
    key?: string | Uint8Array;
    box?: never;
    boxPrefix?: never;
    asset?: never;
    account?: never;
}
/** One of an app's boxes. */
 | {
    app: bigint | number;
    box: string | Uint8Array;
    key?: never;
    boxPrefix?: never;
    asset?: never;
    account?: never;
}
/** An app's boxes whose names start with `boxPrefix`, such as one ARC-56 box map (`''` for all of its boxes). */
 | {
    app: bigint | number;
    boxPrefix: string | Uint8Array;
    key?: never;
    box?: never;
    asset?: never;
    account?: never;
}
/** An asset's params. */
 | {
    asset: bigint | number;
    app?: never;
    account?: never;
    key?: never;
    box?: never;
    boxPrefix?: never;
}
/** An account's base record: balance, status, minimum balance, ... (not its holdings or app states). */
 | {
    account: string | gkAlgosdk.Address;
    asset?: never;
    app?: never;
    key?: never;
    box?: never;
    boxPrefix?: never;
}
/** One of an account's asset holdings. */
 | {
    account: string | gkAlgosdk.Address;
    asset: bigint | number;
    app?: never;
    key?: never;
    box?: never;
    boxPrefix?: never;
}
/** An account's local state in one app; with `key`, only the rounds in which that local state key changed. */
 | {
    account: string | gkAlgosdk.Address;
    app: bigint | number;
    key?: string | Uint8Array;
    asset?: never;
    box?: never;
    boxPrefix?: never;
};
/** Options of `ghostkitChangeRounds`. */
export type GhostkitChangeRoundsOptions = {
    /** The first round to list (inclusive); default 1. */
    minRound?: GhostkitRound;
    /** The last round to list (inclusive); default the latest. */
    maxRound?: GhostkitRound;
    /** `asc` (default) lists the earliest changes first, `desc` the latest first. The rounds come in this order. */
    order?: 'asc' | 'desc';
    /** At most this many rounds (default 1,000). */
    limit?: number;
    /** Stops the listing; the call rejects with the signal's reason. */
    signal?: AbortSignal;
};
/**
 * dtalgorand nodes only: the rounds in which any of `sources` changed, merged and deduplicated, from the node's
 * `/versions` listings. Pass them to `atRounds` to read a ghost at every change and nowhere between, instead of
 * sampling rounds evenly.
 *
 * - A round is the round of a change: a ghost read at it sees the state after the change (`round - 1n` sees it before).
 * - Round 0 (genesis allocations) is never listed: to `atRounds`, 0 is the latest round.
 * - `next` is set when `limit` cut the list: pass it as `minRound` (`asc`) or `maxRound` (`desc`) to continue. With
 *   several sources and no `maxRound`, the latest round is read once, so every listing ends at the same round.
 * - The node's versions errors pass through: a listing over the node's time limit (504) or a history it can't serve
 *   (503) isn't retried, so narrow the range. Pages can be short or empty (`key`, `boxPrefix`); they are followed to the end.
 *
 * Needs the dtalgorand fork of algokit-utils (`algorand.dt`, `9.2.3-dt.3.0.0.1` or later) and algosdk (`3.9.0-dt.3.0.0.1`
 * or later for `key` and `boxPrefix`).
 *
 * @example
 * const { rounds } = await ghostkitChangeRounds(algorand, [{ app: poolAppId, box: 'stakers' }], { minRound, maxRound })
 * const series = await sdk.atRounds(rounds, (s) => s.stakerBalances({ methodArgsOrArgsArray: { pool: poolAppId } }))
 */
export declare function ghostkitChangeRounds(algorand: GkAlgorandClient, sources: GhostkitChangeSource[], { minRound, maxRound, order, limit, signal }?: GhostkitChangeRoundsOptions): Promise<{
    rounds: bigint[];
    next?: bigint;
}>;
/** A call as the generated SDK method describes it. */
type GkCallSpec = {
    signature: string;
    chunk?: GhostkitChunkOptions;
};
type GkParamsBuilder = (callParams: any) => Promise<unknown>;
/**
 * How a run's groups pay fees: what the reader can spend (`max`), a fixed amount on each group's first app call, or the
 * minimum fees.
 */
type GkFeePlan = {
    kind: 'max';
    spendable: bigint;
    minFee: bigint;
} | {
    kind: 'fixed';
    amount: bigint;
} | {
    kind: 'min';
};
/** How a run builds its groups: who sends them, how they pay fees, and where their suggested params come from. */
type GkBuild = {
    reader: string;
    fees: GkFeePlan;
    params: () => Promise<GkSuggestedParams>;
};
/** A call ready to simulate: its groups, and how to decode its results. */
type GkPreparedCall = {
    method: string;
    returnType: string;
    groupCount: number;
    /** the call's groups, built as the run says */
    groupsFor(build: GkBuild): GhostkitGroup[];
    /** app calls per group, and arg counts per app call, for debug */
    shape: Record<string, number>[][];
    options?: GhostkitSimulateOptions;
    /** whether the reader must be the real sender: an ABI `account` argument can encode it (index 0) */
    needsReader: boolean;
    /** why the call must be simulated, not queried */
    simulateOnly?: string;
};
type GkPending = {
    prepared: Promise<GkPreparedCall>;
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
};
/** What an SDK instance (and its atRound / batch views) shares. */
type GkShared = {
    programs?: {
        approval: Uint8Array;
        clear: Uint8Array;
    };
    methods?: Map<string, GkArc56Contract['methods'][number]>;
    returnTypes: Map<string, string>;
    warned: Set<string>;
    /** the backend `auto` fell back to after the node turned out not to support queries or the extended simulate */
    fallback?: GhostkitBackend;
    /** why the node rejected querying a program or app (by `gkQueryKey`), which `auto` then simulates */
    unqueryable: Map<string, string>;
};
type GkSuggestedParams = Awaited<ReturnType<GkAlgorandClient['getSuggestedParams']>>;
/** The base of every ghostkit SDK. */
export declare class GhostkitBase<TFactory, TClient> {
    algorand: GkAlgorandClient;
    /** The account ghost calls are sent from; the network's fee sink when unset. */
    readerAccount?: string;
    ghostAppId?: bigint;
    /** The algokit-generated factory, for typed clients of deployed apps. */
    factory: TFactory;
    protected client: TClient;
    appSpec: GkArc56Contract;
    cacheParamsTimeout: number;
    debug: boolean;
    backend: 'auto' | 'query' | 'dt' | 'stock' | GhostkitBackend;
    ghostFee: GhostkitFee;
    protected _gkMeta: GhostkitMeta;
    protected _gkShared: GkShared;
    protected _gkRound?: bigint;
    protected _gkCollector?: GkPending[];
    constructor(params: GhostkitSDKParams, spec: {
        appSpec: GkArc56Contract;
        meta: GhostkitMeta;
        createFactory: (algorand: GkAlgorandClient, defaultSender: string) => TFactory;
        createClient: (factory: TFactory, appId: bigint) => TClient;
    });
    /**
     * The same SDK, simulating as of the end of `round`. A stock node can only simulate its last few rounds (usually 4);
     * a dtalgorand node with time travel any round since genesis.
     */
    atRound(round: GhostkitRound): this;
    /**
     * Runs the calls `fn` makes at each round, and returns their results per round. `fn` must return the calls'
     * promises (one, or an array) without awaiting them.
     *
     * On a dtalgorand node the rounds and calls go in as few requests as its limits allow, rounds any distance apart (with
     * queries, one request per up to `maxCalls` app calls × `maxRounds` rounds, 1,024 × 16 by default); on a stock node
     * each call is simulated at each round on its own, and only the last few rounds are available.
     *
     * @example
     * const balances = await sdk.atRounds([46_000_000n, 47_000_000n], (s) => s.acctBalanceData({ methodArgsOrArgsArray: { accounts } }))
     * for (const r of balances) if (r.ok) console.log(r.round, r.value)
     */
    atRounds<const T extends Promise<unknown> | readonly Promise<unknown>[]>(rounds: GhostkitRound[], fn: (sdk: this) => T, options?: GhostkitRoundsOptions): Promise<GhostkitRoundResult<GkAwaitedAll<T>>[]>;
    /**
     * Simulates the calls `fn` makes together: on a dtalgorand node in one request (or as few as its limits allow; with
     * queries, up to `maxCalls` app calls per request, 1,024 by default), on a stock node one request per call,
     * concurrently. `fn` must return the calls' promises (one, or an array) without
     * awaiting them. Rejects with the first failed call's error.
     *
     * @example
     * const [timestamps, balances] = await sdk.batch((s) => [s.blkTimestamp({ ... }), s.acctBalanceData({ ... })])
     */
    batch<const T extends Promise<unknown> | readonly Promise<unknown>[]>(fn: (sdk: this) => T, options?: Omit<GhostkitSimulateOptions, 'round'>): Promise<GkAwaitedAll<T>>;
    /**
     * What ghostkit found about the node and the loaded libraries; the backend `auto` picks by it. Found once per
     * AlgorandClient.
     */
    getNode(): Promise<GhostkitNode>;
    /**
     * Fetches what the first call waits for: the node's limits, and suggested params unless the node has queries, which
     * need none. Calls fetch them anyway; this lets them arrive while the app does other work. Simulates at the latest
     * round use the params for `cacheParamsTimeout` ms, at past rounds for an hour.
     */
    prefetch(): Promise<void>;
    /** Runs a generated method's call: now, or as part of `batch` / `atRounds`. */
    protected _gkCall<T>(spec: GkCallSpec, input: GhostkitMethodInput<unknown>, params: GkParamsBuilder): Promise<T[]>;
    private _gkCollectWithShape;
    private _gkView;
    private _gkWarn;
    /** The node's limits, as the forced backends read them: cached per AlgorandClient. */
    private _gkLimits;
    /** The backend for this call. Detection is cached per AlgorandClient, so this costs no request after the first. */
    private _gkResolveBackend;
    /** The backend `auto` simulates with when a run can't be queried. */
    private _gkSimulateBackend;
    /** The query limits for the pre-checks of a run on the query backend. */
    private _gkQueryLimits;
    /** The reader: `readerAccount`, or the fee sink, known for MainNet and TestNet and otherwise read from the genesis once. */
    private _gkReader;
    /**
     * Suggested params no older than `maxAge` ms, shared by every SDK on the AlgorandClient. They come from
     * `algorand.getSuggestedParams()`, so its own cache applies too; ghostkit never changes it. Concurrent callers share
     * one request.
     */
    private _gkParams;
    /** A composer whose suggested params come from `params` (`_gkParams`, or none), without touching the AlgorandClient's cache. */
    private _gkComposer;
    private _gkPrograms;
    private _gkMethod;
    private _gkReturnType;
    /** Whether the ghost only runs under consensus v42 or later. */
    private _gkNeedsV42;
    private _gkPrepare;
    /** Splits a call's array argument into groups of app calls, sized to the node's limits. */
    private _gkChunk;
    /**
     * Runs prepared calls at the target. With `auto`, a run on the query backend goes to simulate when it can't be queried
     * (`_gkQueryBlocker`) or the node rejects the query (`_gkQueryFallback`); the extended simulate falls back to one
     * simulate per group if the node turns out not to support it.
     */
    private _gkRun;
    /** What `_gkShared.unqueryable` remembers the node's rejection of this SDK's queries by: the ghost program or the app. */
    private _gkQueryKey;
    /** Why a run must be simulated rather than queried, or undefined if it can be queried. */
    private _gkQueryBlocker;
    /**
     * Whether `auto` simulates a run whose query failed with `e`, and why; undefined to throw. A group the query backend
     * can't send and a request the node rejects (400) simulate this run; a node without queries (a load balancer mixing
     * nodes) makes `auto` simulate from now on (`sticky`).
     */
    private _gkQueryFallback;
    /**
     * What the reader can spend at a round (the latest if undefined) over its minimum balance; undefined if unknown. A node
     * that can't read the account at the round (a stock node answers with the latest, a dtalgorand node without time travel
     * fails) gives its latest balance, the best guess.
     */
    private _gkSpendable;
    private _gkSpendableOf;
    /** How the run's groups pay fees: see `ghostFee`. */
    private _gkFeePlan;
    /** Runs prepared calls on a backend; `fallback` is why `_gkRun` fell back to it, for debug. */
    private _gkRunOn;
    /** A hint for errors that a different node or reader would avoid. */
    private _gkHint;
}
export {};
