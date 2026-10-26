"use strict";
/* BEGIN GHOSTKIT RUNTIME */
// Shared by every ghostkit SDK: ghostkit inlines this file into each SDK it generates, after the algokit-generated
// typed client. It must only import algosdk and algokit-utils, under names that can't clash with the generated client
// (exports start with `Ghostkit`/`GHOSTKIT_`, private names with `gk`). It runs on stock algokit-utils and algosdk, and
// uses the dtalgorand forks' read-only queries (POST /v2/query) or extended simulate when they and the node support them.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GhostkitBase = exports.GHOSTKIT_RESERVED_MEMBERS = exports.GhostkitError = exports.GHOSTKIT_DT_DEFAULT_LIMITS = exports.GHOSTKIT_STOCK_LIMITS = void 0;
exports.ghostkitDetectNode = ghostkitDetectNode;
exports.ghostkitStockBackend = ghostkitStockBackend;
exports.ghostkitDTBackend = ghostkitDTBackend;
exports.ghostkitQueryBackend = ghostkitQueryBackend;
const amount_1 = require("@algorandfoundation/algokit-utils/types/amount");
const app_arc56_1 = require("@algorandfoundation/algokit-utils/types/app-arc56");
const composer_1 = require("@algorandfoundation/algokit-utils/types/composer");
const gkAlgosdk = __importStar(require("algosdk"));
/** The limits of a stock algod's simulate. */
exports.GHOSTKIT_STOCK_LIMITS = Object.freeze({
    maxTxnGroups: 1,
    maxRounds: 0,
    maxExtraOpcodeBudget: 320000,
    resourceLimitMultiplier: 1,
    timeTravel: false,
    developerApi: false,
});
/** The default limits of a dtalgorand node, which `backend: 'dt'` assumes for a node that doesn't report its own. */
exports.GHOSTKIT_DT_DEFAULT_LIMITS = Object.freeze({
    maxTxnGroups: 16,
    maxRounds: 16,
    maxExtraOpcodeBudget: 320000,
    resourceLimitMultiplier: 1,
    timeTravel: true,
    developerApi: false,
});
/** A failed ghost call. */
class GhostkitError extends Error {
    constructor(method, round, cause, hint) {
        const c = cause;
        super(`ghostkit: ${method} failed${round !== undefined ? ` at round ${round}` : ''}: ${c?.message ?? String(cause)}${hint ? ` (${hint})` : ''}`);
        this.cause = cause;
        this.name = 'GhostkitError';
        this.method = method;
        this.round = round;
        this.failedAt = c?.failedAt;
        this.failureMessage = c?.failureMessage;
    }
}
exports.GhostkitError = GhostkitError;
/** Members of a ghostkit SDK, which an ABI method of a ghost contract can't be named. Names starting with `_gk` are reserved too. */
exports.GHOSTKIT_RESERVED_MEMBERS = Object.freeze([
    'constructor',
    'algorand',
    'readerAccount',
    'ghostAppId',
    'factory',
    'client',
    'appSpec',
    'cacheParamsTimeout',
    'debug',
    'backend',
    'ghostFee',
    'atRound',
    'atRounds',
    'batch',
    'getNode',
    'prefetch',
    // Object.prototype
    'toString',
    'toLocaleString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    '__proto__',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
]);
/** The fee sinks of MainNet and TestNet by genesis hash, so finding them takes no request. */
const GK_KNOWN_FEE_SINKS = {
    'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=': 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA',
    'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=': 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE',
};
/** How long calls at past rounds reuse suggested params: only their genesis and minimum fee matter. */
const GK_PAST_PARAMS_MAX_AGE = 3600000;
/** The default sender for the public `factory`: the fee sink of LocalNet, TestNet and BetaNet. */
const GK_FALLBACK_READER = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE';
/** Most transactions per group. */
const GK_MAX_GROUP_SIZE = 16;
/** The most bytes in any one app argument, under any consensus version. */
const GK_MAX_ARG_BYTES = 4096;
/** Unnamed resources each app call may touch at 1x (consensus `MaxAppTotalTxnReferences`). */
const GK_REFS_PER_TXN = 8;
/** The minimum balance an app's creator holds for it, and for each extra page (consensus `AppFlatParamsMinBalance`). */
const GK_APP_MIN_BALANCE = 100000n;
/** The minimum balance per global state entry (`SchemaMinBalancePerEntry` plus `SchemaUintMinBalance` / `SchemaBytesMinBalance`). */
const GK_GLOBAL_UINT_MIN_BALANCE = 28500n;
const GK_GLOBAL_BYTES_MIN_BALANCE = 50000n;
/** The ABI return log prefix. */
const GK_RETURN_PREFIX = [0x15, 0x1f, 0x7c, 0x75];
/** Where a dtalgorand node reports its simulate limits; other nodes answer 404. */
const GK_LIMITS_PATH = '/v2/transactions/simulate/limits';
/** The zero address: a query sent from it runs as the round's fee sink. */
const GK_ZERO_ADDRESS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
/**
 * Suggested params for groups that are only queried: a query ignores fees and validity (each call is valid in the
 * block after the round), so they cost no request.
 */
const GK_QUERY_PARAMS = {
    fee: 0n,
    minFee: 1000n,
    flatFee: false,
    firstValid: 1n,
    lastValid: 1n,
    genesisID: '',
    genesisHash: new Uint8Array(32),
};
/** The log bytes of an app call with simulate's `allowMoreLogging`. */
const GK_MORE_LOGGING_BYTES = 65536;
/** The opcode budget of each app call of a group (`MaxAppProgramCost`), pooled by simulate. */
const GK_APP_CALL_BUDGET = 700;
const gkEmptySigner = gkAlgosdk.makeEmptyTransactionSigner();
const gkSimulateManager = (algorand) => {
    const manager = algorand.simulate;
    return typeof manager?.groups === 'function' && typeof manager?.rounds === 'function' ? manager : undefined;
};
const gkQueryManager = (algorand) => {
    const manager = algorand.query;
    if (typeof manager?.run !== 'function')
        return undefined;
    const dtClient = gkAlgosdk.DTAlgodClient;
    return dtClient?.features?.includes('query') ? manager : undefined;
};
const gkStatus = (e) => {
    const err = e;
    return err?.status ?? err?.response?.status;
};
const gkAsError = (e) => (e instanceof Error ? e : new Error(String(e)));
/** The node's message in an HTTP error: its JSON body's `message` if it has one, else the error's message. */
const gkErrorText = (e) => {
    const err = e;
    const body = err?.response?.body?.message;
    if (typeof body === 'string')
        return body;
    try {
        const parsed = err?.response?.text ? JSON.parse(err.response.text) : undefined;
        if (typeof parsed?.message === 'string')
            return parsed.message;
    }
    catch {
        // not JSON
    }
    return err?.message ?? String(e);
};
/** Whether a backend runs on a dtalgorand node's extensions (queries or the extended simulate), e.g. `protocol`. */
const gkExtended = (backend) => backend.name === 'dt' || backend.name === 'query';
/** Maps with at most `limit` promises pending at once. */
async function gkMapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
/** The validity window for a simulate at `round`: valid only in block round + 1, so `block` can look back the furthest. */
const gkValidityAt = (round) => ({ firstValidRound: round + 1n, lastValidRound: round + 1n });
/**
 * Reads a dtalgorand node's limits, or `undefined` if the node doesn't report them. With the fork of algosdk they come
 * from `DTAlgodClient.simulateLimits()`, which caches them per algod client and is what the fork of algokit-utils reads
 * before each extended simulate and query, so the node is asked once. Only that path reports query limits.
 */
