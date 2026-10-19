import { host } from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import QRCode from 'qrcode'
import { HermesRuntimePane } from '../../electron/src/renderer/components/HermesRuntimePane.tsx'
import { LocalSpriteForgeFrame } from './local-character.mjs'
import { createHermesContext } from './hermes-context.mjs'
import { installedConnection, normalizeRoot } from './connection.mjs'

const ID = 'amadeus-fourth-pane-prototype' // Preserve existing pane/storage identity.

function Configuration({ storage, onSaved }) {
  const [root, setRoot] = useState(storage.get('amadeusRoot', ''))
  const [autoStart, setAutoStart] = useState(storage.get('autoStart', false))
  const [message, setMessage] = useState('')
  return jsxs('form', { style: { padding: 16, display: 'grid', gap: 12 }, onSubmit: event => {
    event.preventDefault()
    try {
      const path = normalizeRoot(root)
      storage.set('amadeusRoot', path)
      storage.set('autoStart', autoStart)
      setMessage('已保存')
      onSaved?.({ root: path, autoStart })
    } catch (error) { setMessage(error.message) }
  }, children: [
    jsx('strong', { children: 'Amadeus · 本地连接' }),
    jsx('label', { children: ['Amadeus 安装目录', jsx('input', {
      'aria-label': 'Amadeus 安装目录', value: root, onChange: e => setRoot(e.target.value),
      placeholder: '选择你自己的 Amadeus 项目目录', style: { width: '100%', boxSizing: 'border-box' },
    })] }),
    jsxs('label', { children: [jsx('input', { type: 'checkbox', checked: autoStart,
      onChange: e => setAutoStart(e.target.checked) }), '打开第四栏时启动已配置的 Amadeus 启动器'] }),
    jsx('small', { children: '需要已安装兼容的 Amadeus 后端和自行获得授权的角色素材。启动器须由本地 Amadeus 安装配置；插件不会安装模型或收集密钥。' }),
    jsx('button', { type: 'submit', children: '保存并连接' }),
    jsx('span', { role: 'status', children: message }),
  ] })
}

function CharacterPane({ storage, hermesContext }) {
  const [config, setConfig] = useState(() => ({ root: storage.get('amadeusRoot', ''), autoStart: storage.get('autoStart', false) }))
  const [editing, setEditing] = useState(!config.root)
  const getConnection = useMemo(() => signal => installedConnection(config.root, config.autoStart, signal), [config.root, config.autoStart])
  const CharacterFrame = useMemo(() => props => jsx(LocalSpriteForgeFrame, { ...props, root: config.root }), [config.root])
  return jsxs('section', { style: { height: '100%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }, children: [
    jsx('button', { type: 'button', onClick: () => setEditing(!editing), children: editing ? '连接设置' : '连接设置…' }),
    editing ? jsx(Configuration, { storage, onSaved: next => { setConfig(next); setEditing(false) } }) :
      jsx('div', { style: { flex: 1, minHeight: 0 }, children: jsx(HermesRuntimePane, {
        getConnection, CharacterFrame, hermesContext, viewStorage: storage,
        qrImage: url => QRCode.toDataURL(url, { width: 220, margin: 2, errorCorrectionLevel: 'M' }),
        // Public package does not terminate or replace a user's other wallpaper application.
        // The existing backend wallpaper.start action owns any configured wallpaper integration.
      }) }),
  ] })
}

export default {
  id: ID, name: 'Amadeus · 第四栏', defaultEnabled: true,
  description: '本地 Amadeus 多角色对话、字幕、语音和 Hermes 协同（预览版，需独立后端）。',
  register(ctx) {
    const hermesContext = createHermesContext(host)
    ctx.register({ id: 'character', area: 'panes', title: 'Amadeus', data: {
      placement: 'right', collapsible: false, lifecycleKeepAlive: true, hideOnly: true,
      dock: { pane: 'files', pos: 'right', enforce: true }, width: '260px', minWidth: '160px', maxWidth: '1400px',
    }, render: () => jsx(CharacterPane, { storage: ctx.storage, hermesContext }) })
    ctx.registerSettingsPage?.({ id: 'connection', title: 'Amadeus', render: () => jsx(Configuration, { storage: ctx.storage }) })
    host.undismissPane?.(ID + ':character')
  },
}
