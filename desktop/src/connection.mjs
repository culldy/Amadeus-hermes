export function normalizeRoot(value) {
  const root = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!/^[A-Za-z]:\/.+/.test(root) || root.split('/').some(part => part === '.' || part === '..') || /[\x00-\x1f?#]/.test(root)) {
    throw new Error('请输入 Amadeus 的完整 Windows 安装目录')
  }
  return root
}

export function resourcePath(root, route, files) {
  if (!Object.hasOwn(files, route) || files[route] !== route.slice(1) ||
      !route.startsWith('/') || route.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Unknown character resource')
  }
  return normalizeRoot(root) + route
}

export function assetMap(root, files) {
  return new Map(Object.keys(files).filter(route => route.endsWith('.ktx2')).map(route => [
    new URL('file:///' + resourcePath(root, route, files)).href,
    'https://amadeus-assets.invalid' + route,
  ]))
}

function wait(signal) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, 1000)
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}

export async function installedConnection(root, autoStart, signal, native = window.hermesDesktop) {
  root = normalizeRoot(root)
  if (signal.aborted) throw new Error('Connection cancelled')
  if (!native?.readFileText) throw new Error('需要支持本地文件桥接的 Hermes Windows 桌面版')
  if (autoStart) await native.openExternal(root + '/runtime/hermes-desktop/Start Amadeus with Hermes.lnk')
  while (!signal.aborted) {
    let raw
    try { raw = await native.readFileText(root + '/runtime/hermes-desktop/connection.json') }
    catch { await wait(signal); continue }
    const value = JSON.parse(raw.text)
    // Never send a local presentation credential to a remote or arbitrary endpoint.
    const url = new URL(value.url)
    if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !url.port ||
        url.pathname !== '/hermes/ui/ws' || url.username || url.password || url.search || url.hash ||
        !Array.isArray(value.protocols) || value.protocols.length !== 2 ||
        value.protocols[0] !== 'amadeus.local.v1' ||
        !/^amadeus\.auth\.[A-Za-z0-9_-]{32,512}$/.test(value.protocols[1])) {
      throw new Error('Amadeus 本地连接描述无效')
    }
    return value
  }
  throw new Error('Connection cancelled')
}