async function gkFetchLimits(algorand) {
    const dt = gkAlgosdk.DTAlgodClient;
    if (dt?.features?.includes('simulate-limits') && typeof dt.from === 'function') {
        const client = dt.from(algorand.client.algod);
        if (typeof client.simulateLimits === 'function') {
            const limits = await client.simulateLimits();
            if (!limits.reported)
                return undefined;
            const q = limits.query;
            return {
                simulate: {
                    maxTxnGroups: Math.max(1, limits.maxTxnGroups),
                    maxRounds: limits.maxRounds,
                    maxExtraOpcodeBudget: limits.maxExtraOpcodeBudget,
                    resourceLimitMultiplier: Math.max(1, limits.resourceLimitMultiplier),
                    timeTravel: limits.timeTravel === true,
                    developerApi: limits.developerApi === true,
                },
                ...(q
                    ? {
                        query: {
                            maxCalls: q.maxCalls,
                            maxRounds: q.maxRounds,
                            maxCallBudget: q.maxCallBudget,
                            maxCallLogBytes: q.maxCallLogBytes,
                            maxResponseBytes: q.maxResponseBytes,
                        },
                    }
                    : {}),
            };
        }
    }
    const http = algorand.client.algod.c;
    if (typeof http?.get !== 'function')
        return undefined;
    let res;
    try {
        res = await http.get({ relativePath: GK_LIMITS_PATH });
    }
    catch (e) {
        if (gkStatus(e) === 404)
            return undefined;
        throw e;
    }
    const raw = JSON.parse(res.text ?? new TextDecoder().decode(res.body));
    const num = (key, fallback) => (typeof raw[key] === 'number' ? raw[key] : fallback);
    return {
        simulate: {
            maxTxnGroups: Math.max(1, num('max-txn-groups', exports.GHOSTKIT_DT_DEFAULT_LIMITS.maxTxnGroups)),
            maxRounds: num('max-rounds', exports.GHOSTKIT_DT_DEFAULT_LIMITS.maxRounds),
            maxExtraOpcodeBudget: num('max-extra-opcode-budget', exports.GHOSTKIT_DT_DEFAULT_LIMITS.maxExtraOpcodeBudget),
            resourceLimitMultiplier: Math.max(1, num('resource-limit-multiplier', 1)),
            timeTravel: raw['time-travel'] === true,
            developerApi: raw['developer-api'] === true,
        },
    };
}
/** Why the loaded libraries can't do dtalgorand's extended simulate, or undefined if they can. */
function gkMissingForks(algorand) {
    if (!gkSimulateManager(algorand))
        return 'the loaded algokit-utils is not the dtalgorand fork';
    const dtClient = gkAlgosdk.DTAlgodClient;
    if (!dtClient?.features?.includes('group-results'))
        return 'the loaded algosdk is not the dtalgorand fork';
    return undefined;
}
/** Why the loaded libraries can't send queries, or undefined if they can. */
function gkMissingQuery(algorand) {
    const missing = gkMissingForks(algorand);
    if (missing)
        return missing;
    if (!gkQueryManager(algorand))
        return 'the loaded dtalgorand forks of algokit-utils and algosdk have no queries';
    return undefined;
}
/**
 * Finds out whether ghost calls can use dtalgorand's queries or extended simulate: the loaded algokit-utils and algosdk
 * must be the dtalgorand forks, and the node must report its simulate limits (`GET /v2/transactions/simulate/limits`),
 * with query limits for queries (and forks that have them).
 */
async function ghostkitDetectNode(algorand) {
    const stock = (reason) => ({ kind: 'stock', limits: exports.GHOSTKIT_STOCK_LIMITS, reason });
    const missing = gkMissingForks(algorand);
    if (missing)
        return stock(missing);
    const limits = await gkFetchLimits(algorand);
    if (!limits)
        return stock('the node is not a dtalgorand node (no simulate limits)');
    const query = limits.query && !gkMissingQuery(algorand) ? { query: limits.query } : {};
    return { kind: 'dt', limits: limits.simulate, ...query };
}
/** One simulate request per group, as any algod takes them. */
function ghostkitStockBackend(algorand, { concurrency = 8 } = {}) {
    const simulateOne = async (group, options, round) => {
        try {
            const { protocol, ...raw } = options;
            if (protocol)
                throw new Error(`protocol '${protocol}' needs a dtalgorand node`);
            const composer = await group(round !== undefined ? gkValidityAt(round) : undefined);
            const result = await composer.simulate({ ...raw, skipSignatures: true, ...(round !== undefined ? { round: Number(round) } : {}) });
            return {
                ok: true,
                logs: result.confirmations.map((c) => c.logs ?? []),
                groupUsage: result.simulateResponse.txnGroups[0]?.groupUsage,
            };
        }
        catch (e) {
            return { ok: false, error: gkAsError(e) };
        }
    };
    return {
        name: 'stock',
        limits: exports.GHOSTKIT_STOCK_LIMITS,
        simulate: (groups, { round, ...options }) => gkMapLimit(groups, concurrency, (g) => simulateOne(g, options, round)),
        simulateRounds: async (groups, rounds, { validityWindow: _ignored, ...options }) => {
            const flat = await gkMapLimit(rounds.flatMap((round) => groups.map((group) => ({ round, group }))), concurrency, ({ round, group }) => simulateOne(group, options, round));
            return rounds.map((round, r) => ({ round, groups: flat.slice(r * groups.length, (r + 1) * groups.length) }));
        },
    };
}
function gkFromDTOutcome(o, protocolOverride) {
    const override = o.protocolOverride ?? protocolOverride;
    const extra = override ? { protocolOverride: override } : {};
    if (!o.ok)
        return { ok: false, error: o.error, ...extra };
    const { confirmations, simulateResponse } = o.result;
    // the group's usage is on its entry in the response, found by its first transaction's result
    const first = confirmations[0] ?? null;
    const all = [...(simulateResponse.txnGroups ?? []), ...(simulateResponse.roundResults ?? []).flatMap((r) => r.txnGroups ?? [])];
    const groupUsage = all.find((g) => g.txnResults[0]?.txnResult === first)?.groupUsage;
    return { ok: true, logs: confirmations.map((c) => c.logs ?? []), groupUsage, ...extra };
}
/**
 * dtalgorand's extended simulate through the fork of algokit-utils: independent groups go in as few requests as the
 * node allows, and rounds too.
 */
