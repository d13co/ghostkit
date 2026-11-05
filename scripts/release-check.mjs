#!/usr/bin/env node
// Checks that package.json, package-lock.json and the README agree on the version, and on a release tag
// (v<version>) that the tag names it too. CI runs it on every push; run it locally before tagging:
//   node scripts/release-check.mjs v0.1.0-dt.7
import { readFileSync } from 'node:fs'

const tag = process.argv[2] ?? ''
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const readme = read('README.md')
const errors = []

const version = pkg.version
if (lock.version !== version || lock.packages?.['']?.version !== version) {
  errors.push(`package-lock.json has ${lock.version} / ${lock.packages?.['']?.version}, package.json ${version}: run npm install`)
}
if (tag && tag !== `v${version}`) errors.push(`the tag ${tag} doesn't match package.json's version ${version}`)
// the forks must be pinned exactly, from npm, and overridden across the tree
for (const name of ['algosdk', '@algorandfoundation/algokit-utils']) {
  const spec = pkg.dependencies?.[name] ?? ''
  if (!/^npm:(@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+(-[\w.]+)?$/.test(spec)) {
    errors.push(`dependencies.${name} is ${JSON.stringify(spec)}, not an exact npm: version`)
  }
  if (pkg.overrides?.[name] !== `$${name}`) errors.push(`overrides.${name} isn't "$${name}"`)
  // the README's install snippet names the same versions
  if (spec && !readme.includes(`"${name}": "${spec}"`)) errors.push(`README.md's install snippet doesn't have "${name}": "${spec}"`)
}

if (errors.length) {
  for (const e of errors) console.error(`::error::${e}`)
  process.exit(1)
}
console.log(`ghostkit ${version}${tag ? `, tag ${tag}` : ''}: OK`)
