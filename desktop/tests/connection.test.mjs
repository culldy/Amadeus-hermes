import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installedConnection, normalizeRoot, resourcePath, assetMap } from '../src/connection.mjs'

const descriptor = { url: 'ws://127.0.0.1:17777/hermes/ui/ws', protocols: ['amadeus.local.v1', 'amadeus.auth.' + 'x'.repeat(43)] }
const root = 'D:/Apps/Amadeus Test'
const files = { '/assets/spriteforge/runtime/kurisu/a.ktx2': 'assets/spriteforge/runtime/kurisu/a.ktx2' }
test('installation paths are portable and resources remain registered under that root', () => {
  assert.equal(normalizeRoot('  D:\\Apps\\Amadeus Test\\ '), root)
  const [route] = Object.keys(files)
  assert.equal(resourcePath(root, route, files), root + route)
  assert.equal(assetMap(root, files).get('file:///D:/Apps/Amadeus%20Test' + route), 'https://amadeus-assets.invalid' + route)
  for (const path of ['', '../foo', 'D:/Apps/../secret', 'https://server/path', 'D:/Apps?secret']) assert.throws(() => normalizeRoot(path))
  assert.throws(() => resourcePath(root, '/private.txt', files))
  assert.throws(() => resourcePath(root, '/../private.txt', { '/../private.txt': '../private.txt' }))
})
test('reads only local presentation credentials; startup is explicit and retains its launcher', async () => {
  const calls = []
  const native = { readFileText: async path => { calls.push(['read', path]); return { text: JSON.stringify(descriptor) } },
    openExternal: async path => { calls.push(['open', path]) } }
  assert.deepEqual(await installedConnection(root, false, new AbortController().signal, native), descriptor)
  assert.deepEqual(calls, [['read', root + '/runtime/hermes-desktop/connection.json']])
  calls.length = 0
  await installedConnection(root, true, new AbortController().signal, native)
  assert.equal(calls[0][1], root + '/runtime/hermes-desktop/Start Amadeus with Hermes.lnk')
})
test('never sends credentials to a remote or alternate control socket', async () => {
  for (const url of ['ws://example.com:17777/hermes/ui/ws', 'ws://127.0.0.1:17777/ws', 'ws://127.0.0.1:17777/hermes/ui/ws?token=x']) {
    await assert.rejects(installedConnection(root, false, new AbortController().signal,
      { readFileText: async () => ({ text: JSON.stringify({ ...descriptor, url }) }) }), /连接描述无效/)
  }
  await assert.rejects(installedConnection(root, false, new AbortController().signal,
    { readFileText: async () => ({ text: JSON.stringify({ ...descriptor, protocols: [] }) }) }), /连接描述无效/)
})
test('unmount aborts waiting and never launches after cancellation', async () => {
  const abort = new AbortController()
  const native = { readFileText: async () => { abort.abort(); throw new Error('not ready') }, openExternal: () => assert.fail('unexpected launch') }
  await assert.rejects(installedConnection(root, false, abort.signal, native), /cancelled/)
  await assert.rejects(installedConnection(root, true, abort.signal, native), /cancelled/)
})