function ghostkitDTBackend(algorand, limits = exports.GHOSTKIT_DT_DEFAULT_LIMITS) {
    const manager = gkSimulateManager(algorand);
    if (!manager)
        throw new Error('ghostkit: the dt backend needs the dtalgorand fork of algokit-utils (algorand.simulate)');
    const simulate = async (groups, { round, protocol, ...raw }) => {
        const composers = await Promise.all(groups.map((g) => g(round !== undefined ? gkValidityAt(round) : undefined)));
        const outcomes = await manager.groups(composers, {
            ...raw,
            parallel: true,
            maxGroups: limits.maxTxnGroups,
            ...(round !== undefined ? { round } : {}),
            ...(protocol ? { protocol } : {}),
        });
        return outcomes.map((o) => gkFromDTOutcome(o));
    };
    return {
        name: 'dt',
        limits,
        simulate,
        simulateRounds: async (groups, rounds, { validityWindow, protocol, ...raw }) => {
            if (limits.maxRounds < 1) {
                // the node takes one round per request
                return gkMapLimit(rounds, 4, async (round) => ({ round, groups: await simulate(groups, { ...raw, protocol, round }) }));
            }
            // `rewrite` keeps each transaction's validity width: a zero width lets `block` read the furthest back at every round
            const composers = await Promise.all(groups.map((g) => g(validityWindow === 'rewrite' ? gkValidityAt(rounds[0]) : undefined)));
            const results = await manager.rounds(composers, rounds, {
                ...raw,
                parallel: true,
                maxGroups: limits.maxTxnGroups,
                maxRounds: limits.maxRounds,
                ...(validityWindow ? { validityWindow } : {}),
                ...(protocol ? { protocol } : {}),
            });
            return results.map((r) => ({
                round: r.round,
                groups: r.groups.map((o) => gkFromDTOutcome(o, r.protocolOverride)),
                ...(r.protocolOverride ? { protocolOverride: r.protocolOverride } : {}),
            }));
        },
    };
}
/** The name of the error `ghostkitQueryBackend` throws for groups it can't query; `auto` then simulates the run. */
const GK_QUERY_UNSUPPORTED = 'GhostkitQueryUnsupported';
/** Why a transaction can't be a query call, or undefined if it can. */
function gkNotQueryable(txn) {
    const app = txn.applicationCall;
    if (txn.type !== gkAlgosdk.TransactionType.appl || !app)
        return `it has a ${txn.type} transaction`;
    if (app.onComplete !== gkAlgosdk.OnApplicationComplete.NoOpOC)
        return 'an app call is not a NoOp';
    // `access` and `rejectVersion` are missing from older algosdk versions
    if (app.access?.length)
        return 'an app call has an access list';
    if (app.rejectVersion)
        return 'an app call sets rejectVersion';
    if (txn.note?.length)
        return 'an app call has a note';
    if (txn.lease?.some((b) => b !== 0))
        return 'an app call has a lease';
    if (txn.rekeyTo)
        return 'an app call rekeys';
    if (app.appIndex === 0n)
        return app.approvalProgram.length > 0 ? undefined : 'an app create has no approval program';
    return app.approvalProgram.length > 0 || app.clearProgram.length > 0 ? 'an app call of a deployed app has programs' : undefined;
}
const gkSameBytes = (a, b) => {
    if (a === b)
        return true;
    if (!a || !b || a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
};
const gkSameSchema = (a, b) => a?.numUint === b?.numUint && a?.numByteSlice === b?.numByteSlice;
/** The query target of an app call: its program and schemas, or the app it calls, and its sender. */
function gkQueryTargetOf(txn) {
    const app = txn.applicationCall;
    const sender = txn.sender.toString();
    // the zero address runs as the round's fee sink, as does no sender
    const from = sender === GK_ZERO_ADDRESS ? {} : { sender };
    if (app.appIndex !== 0n)
        return { appId: app.appIndex, ...from };
    const schema = (numUint, numByteSlice) => (numUint || numByteSlice ? { numUint, numByteSlice } : undefined);
    const globalSchema = schema(app.numGlobalInts, app.numGlobalByteSlices);
    const localSchema = schema(app.numLocalInts, app.numLocalByteSlices);
    return {
        program: app.approvalProgram,
        ...(app.clearProgram.length > 0 ? { clearProgram: app.clearProgram } : {}),
        ...(globalSchema ? { globalSchema } : {}),
        ...(localSchema ? { localSchema } : {}),
        ...from,
    };
}
const gkSameTarget = (a, b) => a.sender === b.sender &&
    a.appId === b.appId &&
    gkSameSchema(a.globalSchema, b.globalSchema) &&
    gkSameSchema(a.localSchema, b.localSchema) &&
    gkSameBytes(a.program, b.program) &&
    gkSameBytes(a.clearProgram, b.clearProgram);
/** The query call of an app call: its args and references (box `app` 0 is the created or called app). */
function gkQueryCallOf(txn) {
    const app = txn.applicationCall;
    return {
        ...(app.appArgs.length ? { args: [...app.appArgs] } : {}),
        ...(app.accounts.length ? { accounts: app.accounts.map((a) => a.toString()) } : {}),
        ...(app.foreignApps.length ? { foreignApps: app.foreignApps.map(BigInt) } : {}),
        ...(app.foreignAssets.length ? { foreignAssets: app.foreignAssets.map(BigInt) } : {}),
        ...(app.boxes.length ? { boxes: app.boxes.map((b) => ({ app: BigInt(b.appIndex), name: b.name })) } : {}),
    };
}
/** A query group's failure, worded like algokit-utils' `QueryGroupError`, which `GhostkitError` takes `failedAt` from. */
function gkQueryGroupError(group, round, failure) {
    const message = failure.kind === 'round'
        ? `Could not query group ${group} at round ${round}: ${failure.failureMessage}`
        : `Querying group ${group} at round ${round} failed at transaction ${failure.failedAt[0]}: ${failure.failureMessage}`;
    const error = Object.assign(new Error(message), failure);
    error.name = 'GhostkitQueryError';
    return error;
}
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
function ghostkitQueryBackend(algorand, { limits = exports.GHOSTKIT_DT_DEFAULT_LIMITS, concurrency } = {}) {
    const manager = gkQueryManager(algorand);
    if (!manager)
        throw new Error('ghostkit: the query backend needs the dtalgorand forks of algokit-utils and algosdk with queries (algorand.query)');
    const query = async (groups, rounds, options) => {
        const signal = options.signal;
        if (groups.length === 0)
            return rounds.map((round) => ({ round, groups: [] }));
        const built = await Promise.all(groups.map(async (g) => (await g(undefined)).buildTransactions()));
        // the calls by target: normally one, the ghost program or app, from the reader
        const targets = [];
        const placement = built.map(({ transactions }) => transactions.map((txn) => {
            const reason = gkNotQueryable(txn);
            if (reason)
                throw Object.assign(new Error(`ghostkit: can't query the group: ${reason}`), { name: GK_QUERY_UNSUPPORTED });
            const target = gkQueryTargetOf(txn);
            let t = targets.length - 1;
            if (t < 0 || !gkSameTarget(targets[t].target, target)) {
                t = targets.findIndex((x) => gkSameTarget(x.target, target));
                if (t < 0)
                    t = targets.push({ target, calls: [] }) - 1;
            }
            return { target: t, call: targets[t].calls.push(gkQueryCallOf(txn)) - 1 };
        }));
        const protocol = options.protocol ?? 'round';
        const results = await Promise.all(targets.map(({ target, calls }) => manager.run({ ...target, rounds, protocol, calls }, { signal, ...(concurrency ? { concurrency } : {}) })));
        return rounds.map((requested, r) => {
            // With several targets (not in normal ghostkit use: one program or app, one reader), each `run` pins the latest
            // round on its own, and the round reported is the first target's
            const round = results[0][r].round;
            const outcomes = placement.map((txns, g) => {
                const override = results[txns[0]?.target ?? 0][r].protocolOverride;
                const extra = override ? { protocolOverride: override } : {};
                const logs = [];
                let cost = 0;
                for (let i = 0; i < txns.length; i++) {
                    const outcome = results[txns[i].target][r].calls[txns[i].call];
                    if (!outcome.ok) {
                        const { error } = outcome;
                        const failureMessage = error.failureMessage ?? error.message;
                        const failure = error.kind === 'round'
                            ? { kind: 'round', failureMessage, cause: error }
                            : { kind: 'group', failedAt: [i], failureMessage, cause: error };
                        return { ok: false, error: gkQueryGroupError(g, round, failure), ...extra };
                    }
                    logs.push(outcome.logs);
                    cost += outcome.cost;
                }
                return { ok: true, logs, cost, ...extra };
            });
            const override = results[0][r].protocolOverride;
            return { round: requested === 0n ? round : requested, groups: outcomes, ...(override ? { protocolOverride: override } : {}) };
        });
    };
    return {
        name: 'query',
        limits,
        simulate: async (groups, { round, ...options }) => (await query(groups, [round ?? 0n], options))[0].groups,
        simulateRounds: (groups, rounds, { validityWindow: _ignored, ...options }) => query(groups, rounds, options),
    };
}
/** Decodes a transaction's logs: every log but the last, which must be the ABI return. */
function gkDecodeLogs(logs, returnType, structs) {
    return logs.flatMap((txnLogs, i) => {
        const last = txnLogs[txnLogs.length - 1];
        if (!last || last.length < 4 || GK_RETURN_PREFIX.some((b, j) => last[j] !== b)) {
            throw new Error(`transaction ${i} has no ABI return log; ghostkit methods must be ABI methods that return a value`);
        }
        // decode a copy: logs can be views into one response buffer, and algosdk's ABI decoder ignores a view's byteOffset
        return txnLogs.slice(0, -1).map((log) => (0, app_arc56_1.getABIDecodedValue)(log.slice(), returnType, structs));
    });
}
// Every generated SDK inlines its own copy of this runtime, so the caches live on a global registry for SDKs of
// different contracts to share. The key is versioned: change it when GkClientCache changes shape.
const gkClientCaches = ((_a = globalThis)[_b = Symbol.for('ghostkit.clientCaches.v2')] ?? (_a[_b] = new WeakMap()));
const gkCacheOf = (algorand) => {
    let cache = gkClientCaches.get(algorand);
    if (!cache)
        gkClientCaches.set(algorand, (cache = { spendable: new Map() }));
    return cache;
};
/** Caches a promise, forgetting it if it rejects so that the next caller tries again. */
function gkRemember(cache, key, make) {
    const existing = cache[key];
    if (existing)
        return existing;
    const made = make();
    cache[key] = made;
    made.catch(() => {
        if (cache[key] === made)
            cache[key] = undefined;
    });
    return made;
}
/** The base of every ghostkit SDK. */
class GhostkitBase {
    constructor(params, spec) {
        this.cacheParamsTimeout = 3000; // ms
        this.debug = false;
        this.backend = 'auto';
        this.ghostFee = 1000000n;
        this.algorand = params.algorand;
        this.readerAccount = params.readerAccount;
        this.ghostAppId = params.ghostAppId;
        if (params.cacheParamsTimeout !== undefined)
            this.cacheParamsTimeout = params.cacheParamsTimeout;
        this.debug = params.debug ?? false;
        if (params.backend)
            this.backend = params.backend;
        if (params.ghostFee !== undefined)
            this.ghostFee = params.ghostFee;
        this.appSpec = spec.appSpec;
        this._gkMeta = spec.meta;
        this.factory = spec.createFactory(this.algorand, params.readerAccount ?? GK_FALLBACK_READER);
        this.client = spec.createClient(this.factory, params.ghostAppId ?? 13n);
        this._gkShared = { returnTypes: new Map(), warned: new Set(), unqueryable: new Map() };
    }
    /**
     * The same SDK, simulating as of the end of `round`. A stock node can only simulate its last few rounds (usually 4);
     * a dtalgorand node with time travel any round since genesis.
     */
    atRound(round) {
        return this._gkView({ _gkRound: BigInt(round) });
    }
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
    async atRounds(rounds, fn, options) {
        const { calls, returned, wasArray } = this._gkCollectWithShape(fn);
        if (rounds.length === 0)
            return [];
        const prepared = await Promise.all(calls.map((c) => c.prepared));
        const indexes = returned.map((p) => calls.findIndex((c) => c.promise === p));
        const results = await this._gkRun(prepared, { kind: 'rounds', rounds: rounds.map(BigInt) }, options ?? {});
        return results.map(({ round, protocolOverride, calls: callResults }) => {
            const base = { round: round, ...(protocolOverride ? { protocolOverride } : {}) };
            const failed = callResults.find((c) => !c.ok);
            if (failed && !failed.ok)
                return { ...base, ok: false, error: failed.error };
            const values = indexes.map((i) => callResults[i].value);
            return { ...base, ok: true, value: (wasArray ? values : values[0]) };
        });
    }
    /**
     * Simulates the calls `fn` makes together: on a dtalgorand node in one request (or as few as its limits allow; with
     * queries, up to `maxCalls` app calls per request, 1,024 by default), on a stock node one request per call,
     * concurrently. `fn` must return the calls' promises (one, or an array) without
     * awaiting them. Rejects with the first failed call's error.
     *
     * @example
     * const [timestamps, balances] = await sdk.batch((s) => [s.blkTimestamp({ ... }), s.acctBalanceData({ ... })])
     */
    async batch(fn, options) {
        const { calls, returned, wasArray } = this._gkCollectWithShape(fn);
        if (calls.length) {
            try {
                const prepared = await Promise.all(calls.map((c) => c.prepared));
                const target = this._gkRound !== undefined ? { kind: 'round', round: this._gkRound } : { kind: 'latest' };
                const [{ calls: results }] = await this._gkRun(prepared, target, options ?? {});
                results.forEach((r, i) => (r.ok ? calls[i].resolve(r.value) : calls[i].reject(r.error)));
            }
            catch (e) {
                calls.forEach((c) => c.reject(e));
            }
        }
        return (wasArray ? Promise.all(returned) : returned[0]);
    }
    /**
     * What ghostkit found about the node and the loaded libraries; the backend `auto` picks by it. Found once per
     * AlgorandClient.
     */
    getNode() {
        return gkRemember(gkCacheOf(this.algorand), 'node', () => ghostkitDetectNode(this.algorand));
    }
    /**
     * Fetches what the first call waits for: the node's limits, and suggested params unless the node has queries, which
     * need none. Calls fetch them anyway; this lets them arrive while the app does other work. Simulates at the latest
     * round use the params for `cacheParamsTimeout` ms, at past rounds for an hour.
     */
    async prefetch() {
        const backend = await this._gkResolveBackend();
        if (backend.name !== 'query')
            await this._gkParams(GK_PAST_PARAMS_MAX_AGE);
    }
    /** Runs a generated method's call: now, or as part of `batch` / `atRounds`. */
    _gkCall(spec, input, params) {
        if (this._gkCollector) {
            if (input.extraSimulateArgs) {
                // thrown, not rejected: batch() / atRounds() then reject with it
                throw new Error('ghostkit: inside batch() or atRounds(), pass simulate options to them instead of extraSimulateArgs');
            }
            let resolve;
            let reject;
            const promise = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });
            promise.catch(() => { }); // a call that fn didn't return must not be an unhandled rejection
            const prepared = this._gkPrepare(spec, input, params);
            prepared.catch(() => { });
            this._gkCollector.push({ prepared, promise, resolve, reject });
            return promise;
        }
        return (async () => {
            const prepared = await this._gkPrepare(spec, input, params);
            const pinned = input.extraSimulateArgs?.round;
            if (pinned !== undefined && this._gkRound !== undefined && BigInt(pinned) !== this._gkRound) {
                throw new Error(`ghostkit: extraSimulateArgs.round ${pinned} conflicts with atRound(${this._gkRound})`);
            }
            const round = pinned !== undefined ? BigInt(pinned) : this._gkRound;
            const target = round !== undefined ? { kind: 'round', round } : { kind: 'latest' };
            const [{ calls }] = await this._gkRun([prepared], target, {});
            const [result] = calls;
            if (!result.ok)
                throw result.error;
            return result.value;
        })();
    }
    _gkCollectWithShape(fn) {
        const calls = [];
        const returnedValue = fn(this._gkView({ _gkCollector: calls }));
        const wasArray = Array.isArray(returnedValue);
        const returned = (wasArray ? returnedValue : [returnedValue]);
        for (const p of returned) {
            if (!calls.some((c) => c.promise === p)) {
                throw new Error('ghostkit: the callback must return the promises of the SDK calls it makes, without awaiting them');
            }
        }
        return { calls, returned, wasArray };
    }
    _gkView(overrides) {
        return Object.assign(Object.create(this), overrides);
    }
    _gkWarn(key, message) {
        if (this._gkShared.warned.has(key))
            return;
        this._gkShared.warned.add(key);
        console.warn(`[ghostkit] ${message}`);
    }
    /** The node's limits, as the forced backends read them: cached per AlgorandClient. */
    _gkLimits() {
        return gkRemember(gkCacheOf(this.algorand), 'limits', () => gkFetchLimits(this.algorand));
    }
    /** The backend for this call. Detection is cached per AlgorandClient, so this costs no request after the first. */
    async _gkResolveBackend() {
        const mode = this.backend;
        if (typeof mode === 'object')
            return mode;
        if (mode === 'stock')
            return ghostkitStockBackend(this.algorand);
        if (mode === 'dt' || mode === 'query') {
            // forced: trust that the node is a dtalgorand node, even if it doesn't report its limits; a node without queries
            // makes the query fail
            const missing = mode === 'dt' ? gkMissingForks(this.algorand) : gkMissingQuery(this.algorand);
            if (missing)
                throw new Error(`ghostkit: backend '${mode}' can't be used: ${missing}`);
            const limits = (await this._gkLimits())?.simulate ?? exports.GHOSTKIT_DT_DEFAULT_LIMITS;
            return mode === 'dt' ? ghostkitDTBackend(this.algorand, limits) : ghostkitQueryBackend(this.algorand, { limits });
        }
        if (this._gkShared.fallback)
            return this._gkShared.fallback;
        const node = await this.getNode();
        if (node.kind !== 'dt')
            return ghostkitStockBackend(this.algorand);
        return node.query ? ghostkitQueryBackend(this.algorand, { limits: node.limits }) : ghostkitDTBackend(this.algorand, node.limits);
    }
    /** The backend `auto` simulates with when a run can't be queried. */
    async _gkSimulateBackend() {
        if (this._gkShared.fallback)
            return this._gkShared.fallback;
        const node = await this.getNode();
        return node.kind === 'dt' ? ghostkitDTBackend(this.algorand, node.limits) : ghostkitStockBackend(this.algorand);
    }
    /** The query limits for the pre-checks of a run on the query backend. */
    async _gkQueryLimits() {
        if (this.backend === 'auto') {
            const node = await this.getNode();
            return node.kind === 'dt' ? node.query : undefined;
        }
        return (await this._gkLimits())?.query;
    }
    /** The reader: `readerAccount`, or the fee sink, known for MainNet and TestNet and otherwise read from the genesis once. */
    async _gkReader() {
        if (this.readerAccount)
            return this.readerAccount;
        const { genesisHash } = await this._gkParams(GK_PAST_PARAMS_MAX_AGE);
        const known = genesisHash && GK_KNOWN_FEE_SINKS[gkAlgosdk.bytesToBase64(genesisHash)];
        if (known)
            return known;
        return gkRemember(gkCacheOf(this.algorand), 'feeSink', async () => {
            const genesis = await this.algorand.client.algod.genesis().do();
            const fees = (typeof genesis === 'string' ? JSON.parse(genesis) : genesis)?.fees;
            if (typeof fees !== 'string')
                throw new Error('ghostkit: no fee sink in the genesis; set readerAccount');
            return fees;
        });
    }
    /**
     * Suggested params no older than `maxAge` ms, shared by every SDK on the AlgorandClient. They come from
     * `algorand.getSuggestedParams()`, so its own cache applies too; ghostkit never changes it. Concurrent callers share
     * one request.
     */
    async _gkParams(maxAge) {
        const cache = gkCacheOf(this.algorand);
        if (cache.params && Date.now() - cache.params.at <= maxAge)
            return { ...cache.params.value };
        if (!cache.paramsInFlight) {
            const inFlight = this.algorand.getSuggestedParams();
            cache.paramsInFlight = inFlight;
            inFlight
                .then((value) => (cache.params = { value, at: Date.now() }))
                .catch(() => { })
                .finally(() => {
                if (cache.paramsInFlight === inFlight)
                    cache.paramsInFlight = undefined;
            });
        }
        return { ...(await cache.paramsInFlight) };
    }
    /** A composer whose suggested params come from `params` (`_gkParams`, or none), without touching the AlgorandClient's cache. */
    _gkComposer(params) {
        return new composer_1.TransactionComposer({
            algod: this.algorand.client.algod,
            getSigner: () => gkEmptySigner,
            getSuggestedParams: params,
            appManager: this.algorand.app,
        });
    }
    _gkPrograms() {
        var _a;
        (_a = this._gkShared).programs ?? (_a.programs = {
            approval: gkAlgosdk.base64ToBytes(this.appSpec.byteCode.approval),
            clear: gkAlgosdk.base64ToBytes(this.appSpec.byteCode.clear),
        });
        return this._gkShared.programs;
    }
    _gkMethod(signature) {
        var _a;
        (_a = this._gkShared).methods ?? (_a.methods = new Map(this.appSpec.methods.map((m) => [new gkAlgosdk.ABIMethod(m).getSignature(), m])));
        const method = this._gkShared.methods.get(signature);
        if (!method)
            throw new Error(`ghostkit: method not found in the app spec: ${signature}`);
        return method;
    }
    _gkReturnType(signature) {
        let type = this._gkShared.returnTypes.get(signature);
        if (!type) {
            const { returns } = this._gkMethod(signature);
            type = returns.struct ?? returns.type;
            this._gkShared.returnTypes.set(signature, type);
        }
        return type;
    }
    /** Whether the ghost only runs under consensus v42 or later. */
    _gkNeedsV42() {
        return this._gkMeta.avmVersion >= 13 || this._gkMeta.extraProgramPages > 3;
    }
    async _gkPrepare(spec, input, params) {
        const method = spec.signature.slice(0, spec.signature.indexOf('('));
        const { methodArgsOrArgsArray, extraMethodCallArgs } = input;
        const isList = Array.isArray(methodArgsOrArgsArray);
        const argsList = (isList ? methodArgsOrArgsArray : [methodArgsOrArgsArray]);
        if (Array.isArray(extraMethodCallArgs) && extraMethodCallArgs.length !== argsList.length) {
            throw new Error(`ghostkit: ${method}: extraMethodCallArgs has ${extraMethodCallArgs.length} entries for ${argsList.length} calls`);
        }
        const extraAt = (i) => (Array.isArray(extraMethodCallArgs) ? extraMethodCallArgs[i] : extraMethodCallArgs) ?? {};
        // one group of all the app calls, or chunks of one call's array argument
        const chunk = input.chunk === false ? undefined : (input.chunk ?? spec.chunk);
        let groupEntries;
        if (chunk) {
            if (isList)
                throw new Error(`ghostkit: ${method}: chunk takes a single methodArgsOrArgsArray object, not a list`);
            if (Array.isArray(extraMethodCallArgs))
                throw new Error(`ghostkit: ${method}: chunk takes a single extraMethodCallArgs object`);
            const backend = await this._gkResolveBackend();
            groupEntries = this._gkChunk(spec.signature, argsList[0], chunk, backend.limits).map((txns) => txns.map((args) => ({ args, extra: extraAt(0) })));
        }
        else {
            if (argsList.length > GK_MAX_GROUP_SIZE) {
                throw new Error(`ghostkit: ${method}: ${argsList.length} app calls don't fit in one group of ${GK_MAX_GROUP_SIZE}`);
            }
            groupEntries = [argsList.map((args, i) => ({ args, extra: extraAt(i) }))];
        }
        const ghost = !this.ghostAppId;
        const programs = ghost ? this._gkPrograms() : undefined;
        const schema = this.appSpec.state.schema;
        // the minimum balance the reader holds for each ghost app it creates in a group
        const appMinBalance = ghost
            ? GK_APP_MIN_BALANCE * BigInt(1 + this._gkMeta.extraProgramPages) +
                GK_GLOBAL_UINT_MIN_BALANCE * BigInt(schema.global.ints) +
                GK_GLOBAL_BYTES_MIN_BALANCE * BigInt(schema.global.bytes)
            : 0n;
        const ownFee = (extra) => extra.staticFee !== undefined || extra.extraFee !== undefined;
        /** The static fee of each app call of a group under the plan; undefined leaves the call's own or the minimum fee. */
        const feesFor = (entries, plan) => {
            const fees = entries.map(() => undefined);
            if (plan.kind === 'min' || ownFee(entries[0].extra))
                return fees;
            if (plan.kind === 'fixed') {
                fees[0] = plan.amount;
                return fees;
            }
            // max: the first pays what's left after the ghost apps' minimum balance and the others' own fees; the others nothing
            let budget = plan.spendable - appMinBalance * BigInt(entries.length);
            for (let i = 1; i < entries.length; i++) {
                const { staticFee, extraFee } = entries[i].extra;
                if (staticFee !== undefined)
                    budget -= staticFee.microAlgo;
                else if (extraFee !== undefined)
                    budget -= plan.minFee + extraFee.microAlgo;
                else
                    fees[i] = 0n;
            }
            // a reader that can't even pay the minimum fee keeps the defaults, and the simulate fails with an overspend
            if (budget >= plan.minFee)
                fees[0] = budget;
            else
                fees.fill(undefined);
            return fees;
        };
        const groupsFor = ({ reader, fees: plan, params: suggested }) => groupEntries.map((entries) => async (validity) => {
            const composer = this._gkComposer(suggested);
            const fees = feesFor(entries, plan);
            for (let i = 0; i < entries.length; i++) {
                const { args, extra } = entries[i];
                const callParams = { args, sender: reader, signer: gkEmptySigner, ...extra };
                if (fees[i] !== undefined)
                    callParams.staticFee = amount_1.AlgoAmount.MicroAlgos(fees[i]);
                if (validity && extra.firstValidRound === undefined && extra.lastValidRound === undefined)
                    Object.assign(callParams, validity);
                const call = (await params(callParams));
                if (programs) {
                    const { appId: _appId, ...rest } = call;
                    composer.addAppCreateMethodCall({
                        ...rest,
                        approvalProgram: programs.approval,
                        clearStateProgram: programs.clear,
                        schema: {
                            globalInts: schema.global.ints,
                            globalByteSlices: schema.global.bytes,
                            localInts: schema.local.ints,
                            localByteSlices: schema.local.bytes,
                        },
                        extraProgramPages: this._gkMeta.extraProgramPages,
                    });
                }
                else {
                    composer.addAppCallMethodCall(call);
                }
            }
            return composer;
        });
        // a query sends each app call alone, as the block after the round makes it: fields it can't set go to simulate
        const abiArgs = this._gkMethod(spec.signature).args;
        const unqueryableField = ['firstValidRound', 'lastValidRound', 'validityWindow', 'note', 'lease', 'rekeyTo', 'accessReferences', 'rejectVersion'].find((field) => groupEntries.some((entries) => entries.some(({ extra }) => extra[field] !== undefined)));
        const simulateOnly = abiArgs.some((a) => gkAlgosdk.abiTypeIsTransaction(a.type))
            ? `${method} has transaction arguments`
            : unqueryableField
                ? `extraMethodCallArgs sets ${unqueryableField}`
                : undefined;
        return {
            method,
            returnType: this._gkReturnType(spec.signature),
            groupCount: groupEntries.length,
            groupsFor,
            shape: groupEntries.map((entries) => entries.map(({ args }) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])))),
            options: input.extraSimulateArgs,
            needsReader: abiArgs.some((a) => a.type === 'account'),
            ...(simulateOnly ? { simulateOnly } : {}),
        };
    }
    /** Splits a call's array argument into groups of app calls, sized to the node's limits. */
    _gkChunk(signature, args, chunk, limits) {
        const method = this._gkMethod(signature);
        const name = method.name;
        const arg = method.args.find((a) => a.name === chunk.arg);
        if (!arg)
            throw new Error(`ghostkit: ${name} has no argument ${chunk.arg} to chunk`);
        const items = args[chunk.arg];
        if (!Array.isArray(items) || !arg.type.endsWith('[]'))
            throw new Error(`ghostkit: ${name}: ${chunk.arg} is not a dynamic array`);
        if (items.length === 0)
            return [[args]];
        // app arg bytes: the selector, the other arguments, and the array's length prefix and items. The array is one app
        // arg, so it also stays within the per-arg limit.
        const elementType = gkAlgosdk.ABIType.from(arg.type.slice(0, -2));
        const otherBytes = method.args
            .filter((a) => a !== arg)
            .reduce((n, a) => {
            if (gkAlgosdk.abiTypeIsReference(a.type))
                return n + 1;
            if (gkAlgosdk.abiTypeIsTransaction(a.type))
                throw new Error(`ghostkit: ${name}: can't chunk a method with transaction arguments`);
            // algokit's encoder returns a Uint8Array as is, so for an ABI type such as byte[] encode it with algosdk, which
            // adds the length prefix the app call will carry
            const value = args[a.name];
            const asIs = a.struct || a.type.startsWith('AVM') || !(value instanceof Uint8Array);
            return n + (asIs ? (0, app_arc56_1.getABIEncodedValue)(value, a.struct ?? a.type, this.appSpec.structs) : gkAlgosdk.ABIType.from(a.type).encode(value)).length;
        }, 4);
        const maxArgBytes = chunk.maxArgBytes ?? (this._gkNeedsV42() ? 16384 : 4096);
        const maxArrayBytes = Math.min(maxArgBytes - otherBytes, GK_MAX_ARG_BYTES);
        if (maxArrayBytes < 2)
            throw new Error(`ghostkit: ${name}: the other arguments leave no room for ${chunk.arg} in an app call`);
        let perTxn = chunk.maxPerTxn ?? Infinity;
        if (!elementType.isDynamic()) {
            perTxn = Math.min(perTxn, Math.floor((maxArrayBytes - 2) / elementType.byteLen()));
        }
        else if (chunk.maxPerTxn === undefined) {
            throw new Error(`ghostkit: ${name}: set chunk.maxPerTxn, since the items of ${chunk.arg} vary in size`);
        }
        const refsPerItem = chunk.refsPerItem ?? 1;
        const perGroupRefs = refsPerItem > 0 ? Math.floor((GK_MAX_GROUP_SIZE * GK_REFS_PER_TXN * limits.resourceLimitMultiplier) / refsPerItem) : Infinity;
        perTxn = Math.min(perTxn, perGroupRefs);
        if (!(perTxn >= 1))
            throw new Error(`ghostkit: ${name}: not even one item of ${chunk.arg} fits in an app call`);
        const perGroup = Math.min(chunk.maxPerGroup ?? Infinity, GK_MAX_GROUP_SIZE * perTxn, perGroupRefs);
        const groups = [];
        for (let g = 0; g < items.length; g += perGroup) {
            const groupItems = items.slice(g, g + perGroup);
            const txns = [];
            for (let t = 0; t < groupItems.length; t += perTxn)
                txns.push({ ...args, [chunk.arg]: groupItems.slice(t, t + perTxn) });
            groups.push(txns);
        }
        // items of varying size are split by maxPerTxn alone, so check each app call's bytes here
        if (elementType.isDynamic()) {
            for (const txn of groups.flat()) {
                const chunkItems = txn[chunk.arg];
                const bytes = gkAlgosdk.ABIType.from(arg.type).encode(chunkItems).length;
                if (bytes <= maxArrayBytes)
                    continue;
                throw new Error(chunkItems.length === 1
                    ? `ghostkit: ${name}: an item of ${chunk.arg} takes ${bytes} bytes, more than the ${maxArrayBytes} that fit in an app call`
                    : `ghostkit: ${name}: ${chunkItems.length} items of ${chunk.arg} take ${bytes} bytes, more than the ${maxArrayBytes} that fit in an app call; lower chunk.maxPerTxn`);
            }
        }
        return groups;
    }
    /**
     * Runs prepared calls at the target. With `auto`, a run on the query backend goes to simulate when it can't be queried
     * (`_gkQueryBlocker`) or the node rejects the query (`_gkQueryFallback`); the extended simulate falls back to one
     * simulate per group if the node turns out not to support it.
     */
    async _gkRun(calls, target, options) {
        var _a;
        let backend = await this._gkResolveBackend();
        let fallback;
        if (backend.name === 'query') {
            const auto = this.backend === 'auto';
            fallback = await this._gkQueryBlocker(calls, target, options);
            if (fallback && !auto)
                throw new Error(`ghostkit: backend 'query' can't run this call: ${fallback}`);
            if (!fallback) {
                try {
                    return await this._gkRunOn(backend, calls, target, options);
                }
                catch (e) {
                    const signal = { ...options, ...calls[0]?.options }.signal;
                    const reason = auto && !signal?.aborted ? this._gkQueryFallback(e) : undefined;
                    if (!reason)
                        throw e;
                    fallback = reason.message;
                    if (reason.sticky)
                        (_a = this._gkShared).fallback ?? (_a.fallback = await this._gkSimulateBackend());
                }
            }
            backend = await this._gkSimulateBackend();
        }
        try {
            return await this._gkRunOn(backend, calls, target, options, fallback);
        }
        catch (e) {
            const name = e?.name;
            if (this.backend !== 'auto' || backend.name !== 'dt' || (name !== 'DTUnsupportedError' && name !== 'DTNotAvailableError'))
                throw e;
            this._gkWarn('dt-fallback', `extended simulate failed (${e.message}); falling back to one simulate per group`);
            backend = ghostkitStockBackend(this.algorand);
            this._gkShared.fallback = backend;
            return this._gkRunOn(backend, calls, target, options, e.message);
        }
    }
    /** What `_gkShared.unqueryable` remembers the node's rejection of this SDK's queries by: the ghost program or the app. */
    _gkQueryKey() {
        return this.ghostAppId ? `app ${this.ghostAppId}` : 'ghost';
    }
    /** Why a run must be simulated rather than queried, or undefined if it can be queried. */
    async _gkQueryBlocker(calls, target, options) {
        const merged = { ...options, ...calls[0]?.options };
        if (merged.execTraceConfig?.enable)
            return 'execution traces need simulate';
        const own = calls.find((c) => c.simulateOnly)?.simulateOnly;
        if (own)
            return own;
        if (target.kind === 'rounds' && (merged.validityWindow === 'skip' || merged.validityWindow === null)) {
            return `validityWindow ${merged.validityWindow} needs simulate`;
        }
        const rejected = this._gkShared.unqueryable.get(this._gkQueryKey());
        if (rejected)
            return `the node rejected querying this ${this.ghostAppId ? 'app' : 'ghost'} before (${rejected})`;
        const limits = await this._gkQueryLimits();
        if (!limits)
            return undefined;
        // simulate pools 700 per app call with the extra budget; a query gives each app call maxCallBudget
        const extraBudget = Number(merged.extraOpcodeBudget ?? 170000);
        const groupSize = Math.max(1, ...calls.flatMap((c) => c.shape.map((g) => g.length)));
        if (extraBudget + GK_APP_CALL_BUDGET * groupSize > limits.maxCallBudget) {
            return `extraOpcodeBudget ${extraBudget} and ${GK_APP_CALL_BUDGET} per app call of a group of ${groupSize} are more than the node's maxCallBudget ${limits.maxCallBudget}`;
        }
        if ((merged.allowMoreLogging ?? true) && limits.maxCallLogBytes < GK_MORE_LOGGING_BYTES) {
            return `allowMoreLogging needs ${GK_MORE_LOGGING_BYTES} log bytes per app call; the node's maxCallLogBytes is ${limits.maxCallLogBytes}`;
        }
        return undefined;
    }
    /**
     * Whether `auto` simulates a run whose query failed with `e`, and why; undefined to throw. A group the query backend
     * can't send and a request the node rejects (400) simulate this run; a node without queries (a load balancer mixing
     * nodes) makes `auto` simulate from now on (`sticky`).
     */
    _gkQueryFallback(e) {
        const error = e;
        if (error?.name === GK_QUERY_UNSUPPORTED)
            return { message: error.message };
        if (error?.name === 'DTUnsupportedError' || error?.name === 'DTNotAvailableError') {
            this._gkWarn('query-fallback', `query failed (${error.message}); falling back to the extended simulate`);
            return { message: error.message, sticky: true };
        }
        if (gkStatus(e) === 400) {
            const message = gkErrorText(e);
            // the node won't query a program this large (older dtalgod checked the pre-v42 size limit): remember it, for this
            // SDK instance
            if (/bytes, more than the \d+ an app may have/.test(message))
                this._gkShared.unqueryable.set(this._gkQueryKey(), message);
            this._gkWarn('query-400', `the node rejected a query (${message}); simulating instead`);
            return { message: `the node rejected the query: ${message}` };
        }
        return undefined;
    }
    /**
     * What the reader can spend at a round (the latest if undefined) over its minimum balance; undefined if unknown. A node
     * that can't read the account at the round (a stock node answers with the latest, a dtalgorand node without time travel
     * fails) gives its latest balance, the best guess.
     */
    _gkSpendable(round) {
        return this._gkReader().then((reader) => this._gkSpendableOf(reader, round));
    }
    _gkSpendableOf(reader, round) {
        const spendableCache = gkCacheOf(this.algorand).spendable;
        const key = `${reader}@${round ? round : 'latest'}`;
        const now = Date.now();
        const cached = spendableCache.get(key);
        if (cached && cached.expires > now)
            return cached.value;
        const entry = { value: Promise.resolve(undefined), expires: now + this.cacheParamsTimeout };
        entry.value = (async () => {
            const http = this.algorand.client.algod.c;
            const read = async (query) => {
                const res = await http.get({ relativePath: `/v2/accounts/${reader}`, query: { exclude: 'all', ...query } });
                const account = JSON.parse(res.text ?? new TextDecoder().decode(res.body));
                const spendable = BigInt(account.amount ?? 0) - BigInt(account['min-balance'] ?? 0);
                // the balance at a past round never changes
                if (round && account.round !== undefined && BigInt(account.round) === round)
                    entry.expires = Infinity;
                return spendable > 0n ? spendable : 0n;
            };
            try {
                return await read(round ? { round } : {});
            }
            catch (e) {
                if (!round)
                    throw e;
                this._gkWarn('spendable-round', `couldn't read the reader's balance at past rounds (${e.message}); using the latest`);
                return await read({});
            }
        })().catch((e) => {
            this._gkWarn('spendable', `couldn't read the reader's balance (${e.message}); paying minimum fees`);
            return undefined;
        });
        spendableCache.set(key, entry);
        return entry.value;
    }
    /** How the run's groups pay fees: see `ghostFee`. */
    async _gkFeePlan(target, minFee) {
        if (this.ghostFee !== 'max') {
            const amount = BigInt(this.ghostFee);
            return amount > 0n ? { kind: 'fixed', amount } : { kind: 'min' };
        }
        const rounds = target.kind === 'latest' ? [undefined] : target.kind === 'round' ? [target.round] : target.rounds;
        const spendable = await gkMapLimit(rounds, 8, (round) => this._gkSpendable(round));
        const known = spendable.filter((v) => v !== undefined);
        if (known.length === 0)
            return { kind: 'min' };
        // the rounds share their transactions, so they pay what the reader can spend at every round where it can spend
        // anything; rounds where it can't fail on their own
        const positive = known.filter((v) => v > 0n);
        const least = positive.length ? positive.reduce((a, b) => (b < a ? b : a)) : 0n;
        return { kind: 'max', spendable: least, minFee };
    }
    /** Runs prepared calls on a backend; `fallback` is why `_gkRun` fell back to it, for debug. */
    async _gkRunOn(backend, calls, target, options, fallback) {
        const { validityWindow, protocol, round: _round, ...rest } = { ...options, ...calls[0]?.options };
        const raw = { extraOpcodeBudget: 170000, allowMoreLogging: true, allowUnnamedResources: true, ...rest };
        // Ghosts are compiled for recent AVM versions (and maybe v42's larger programs), which older rounds' protocols
        // reject. On a dtalgorand node past rounds run under the latest protocol, a no-op at rounds already on it.
        const past = target.kind !== 'latest';
        const autoProtocol = protocol === undefined && past && gkExtended(backend) ? 'latest' : undefined;
        const request = { ...raw, ...((protocol ?? autoProtocol) ? { protocol: (protocol ?? autoProtocol) } : {}) };
        // queries check no fees or validity, and need the real reader only for `account` arguments: no requests for them
        const query = backend.name === 'query';
        let fees = { kind: 'min' };
        let minFee = 1000n;
        let build;
        if (query) {
            const reader = this.readerAccount ?? (calls.some((c) => c.needsReader) ? await this._gkReader() : GK_ZERO_ADDRESS);
            build = { reader, fees, params: async () => ({ ...GK_QUERY_PARAMS }) };
        }
        else {
            // calls at the latest round need fresh params for their validity window; calls at past rounds set their own
            const paramsMaxAge = target.kind === 'latest' ? this.cacheParamsTimeout : GK_PAST_PARAMS_MAX_AGE;
            const [params, reader] = await Promise.all([this._gkParams(paramsMaxAge), this._gkReader()]);
            minFee = BigInt(params.minFee);
            fees = await this._gkFeePlan(target, minFee);
            build = { reader, fees, params: () => this._gkParams(paramsMaxAge) };
        }
        const groups = calls.flatMap((c) => c.groupsFor(build));
        const feeLabel = fees.kind === 'max' ? `max(${fees.spendable})` : fees.kind === 'fixed' ? `${fees.amount}` : 'min';
        const label = calls.length === 1 ? calls[0].method : `batch(${calls.map((c) => c.method).join(',')})`;
        const at = target.kind === 'latest' ? 'latest' : target.kind === 'round' ? `${target.round}` : `rounds(${target.rounds.length})`;
        const debug = this.debug ? { id: Math.random().toString(36).substring(2, 10), start: performance.now() } : undefined;
        if (debug) {
            if (fallback)
                console.warn(`[DEBUG] Ghostkit fallback id=${debug.id} m=${label} to=${backend.name} reason=${fallback}`);
            console.warn(`[DEBUG] Ghostkit pre id=${debug.id} m=${label} target=${this.ghostAppId ?? 'ghost'} backend=${backend.name} at=${at}` +
                ` groups=${groups.length} txns=${calls.reduce((n, c) => n + c.shape.reduce((m, g) => m + g.length, 0), 0)}` +
                `${query ? '' : ` fee=${feeLabel}`}${request.protocol ? ` protocol=${request.protocol}` : ''} ${JSON.stringify(calls.map((c) => c.shape))}`);
        }
        let rounds;
        if (target.kind === 'rounds') {
            const mode = validityWindow === undefined ? 'rewrite' : (validityWindow ?? undefined);
            rounds = await backend.simulateRounds(groups, target.rounds, { ...request, ...(mode ? { validityWindow: mode } : {}) });
        }
        else {
            const round = target.kind === 'round' ? target.round : undefined;
            rounds = [{ round: round ?? 0n, groups: await backend.simulate(groups, { ...request, round }) }];
        }
        const simEnd = debug ? performance.now() : 0;
        const structs = this.appSpec.structs;
        const results = rounds.map(({ round, groups: outcomes, protocolOverride }) => {
            let next = 0;
            const roundOrUndefined = target.kind === 'latest' ? undefined : round;
            const callResults = calls.map((call) => {
                const own = outcomes.slice(next, (next += call.groupCount));
                const failed = own.find((o) => !o.ok);
                if (failed && !failed.ok) {
                    return {
                        ok: false,
                        error: new GhostkitError(call.method, roundOrUndefined, failed.error, this._gkHint(backend, target, failed.error, fees)),
                    };
                }
                try {
                    const value = own.flatMap((o) => gkDecodeLogs(o.logs, call.returnType, structs));
                    return { ok: true, value };
                }
                catch (e) {
                    return { ok: false, error: new GhostkitError(call.method, roundOrUndefined, e) };
                }
            });
            return { round: roundOrUndefined, ...(protocolOverride ? { protocolOverride } : {}), calls: callResults };
        });
        if (debug) {
            const end = performance.now();
            // what the groups would pay on chain: each group's usage (millionths of a minimum fee) times the minimum fee, rounded up
            const usages = rounds.flatMap((r) => r.groups).flatMap((o) => (o.ok && o.groupUsage !== undefined ? [BigInt(o.groupUsage)] : []));
            const usage = usages.reduce((a, b) => a + b, 0n);
            const needed = usages.reduce((n, u) => n + (minFee * u + 999999n) / 1000000n, 0n);
            // what the app calls used of their opcode budget, as queries report it
            const costs = rounds.flatMap((r) => r.groups).flatMap((o) => (o.ok && o.cost !== undefined ? [o.cost] : []));
            console.warn(`[DEBUG] Ghostkit post id=${debug.id} m=${label} tSim=${(simEnd - debug.start).toFixed(2)}ms tProc=${(end - simEnd).toFixed(2)}ms` +
                ` t=${(end - debug.start).toFixed(2)}ms${usages.length ? ` usage=${usage} feeNeeded=${needed}` : ''}` +
                `${costs.length ? ` cost=${costs.reduce((a, b) => a + b, 0)}` : ''}`);
        }
        return results;
    }
    /** A hint for errors that a different node or reader would avoid. */
    _gkHint(backend, target, error, fees) {
        const message = error.message ?? '';
        const reader = this.readerAccount ?? 'the fee sink';
        if (/fees is less than|fee .* too small/.test(message)) {
            return fees.kind === 'max'
                ? `the group needs more in fees than the reader (${reader}) can spend: ${fees.spendable} microAlgo; set a readerAccount with more`
                : `ghostFee is ${fees.kind === 'fixed' ? `${fees.amount} microAlgo` : 'the minimum fee'}; 'max' pays what the reader can spend`;
        }
        if (/overspend|balance .* below min/i.test(message)) {
            return `the reader (${reader}) can't pay the fees or the ghost app's minimum balance at this round; set a readerAccount funded at it`;
        }
        if (/program version \d+ greater than protocol supported version/.test(message)) {
            return gkExtended(backend)
                ? "the ghost's AVM version is newer than this round's protocol allows; leave protocol unset or set it to 'latest'"
                : "the ghost's AVM version is newer than this round's protocol allows; running it there needs a dtalgorand node and the dtalgorand forks of algokit-utils and algosdk";
        }
        if (target.kind !== 'latest' && backend.name === 'stock' && gkStatus(error) !== undefined) {
            return 'a stock node only simulates its last few rounds; use a dtalgorand node with time travel for older rounds';
        }
        // a query reports a round it can't run at as the groups' error, without an HTTP status
        const roundFailed = gkStatus(error) !== undefined || error.kind === 'round';
        if (target.kind !== 'latest' && gkExtended(backend) && !backend.limits.timeTravel && roundFailed) {
            return "this dtalgorand node doesn't have time travel, so only its last few rounds can be simulated";
        }
        return undefined;
    }
}
exports.GhostkitBase = GhostkitBase;
/* END GHOSTKIT RUNTIME */
//# sourceMappingURL=runtime.js.map