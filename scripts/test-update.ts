import assert from 'node:assert/strict'
import { compareVersions } from '../src/main/update'

assert.ok(compareVersions('0.1.0', 'v0.1.1') < 0)
assert.ok(compareVersions('v1.2.3', '1.2.2') > 0)
assert.equal(compareVersions('1.2.3', 'v1.2.3'), 0)
assert.ok(compareVersions('1.0.0-beta.1', '1.0.0-beta.2') < 0)
assert.ok(compareVersions('1.0.0-rc.1', '1.0.0-beta.9') > 0)
assert.ok(compareVersions('1.0.0-beta', '1.0.0') < 0)
assert.equal(compareVersions('1.0.0+build.2', '1.0.0+build.1'), 0)

console.log('[update] semantic version comparison OK')
console.log('[update] PASS')
