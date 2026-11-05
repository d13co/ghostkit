import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { checkProjectGhostkit, exactGhostkitVersion } from '../src/version-check'

describe('exactGhostkitVersion', () => {
  test('reads exact pins only', () => {
    expect(exactGhostkitVersion('0.1.0-dt.8')).toBe('0.1.0-dt.8')
    expect(exactGhostkitVersion('=0.1.0')).toBe('0.1.0')
    expect(exactGhostkitVersion('npm:ghostkit@0.1.0-dt.8')).toBe('0.1.0-dt.8')
    for (const spec of ['^0.1.0-dt.8', '~0.1.0', 'latest', 'workspace:*', 'file:../ghostkit-0.1.0-dt.8.tgz', 'npm:other@1.0.0']) {
      expect(exactGhostkitVersion(spec)).toBeUndefined()
    }
  })
})

describe('checkProjectGhostkit', () => {
  let root: string
  const pkg = (dir: string, json: object) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
  }
  /** A ghostkit install: a directory with its package.json. */
  const ghostkit = (dir: string, version: string) => {
    pkg(dir, { name: 'ghostkit', version })
    return dir
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gk-version-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test("passes when no project depends on ghostkit, and in ghostkit's own repository", () => {
    const self = { version: '0.1.0-dt.8', dir: ghostkit(join(root, 'global/ghostkit'), '0.1.0-dt.8') }
    pkg(join(root, 'app'), { name: 'app', dependencies: { algosdk: '3.0.0' } })
    expect(checkProjectGhostkit({ cwd: join(root, 'app'), self })).toBeUndefined()
    expect(checkProjectGhostkit({ cwd: join(root, 'global/ghostkit'), self })).toBeUndefined()
  })

  test("fails when the project's ghostkit isn't installed, as after a failed install, unless this is the version it pins", () => {
    const self = { version: '0.0.10', dir: ghostkit(join(root, 'npx-cache/ghostkit'), '0.0.10') }
    pkg(join(root, 'app'), { name: 'app', dependencies: { ghostkit: '0.1.0-dt.8' } })
    expect(checkProjectGhostkit({ cwd: join(root, 'app'), self })).toMatch(/depends on ghostkit 0\.1\.0-dt\.8, but it isn't installed there .*: 0\.0\.10 at /)
    const pinned = { version: '0.1.0-dt.8', dir: ghostkit(join(root, 'global/ghostkit'), '0.1.0-dt.8') }
    expect(checkProjectGhostkit({ cwd: join(root, 'app'), self: pinned })).toBeUndefined()
    // a spec that isn't an exact version can't be told apart
    pkg(join(root, 'app'), { name: 'app', dependencies: { ghostkit: '^0.1.0-dt.8' } })
    expect(checkProjectGhostkit({ cwd: join(root, 'app'), self: pinned })).toMatch(/isn't installed there/)
  })

  test("fails when another copy runs than the project's, found from a subdirectory", () => {
    const self = { version: '0.1.0-dt.1', dir: ghostkit(join(root, 'nvm/lib/node_modules/ghostkit'), '0.1.0-dt.1') }
    pkg(join(root, 'app'), { name: 'app', devDependencies: { ghostkit: '0.1.0-dt.8' } })
    ghostkit(join(root, 'app/node_modules/ghostkit'), '0.1.0-dt.8')
    // a workspace package without ghostkit, inside the project
    pkg(join(root, 'app/contracts'), { name: 'contracts' })
    expect(checkProjectGhostkit({ cwd: join(root, 'app/contracts'), self })).toMatch(
      /this is ghostkit 0\.1\.0-dt\.1 at .*, but .* uses ghostkit 0\.1\.0-dt\.8 at .*npm exec ghostkit/,
    )
    // another copy of the same version is fine
    const same = { version: '0.1.0-dt.8', dir: ghostkit(join(root, 'global/ghostkit'), '0.1.0-dt.8') }
    expect(checkProjectGhostkit({ cwd: join(root, 'app/contracts'), self: same })).toBeUndefined()
  })

  test("passes for the project's own copy, also through a symlink (pnpm); fails if it is older than an exact pin", () => {
    const store = ghostkit(join(root, 'app/node_modules/.pnpm/ghostkit@0.1.0-dt.8/node_modules/ghostkit'), '0.1.0-dt.8')
    pkg(join(root, 'app'), { name: 'app', dependencies: { ghostkit: '0.1.0-dt.8' } })
    symlinkSync(store, join(root, 'app/node_modules/ghostkit'), 'dir')
    expect(checkProjectGhostkit({ cwd: join(root, 'app'), self: { version: '0.1.0-dt.8', dir: store } })).toBeUndefined()
    expect(checkProjectGhostkit({ cwd: join(root, 'app'), self: { version: '0.1.0-dt.8', dir: join(root, 'app/node_modules/ghostkit') } })).toBeUndefined()

    pkg(join(root, 'app'), { name: 'app', dependencies: { ghostkit: '0.1.0-dt.9' } })
    expect(checkProjectGhostkit({ cwd: join(root, 'app'), self: { version: '0.1.0-dt.8', dir: store } })).toMatch(
      /pins ghostkit 0\.1\.0-dt\.9, but 0\.1\.0-dt\.8 is installed/,
    )
    // a range isn't checked against the version
    pkg(join(root, 'app'), { name: 'app', dependencies: { ghostkit: '^0.1.0-dt.7' } })
    expect(checkProjectGhostkit({ cwd: join(root, 'app'), self: { version: '0.1.0-dt.8', dir: store } })).toBeUndefined()
  })
})
