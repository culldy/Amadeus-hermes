import { RENDER_EVENT_METHODS } from '../../electron/src/renderer/renderBridge.ts'

export function mapRenderEvent(method, params, assetMap) {
  if (!RENDER_EVENT_METHODS.includes(method)) throw new Error('Not a render event')
  const mapped = structuredClone(params)
  const lookup = url => {
    if (assetMap.has(url)) return assetMap.get(url)
    const upper = url.replace(/^file:\/\/\/([a-z]):/i, (_, d) => `file:///${d.toUpperCase()}:`)
    if (assetMap.has(upper)) return assetMap.get(upper)
    const lower = url.replace(/^file:\/\/\/([a-z]):/i, (_, d) => `file:///${d.toLowerCase()}:`)
    if (assetMap.has(lower)) return assetMap.get(lower)
    return undefined
  }
  const urls = values => {
    if (!Array.isArray(values)) throw new Error('Invalid character resource list')
    return values.map(value => {
      const result = lookup(value)
      if (!result) throw new Error('Character resource not registered')
      return result
    })
  }
  if (method === 'render.sprite_frames') mapped.urls = urls(mapped.urls)
  if (method === 'render.mouth_config' && mapped.config?.frameUrls) {
    mapped.config.frameUrls = urls(mapped.config.frameUrls)
  }
  if (method === 'render.mode' && mapped.mode !== 'sprite') throw new Error('SpriteForge mode required')
  // Subtitles and graph labels are text/data, not URLs to rewrite.
  return mapped
}

