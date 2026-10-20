// Generates the SDKs the tests use, from the example contract, into test/generated/.
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buildGhostSDK } from '../src/build'

type Spec = {
  name: string
  byteCode: { approval: string; clear: string }
  methods: { name: string; desc?: string }[]
  [key: string]: unknown
}

const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'))
const toB64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

/** Pads the approval program to `size` bytes with unreachable `pushbytes` after its last opcode. */
function padded(spec: Spec, size: number, name = spec.name): Spec {
  const program = Array.from(fromB64(spec.byteCode.approval))
  while (program.length < size) {
    const len = Math.min(1000, size - program.length - 3)
    program.push(0x80, 0x80 | (len & 0x7f), len >> 7, ...new Array(len).fill(0))
  }
  return { ...spec, name, byteCode: { ...spec.byteCode, approval: toB64(Uint8Array.from(program)) } }
}

const readonlyMethod = (name: string, args: { type: string; name: string }[]) => ({
  name,
  args,
  returns: { type: 'uint64' },
  actions: { create: ['NoOp'], call: ['NoOp'] },
  readonly: true,
  events: [],
  recommendations: {},
})

export default async function setup() {
  const dir = join(process.cwd(), 'test/generated')
  mkdirSync(dir, { recursive: true })
  const read = (path: string) => JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as Spec
  const example = read('examples/Ghostofavm.arc56.json')
  // the example's TEAL compiled with `#pragma version 13` (goal clerk compile)
  const v13 = read('test/fixtures/GhostV13.arc56.json')
  const specs: Spec[] = [
    { ...example, name: 'GhostV11' },
    v13,
    padded(v13, 9_000, 'GhostBig'),
    {
      ...example,
      name: 'GhostChunk',
      methods: [
        ...example.methods.map((m) =>
          m.name === 'acctBalanceData' ? { ...m, desc: 'Balance data of each account.\n@ghostkit-chunk accounts' } : m,
        ),
        // not in the program: for chunking arrays next to other arguments, which fails or is sized before any simulate
        readonlyMethod('tagLengths', [{ type: 'string[]', name: 'tags' }, { type: 'byte[]', name: 'memo' }]),
        readonlyMethod('memoBalances', [{ type: 'address[]', name: 'accounts' }, { type: 'byte[]', name: 'memo' }]),
      ],
    },
  ]
  for (const spec of specs) {
    const path = join(dir, `${spec.name}.arc56.json`)
    writeFileSync(path, JSON.stringify(spec))
    await buildGhostSDK(path, { warn: () => {} })
  }
}
