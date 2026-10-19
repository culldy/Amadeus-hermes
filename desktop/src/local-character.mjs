import { SandboxedFrame } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import character from 'amadeus-character-data'
import { postRenderEvent, RENDER_EVENT_METHODS } from '../../electron/src/renderer/renderBridge.ts'
import { resourcePath, assetMap } from './connection.mjs'
import { mapRenderEvent } from './projection.mjs'

// The existing native file bridge reads ONLY paths registered by the original
// character-pack exporter. No backend, model, audio or control credential.
export async function readCharacterResource(route, root, read = path => window.hermesDesktop.readFileDataUrl(path)) {
  if (!Object.hasOwn(character.files, route)) throw new Error('Unknown character resource')
  const data = await read(resourcePath(root, route, character.files))
  if (typeof data !== 'string' || !data.startsWith('data:')) throw new Error('Character resource unavailable')
  return data
}

const guestBootstrap = `
window.__AMADEUS_HERMES_GPU_PRIMARY = true;
const originalFetch = window.fetch.bind(window);
const pending = new Map(); let serial = 0;
window.fetch = (input, options) => {
  const raw = typeof input === 'string' ? input : input.url;
  if (/^(data:|blob:)/.test(raw)) return originalFetch(input, options);
  const url = new URL(raw, 'https://amadeus-assets.invalid/render/web/');
  if (url.origin !== 'https://amadeus-assets.invalid') return Promise.reject(new Error('External resource disabled'));
  return new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, {resolve, reject});
    parent.postMessage({type:'amadeus.local.asset', id, route:url.pathname}, '*');
  });
};
window.addEventListener('message', async event => {
  if (event.source !== parent) return;
  const m = event.data;
  if (m?.type === 'amadeus.local.scale') window.renderApp?.setDisplayScale(m.value);
  if (m?.type === 'amadeus.local.asset.result') {
    const job = pending.get(m.id); if (!job) return; pending.delete(m.id);
    if (m.error) job.reject(new Error(m.error));
    else { try { job.resolve(await originalFetch(m.data)); } catch(e) { job.reject(e); } }
  }
  if (m?.type === 'amadeus.render.ping') { parent.postMessage({type:'amadeus.local.ready'}, '*'); parent.postMessage({type:'amadeus.local.gpu',gpu:window.__AMADEUS_HERMES_GPU_STATUS || {kind:'unknown',renderer:'GPU status pending'}}, '*'); }
});
window.addEventListener('error', event => parent.postMessage({type:'amadeus.local.error', message:String(event.message)}, '*'));
window.addEventListener('unhandledrejection', event => parent.postMessage({type:'amadeus.local.error', message:String(event.reason?.message || event.reason)}, '*'));
`
const script = text => '<script>' + text.replace(/<\/script/gi, '<\\/script') + '</script>'
const html = '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:; connect-src data: blob:; img-src data: blob:; style-src \'unsafe-inline\'">' +
  '<style>*{margin:0;padding:0;box-sizing:border-box}html,body,#canvas-container{width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body><div id="canvas-container"></div>' +
  script(guestBootstrap) + character.scripts.map(script).join('') +
  script("parent.postMessage({type:'amadeus.local.ready'}, '*');") + '</body></html>'
const frameUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)

export function LocalSpriteForgeFrame({subscribe, onReady, displayScale = 1, root}) {
  const liveAssets = useMemo(() => assetMap(root, character.files), [root])
  const frame = useRef(null)
  const ready = useRef(false)
  const readyCallback = useRef(onReady)
  readyCallback.current = onReady
  const scale = useRef(displayScale)
  scale.current = displayScale
  const [error, setError] = useState('')
  const [gpu, setGpu] = useState(null)
  useEffect(() => {
    let active = true
    const receive = async event => {
      const child = frame.current?.contentWindow
      if (!active || event.source !== child || event.origin !== 'null') return
      const m = event.data
      if (m?.type === 'amadeus.local.ready' && !ready.current) {
        ready.current = true
        // The connected backend owns the selected character.
        child.postMessage({type:'amadeus.local.scale',value:scale.current}, '*')
        readyCallback.current?.()
      }
      if (m?.type === 'amadeus.local.asset') {
        try {
          const data = await readCharacterResource(m.route, root)
          if (active) child.postMessage({type:'amadeus.local.asset.result', id:m.id, data}, '*')
        } catch (err) {
          if (active) { setError(err.message); child.postMessage({type:'amadeus.local.asset.result', id:m.id, error:err.message}, '*') }
        }
      }
      if (m?.type === 'amadeus.local.gpu') { setGpu(m.gpu || {kind:'unknown'}); if(m.gpu?.kind === 'software')setError('人物渲染需要可用的硬件 GPU') }
      if (m?.type === 'amadeus.local.error') setError(m.message)
    }
    window.addEventListener('message', receive)
    return () => { active = false; window.removeEventListener('message', receive) }
  }, [])
  useEffect(() => {
    const stops = subscribe ? RENDER_EVENT_METHODS.map(method=>subscribe(method,params=>{
      if (!ready.current) return
      try {
        const mapped = mapRenderEvent(method,params,liveAssets)
        // Use the same bottom-aligned, height-led portrait framing as Kurisu.
        // Wider poses may crop coat/arms; never squeeze the original art.
        if (method === 'render.spriteforge_graph') mapped.config = {...mapped.config, characterScale:1, fitWidth:false}
        postRenderEvent(frame.current,method,mapped)
      }
      catch(err) { setError(err.message) }
    })) : []
    if (ready.current) onReady?.()
    return () => stops.forEach(stop=>stop())
  }, [subscribe, onReady, liveAssets])
  useEffect(() => {
    if (ready.current) frame.current?.contentWindow.postMessage({type:'amadeus.local.scale',value:displayScale}, '*')
  }, [displayScale])
  return jsxs('div', {style:{width:'100%',height:'100%',minHeight:0,position:'relative'}, children:[
    jsx(SandboxedFrame, { ref:frame, src:frameUrl, title:'紅莉栖 · SpriteForge', sandbox:'allow-scripts',
      onLoad:()=>frame.current?.contentWindow.postMessage({type:'amadeus.render.ping'}, '*'),
      style:{width:'100%',height:'100%',border:0,background:'transparent'} }),
    error ? jsx('small', {role:'status',style:{position:'absolute',bottom:4,left:4,right:4,fontSize:10},children:'人物加载：'+error}) : null
  ]})
}
