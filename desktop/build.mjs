import { createRequire } from 'node:module'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
// Existing installations can reuse Hermes' build tools; no app dependency install needed.
const require = createRequire(process.env.HERMES_BUILD_PACKAGE || join(here, 'package.json'))
const { build } = require('esbuild')
const files = {}
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (entry.isFile() && path.endsWith('.ktx2')) {
      const rel = relative(root, path).replaceAll('\\', '/')
      files['/' + rel] = rel
    }
  }
}
for (const role of ['kurisu', 'chiemi']) await collect(join(root, 'assets/spriteforge/runtime', role))
for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) files['/render/web/vendor/' + name] = 'render/web/vendor/' + name
const scripts = await Promise.all(['vendor/pixi.min.js', 'vendor/pixi-basis-ktx2.global.js', 'renderer.js']
  .map(name => readFile(join(root, 'render/web', name), 'utf8')))
await mkdir(join(here, '.build'), { recursive: true })
const data = join(here, '.build/character-data.json')
await writeFile(data, JSON.stringify({ files, scripts }))
await build({ entryPoints: [join(here, 'src/plugin.mjs')], outfile: join(here, 'plugin.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic',
  external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'],
  nodePaths: [dirname(require.resolve('qrcode/package.json')) + '/..'],
  alias: { 'amadeus-character-data': data, qrcode: require.resolve('qrcode/lib/browser.js') },
  // Minification also removes esbuild's development module labels containing
  // absolute dependency paths when reusing another installation's tools.
  minify: true, legalComments: 'eof', sourcemap: false,
})
console.log(`Built portable preview plugin; ${Object.keys(files).length} relative resource routes, no textures or credentials.`)
