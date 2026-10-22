import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('published bundle has only host imports and no local build paths or serialized credentials', async () => {
  const source = await readFile(new URL('../plugin.js', import.meta.url), 'utf8')
  // Parse the module: the sandbox's renderer is a string and may itself contain
  // example import text, which must not be mistaken for a host dependency.
  const imports = new vm.SourceTextModule(source).dependencySpecifiers
  assert.ok(imports.length > 0)
  assert.ok(imports.every(name => ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'].includes(name)))
  assert.doesNotMatch(source, /[A-Z]:[\\/](?:Users|amadeus-hermes)\b/i)
  assert.doesNotMatch(source, /\bamadeus\.auth\.[A-Za-z0-9_-]{32,512}\b/)
  assert.doesNotMatch(source, /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{24,})\b/)
})

test('built artifact loads and registers one persistent pane docked beside Files', async () => {
  const source = await readFile(new URL('../plugin.js', import.meta.url), 'utf8')
  const context = vm.createContext({ console })
  const contributions = []
  const host = { undismissPane: id => assert.equal(id, 'amadeus-fourth-pane-prototype:character') }
  const values = {
    '@hermes/plugin-sdk': { host, SandboxedFrame: () => null },
    react: Object.fromEntries(['useEffect', 'useRef', 'useCallback', 'useState', 'useMemo'].map(name => [name, () => {}])),
    'react/jsx-runtime': { Fragment: Symbol('Fragment'), jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  }
  const module = new vm.SourceTextModule(source, { context })
  await module.link(name => {
    assert.ok(Object.hasOwn(values, name), 'Unexpected host dependency')
    return new vm.SyntheticModule(Object.keys(values[name]), function () {
      for (const [key, value] of Object.entries(values[name])) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  const plugin = module.namespace.default
  assert.equal(plugin.id, 'amadeus-fourth-pane-prototype')
  plugin.register({ storage: { get: (_, fallback) => fallback }, register: item => contributions.push(item) })
  assert.equal(contributions.length, 1)
  const pane = contributions[0]
  assert.equal(pane.area, 'panes')
  assert.equal(pane.data.dock.pane, 'files')
  assert.equal(pane.data.lifecycleKeepAlive, true)
  assert.equal(pane.data.minWidth, '160px')
  assert.ok(pane.render().props.hermesContext)
})
