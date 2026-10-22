import { useBackend } from '../hooks/useBackend'
import { BiliScrollPanel } from './BiliScrollPanel'
import { useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react'

type Payload = Record<string, unknown>
type MemoryNote = { id: string; text: string }
type CharacterSession = { id: string; title: string; message_count: number }
type HermesOwner = { connection_id: string; profile: string; session_id: string }
type HermesContext = {
  identity: () => HermesOwner
  assertCurrent: (owner: HermesOwner) => void
  capture: (owner?: HermesOwner, read?: (owner: HermesOwner) => Promise<Payload>) => Promise<Payload>
  interrupt?: (owner: HermesOwner, turn: string, read: (owner: HermesOwner) => Promise<Payload>) => Promise<Payload>
  submit?: (owner: HermesOwner, text: string) => Promise<Payload>
  installBiliTools?: (config: Payload) => Promise<Payload>
  draft: (owner: HermesOwner) => Promise<string>
  clearDraft: (owner: HermesOwner, text: string) => Promise<boolean>
  subscribe: (listener: () => void) => () => void
}
type ContextSettings = {
  hermes_context_enabled: boolean; proactive_enabled: boolean; do_not_disturb: boolean
  hermes_auto_sync_enabled: boolean
  completion_replies_enabled: boolean
  cooldown_seconds: number; game_text_enabled: boolean; game_screen_enabled: boolean
}
type Props = {
  getConnection: (signal: AbortSignal) => Promise<{ url: string; protocols: string[] }>
  openWallpaper: (connection: Payload) => Promise<void>
  qrImage?: (url: string) => Promise<string>
  hermesContext?: HermesContext
  viewStorage?: { get: <T>(key: string, fallback: T) => T; set: (key: string, value: unknown) => void }
  CharacterFrame: ComponentType<{
    subscribe: (method: string, callback: (params: Payload) => void) => () => void
    onReady: () => void
    displayScale?: number
  }>
}

const css = `
[data-amadeus-runtime]{height:100%;width:100%;min-width:0;min-height:0;overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr) auto minmax(44px,auto);color:var(--ui-text-secondary);background:var(--ui-bg-sidebar);font:inherit}
[data-amadeus-runtime] nav{display:flex;flex-wrap:wrap;min-width:0;min-height:30px;align-items:center;justify-content:center;gap:2px 4px;padding:3px 6px;border-bottom:1px solid var(--ui-stroke-tertiary)}
[data-amadeus-runtime] button{border:1px solid transparent;border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:11px;cursor:pointer;padding:3px 5px;transition:background .12s,transform .08s,border-color .12s}
[data-amadeus-runtime] button:hover:not(:disabled){background:var(--ui-bg-hover,rgba(127,127,127,.14));border-color:var(--ui-stroke-tertiary)}
[data-amadeus-runtime] button:active:not(:disabled){transform:translateY(1px) scale(.96);background:var(--ui-bg-active,rgba(127,127,127,.24))}
[data-amadeus-runtime] button:focus-visible{outline:2px solid var(--ui-text-secondary);outline-offset:1px}
[data-amadeus-runtime] button[aria-pressed=true]{background:var(--ui-bg-hover,rgba(127,127,127,.14));border-color:var(--ui-stroke-tertiary)}
[data-amadeus-runtime] button:disabled{opacity:.4;cursor:default}
[data-amadeus-runtime] form{display:flex;min-height:0;border-top:1px solid var(--ui-stroke-tertiary);gap:3px}
[data-amadeus-runtime] textarea{box-sizing:border-box;resize:none;flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:12px;padding:8px}
[data-amadeus-runtime] .runtime-status{max-height:80px;overflow:auto;overflow-wrap:anywhere;background:var(--ui-bg-sidebar);border-top:1px solid var(--ui-stroke-tertiary);padding:6px;font-size:12px}
[data-amadeus-runtime] .menu{position:absolute;top:0;right:0;z-index:3;background:var(--ui-bg-sidebar);padding:8px;border:1px solid var(--ui-stroke-tertiary);display:flex;flex-direction:column}
[data-amadeus-runtime] .runtime-feedback{position:absolute;top:8px;left:8px;right:8px;z-index:4;padding:6px 8px;border-radius:6px;background:var(--ui-bg-sidebar);border:1px solid var(--ui-stroke-tertiary);font-size:12px;text-align:center;pointer-events:none}
[data-amadeus-runtime] .character-panel{position:absolute;inset:8px;z-index:3;overflow:auto;padding:12px;background:var(--ui-bg-sidebar);border:1px solid var(--ui-stroke-tertiary);border-radius:8px;font-size:12px}
[data-amadeus-runtime] .character-panel header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
[data-amadeus-runtime] .character-panel p{line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}
[data-amadeus-runtime] .character-panel textarea{width:100%;min-height:80px;border:1px solid var(--ui-stroke-tertiary);border-radius:5px;margin-top:8px}
[data-amadeus-runtime] .character-panel article{padding:8px 0;border-bottom:1px solid var(--ui-stroke-tertiary)}
[data-amadeus-runtime] .character-panel .session-choice{display:block;width:100%;text-align:left;padding:9px 5px}
[data-amadeus-runtime] form button[title="移除图片"]{max-width:28%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`

export function HermesRuntimePane({ getConnection, CharacterFrame, openWallpaper, hermesContext, viewStorage, qrImage }: Props) {
  const { send, subscribe, connected } = useBackend(getConnection)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [displayScale, setDisplayScale] = useState(0.9)
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [pendingAction, setPendingAction] = useState('')
  const [panel, setPanel] = useState<'memory' | 'sessions' | 'context' | 'bili' | null>(null)
  const [panelBusy, setPanelBusy] = useState(false)
  const [notes, setNotes] = useState<MemoryNote[]>([])
  const [memoryText, setMemoryText] = useState('')
  const [editingMemory, setEditingMemory] = useState('')
  const [mic, setMic] = useState(false)
  const micRequested = useRef(false)
  const [settings, setSettings] = useState<ContextSettings | null>(null)
  const [syncStatus, setSyncStatus] = useState<Payload | null>(null)
  const [contextError, setContextError] = useState('')
  const permittedOwner = useRef<HermesOwner | null>(null)
  const [attachment, setAttachment] = useState<{ name: string; mime: string; dataUrl: string; width: number; height: number; byteLength: number } | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const [sessions, setSessions] = useState<CharacterSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState('')
  const [characterId, setCharacterId] = useState<'kurisu' | 'chiemi' | null>(null)
  const [startup, setStartup] = useState({ state: 'warming', detail: 'Amadeus 正在加载…' })
  const serial = useRef(0)
  const sendChain = useRef(Promise.resolve())
  const turn = useRef('')
  const canChat = connected && startup.state === 'ready' && characterId !== null
  const characterName = characterId === 'chiemi' ? '千枝实' : characterId === 'kurisu' ? '红莉栖' : 'Amadeus'

  useEffect(() => () => {
    // Source-qualified stop leaves VN/wake listening sessions alone.
    if (micRequested.current) void send('asr.stop', { source: 'hermes.fourth-pane' }).catch(() => {})
    permittedOwner.current = null
  }, [send])

  useEffect(() => {
    try {
      const value = viewStorage?.get('character-scale', 0.9)
      if (typeof value === 'number' && value >= 0.6 && value <= 1) setDisplayScale(value)
    } catch (e) {
      setError(`无法读取人物大小：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [viewStorage])
  const changeScale = (value: number) => {
    setDisplayScale(value)
    try {
      viewStorage?.set('character-scale', value)
    } catch (e) {
      setError(`人物大小未保存：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const updateSettings = async (patch: Payload) => {
    const result = await send('companion.context.update', patch)
    setSettings(result as ContextSettings)
    return result
  }
  const captureContext = useCallback((owner: HermesOwner) => hermesContext!.capture(owner,
    source => send('companion.context.read', { owner: source })), [hermesContext, send])
  const revokeContext = async () => {
    permittedOwner.current = null
    await updateSettings({ hermes_context_enabled: false, hermes_auto_sync_enabled: false })
  }
  const toggleAutoSync = async (enabled: boolean) => {
    permittedOwner.current = null
    await updateSettings({ hermes_auto_sync_enabled: enabled, hermes_context_enabled: false })
  }
  const authorizeContext = async () => {
    if (!hermesContext) return
    setPendingAction('context'); setError('')
    let granted = false
    try {
      await toggleAutoSync(true)
      granted = true
      const owner = hermesContext.identity()
      const snapshot = await captureContext(owner)
      await send('companion.context.observe', { ...snapshot, source: 'hermes' })
      hermesContext.assertCurrent(owner)
      permittedOwner.current = owner
      setFeedback(snapshot.summary_pending ? '授权已保存，后续会话会持续同步；正在压缩当前会话…' : '授权已保存，本机 Hermes 会话将持续同步')
    } catch (e) {
      setError(`${granted ? '授权已保存；当前会话暂不可读' : '保存授权失败'}：${e instanceof Error ? e.message : String(e)}`)
    } finally { setPendingAction('') }
  }
  useEffect(() => {
    if (!connected || !hermesContext || !settings?.hermes_auto_sync_enabled) { setContextError(''); return }
    let live = true, timer: ReturnType<typeof setTimeout> | undefined
    let reading = false
    const refresh = () => {
      if (!live) return
      let owner: HermesOwner
      try {
        owner = hermesContext.identity()
        permittedOwner.current = owner
      } catch {
        permittedOwner.current = null
        return
      }
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!owner || reading) return
        reading = true
        void captureContext(owner).then(snapshot => {
          if (live) return send('companion.context.observe', { ...snapshot, source: 'hermes' })
        }).then(() => { if (live) setContextError('') })
          .catch(e => { if (live) setContextError(`Hermes 上下文未更新：${e.message}`) }).finally(() => { reading = false })
      }, 350)
    }
    const unsubscribe = hermesContext.subscribe(refresh)
    const poll = setInterval(refresh, 5000)
    refresh()
    return () => { live = false; clearTimeout(timer); clearInterval(poll); unsubscribe() }
  }, [connected, hermesContext, settings?.hermes_auto_sync_enabled, send, captureContext])

  useEffect(() => {
    if (!connected || panel !== 'context') return
    let live = true
    const refresh = () => { void send('companion.sync.status', {}).then(p => { if (live) setSyncStatus(p) }).catch(e => { if (live) setError(e.message) }) }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => { live = false; clearInterval(timer) }
  }, [connected, panel, send])

  const switchCharacter = async (target?: 'kurisu' | 'chiemi') => {
    if (!characterId) return
    if (pendingAction === 'character' || startup.state === 'warming' || busy) return
    const next = target || (characterId === 'chiemi' ? 'kurisu' : 'chiemi')
    const nextName = next === 'chiemi' ? '芹沢千枝实' : '牧瀬红莉栖'
    setFeedback(`正在切换角色至 ${nextName}…`)
    setPendingAction('character')
    setError('')
    try {
      await send('character.switch', { character_id: next })
      setCharacterId(next)
      setFeedback(`已切换至角色：${nextName}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setFeedback('')
    } finally {
      setPendingAction('')
    }
  }
  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(''), 3000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const applyVoiceStatus = useCallback((p: Payload) => {
    if (typeof p.muted === 'boolean') setMuted(p.muted)
    const value = p.startup as { state?: string; detail?: string } | undefined
    if (value?.state) setStartup({ state: value.state, detail: value.detail || 'Amadeus 正在加载…' })
  }, [])
  const ready = useCallback(() => {
    if (connected) void send('render.ready', {}).catch(e => setError(e.message))
  }, [connected, send])

  useEffect(() => {
    const stops = [
      subscribe('tts.status', applyVoiceStatus),
      subscribe('companion.context.changed', p => {
        setSettings(p as ContextSettings)
        if (!p.hermes_auto_sync_enabled) permittedOwner.current = null
      }),
      subscribe('companion.observer.error', p => setError(String(p.message || '主动互动暂不可用'))),
      subscribe('companion.completion.status', p => {
        if (p.status === 'takeover_requested') {
          const eventId = String(p.event_id || '')
          setFeedback('Amadeus 准备接话，正在停止当前 Hermes 回复…')
          void (async () => {
            try {
              if (!settings?.hermes_auto_sync_enabled || !settings.proactive_enabled || settings.do_not_disturb || !hermesContext?.interrupt) throw new Error('当前接话未授权或处于勿扰模式')
              const owner = p.owner as HermesOwner
              const receipt = await hermesContext.interrupt(owner, String(p.user_turn),
                source => send('companion.context.read', { owner: source }))
              await send('companion.context.takeover', { event_id: eventId, status: receipt.status })
            } catch (e) {
              setError(`接话未完成：${e instanceof Error ? e.message : String(e)}`)
              await send('companion.context.takeover', { event_id: eventId, status: 'rejected' }).catch(() => {})
            }
          })()
        }
        if (p.status === 'queued') setFeedback('已收到 Hermes 结束回复的通知，等待 Amadeus 空闲…')
        if (p.status === 'responding') setFeedback('Hermes 已回复，Amadeus 正在形成自己的回应…')
        if (p.status === 'accepted') setFeedback(`${characterName}：${String(p.display_text || '')}`)
        if (p.status === 'error') setError('Amadeus 接话失败，可在第四栏直接询问；没有代替 Hermes 编造结果。')
      }),
      subscribe('chat.complete', p => { if (p.turn_id === turn.current) setBusy(false) }),
      subscribe('chat.error', p => {
        if (p.turn_id === turn.current) { setError(String(p.error)); setBusy(false) }
      }),
      subscribe('chat.interrupted', p => { if (p.turn_id === turn.current) setBusy(false) }),
      subscribe('asr.status', p => {
        if (p.source !== 'hermes.fourth-pane' && p.status !== 'idle') return
        if (p.status === 'listening') setMic(true)
        if (p.status === 'idle' || p.status === 'error') { setMic(false); micRequested.current = false }
        if (p.status === 'error') setError(String(p.error || '麦克风识别失败'))
      }),
      subscribe('asr.recognized', p => {
        if (p.source === 'hermes.fourth-pane' && p.is_final && p.text) {
          setText(previous => [previous, p.text].filter(Boolean).join(' ')); setMic(false)
          micRequested.current = false
          setFeedback('已识别语音，请确认后发送')
        }
      }),
      subscribe('character.changed', p => {
        if (p?.character_id === 'chiemi' || p?.character_id === 'kurisu') {
          setCharacterId(p.character_id as 'kurisu' | 'chiemi')
          ++serial.current; turn.current = ''; setBusy(false)
          setPanel(null); setNotes([]); setEditingMemory(''); setAttachment(null)
        }
      }),
    ]
    return () => stops.forEach(stop => stop())
  }, [subscribe, applyVoiceStatus, characterName, hermesContext, send, settings?.hermes_auto_sync_enabled, settings?.proactive_enabled, settings?.do_not_disturb])

  useEffect(() => {
    if (!connected) {
      ++serial.current
      turn.current = ''
      setBusy(false)
      setCharacterId(null)
      setMic(false); permittedOwner.current = null
      setStartup({ state: 'warming', detail: 'Amadeus 正在加载…' })
      return
    }
    let active = true
    setError('')
    void send('tts.status', {}).then(p => { if (active) applyVoiceStatus(p) }).catch(e => {
      if (active) setStartup({ state: 'error', detail: `无法获取语音加载状态：${e.message}` })
    })
    void send('character.get', {}).then(p => {
      if (active && (p?.character_id === 'chiemi' || p?.character_id === 'kurisu')) {
        setCharacterId(p.character_id as 'kurisu' | 'chiemi')
      } else if (active) {
        throw new Error('后端未确认当前角色')
      }
    }).catch(e => { if (active) setError(`无法确认角色：${e.message}`) })
    void send('companion.context.get', {}).then(p => { if (active) setSettings(p as ContextSettings) })
      .catch(e => { if (active) setError(`无法读取隐私设置：${e.message}`) })
    void send('render.start', {}).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [connected, send, applyVoiceStatus])

  const command = (page: string, section = '') => {
    setMenu(false)
    setError('')
    const label = ({ vn: 'VN Player', wallpaper: '壁纸应用', settings: section === 'voice' ? '语音设置' : 'Amadeus 设置',
      expressions: '表情测试', backend: '运行状态' } as Record<string, string>)[page]
    setFeedback(`正在打开${label}…`)
    setPendingAction(page)
    void send('desktop.navigate', { page, section }).catch(e => { setFeedback(''); setError(e.message) })
      .finally(() => setPendingAction(''))
  }
  const openPanel = async (target: 'memory' | 'sessions' | 'context') => {
    setMenu(false); setPanel(target); setPanelBusy(true); setError('')
    try {
      const result = await send(target === 'memory' ? 'character.memory.list' : target === 'context' ? 'companion.context.get' : 'session.list', {})
      if (target === 'memory') setNotes((result.notes || []) as MemoryNote[])
      else if (target === 'context') setSettings(result as ContextSettings)
      else {
        setSessions((result.sessions || []) as CharacterSession[])
        setCurrentSessionId(String(result.current_session_id || ''))
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setPanelBusy(false) }
  }
  const updateMemory = async (method: string, params: Payload) => {
    setPanelBusy(true); setError('')
    try {
      const result = await send(method, params)
      const updated = method === 'character.memory.share'
        ? await send('character.memory.list', { character_id: characterId }) : result
      setNotes((updated.notes || []) as MemoryNote[])
      if (method !== 'character.memory.forget') { setMemoryText(''); setEditingMemory('') }
      setFeedback(method === 'character.memory.remember' ? '已保存重要记忆' : method === 'character.memory.update' ? '已更正这条记忆'
        : method === 'character.memory.share' ? '已分享，原始来源与参与者保持独立' : '已忘记这条记忆')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setPanelBusy(false) }
  }
  const loadSession = async (id: string) => {
    setPanelBusy(true); setError('')
    try {
      const result = await send('session.load', { session_id: id })
      setCurrentSessionId(String(result.current_session_id || id)); setPanel(null); setFeedback('已恢复这段会话')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setPanelBusy(false) }
  }
  const newSession = async () => {
    setMenu(false)
    try {
      await stop()
      const result = await send('session.create', { title: `Hermes × ${characterName}` })
      setCurrentSessionId(String(result.current_session_id || (result.session as Payload | undefined)?.id || ''))
      setFeedback('已创建新会话，重要记忆仍保留')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const wallpaper = async () => {
    setMenu(false); setError(''); setPendingAction('wallpaper'); setFeedback('正在打开壁纸应用…')
    try {
      const connection = await send('wallpaper.start', { slice_host: 'wallpaper' })
      if (connection.status === 'error') throw new Error(String(connection.error || '壁纸连接启动失败'))
      await openWallpaper(connection)
      setFeedback('Lively 已打开，Amadeus 壁纸连接已启动')
    } catch (e) {
      setFeedback(''); setError(e instanceof Error ? e.message : String(e))
    } finally { setPendingAction('') }
  }
  const queueInput = (input: string, owner?: HermesOwner) => {
    const selectedCharacter = characterId
    const selectedImage = attachment
    setText(''); setError(''); setBusy(true)
    const request = ++serial.current
    const accepted = sendChain.current.catch(() => {}).then(async () => {
      if (request !== serial.current) return
      await send('chat.abort', {})
      await send('tts.interrupt', { source: 'hermes.fourth-pane.new_input' })
      if (request !== serial.current) return
      const active = await send('session.list', {})
      let sessionId = String(active.current_session_id || '')
      if (!sessionId) {
        const result = await send('session.create', { title: `Hermes × ${characterName}` })
        sessionId = String((result.session as Payload | undefined)?.id || result.current_session_id || result.session_id || '')
      }
      if (request !== serial.current) return
      if (owner) hermesContext?.assertCurrent(owner)
      setCurrentSessionId(sessionId)
      turn.current = crypto.randomUUID()
      await send('chat.send', { text: input, turn_id: turn.current,
        session_id: sessionId, character_id: selectedCharacter, source: 'hermes.fourth-pane',
        ...(owner ? { hermes_owner: owner } : {}),
        ...(selectedImage ? { visual: { request: true, mode: 'attachment', scope: 'user_image', source: 'user_image',
          attachment: { name: selectedImage.name, byteLength: selectedImage.byteLength },
          frame: { mime: selectedImage.mime, dataUrl: selectedImage.dataUrl, width: selectedImage.width,
            height: selectedImage.height, byteLength: selectedImage.byteLength } } } : {}),
      })
      if (request === serial.current) setAttachment(null)
      return true
    })
    sendChain.current = accepted.then(() => {}).catch(e => {
      if (request === serial.current) { setError(e.message); setText(previous => previous || input); setBusy(false) }
    })
    return accepted
  }
  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if ((!text.trim() && !attachment) || !canChat) return
    const owner = permittedOwner.current
    try { if (owner) hermesContext?.assertCurrent(owner) } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); return
    }
    void queueInput(text.trim() || '请看这张图片。', owner || undefined).catch(() => {})
  }
  const handoffDraft = async () => {
    if (!hermesContext || !canChat || busy) return
    setPendingAction('handoff'); setError('')
    try {
      const owner = hermesContext.identity()
      const input = await hermesContext.draft(owner)
      if (!settings?.hermes_auto_sync_enabled) await toggleAutoSync(true)
      const snapshot = await captureContext(owner)
      await send('companion.context.observe', { ...snapshot, source: 'hermes' })
      if (snapshot.summary_pending) throw new Error('当前会话仍在用免费模型压缩，请等摘要同步完成后再交接草稿')
      hermesContext.assertCurrent(owner)
      permittedOwner.current = owner
      if (await queueInput(input, owner)) {
        const cleared = await hermesContext.clearDraft(owner, input)
        setFeedback(cleared ? '当前草稿已交给 Amadeus，Hermes 会话记录保留' : '已交给 Amadeus；Hermes 草稿有变化，已保留')
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setPendingAction('') }
  }
  const handoffToHermes = async () => {
    if (!hermesContext?.submit || !text.trim() || attachment) return
    setPendingAction('hermes-tools'); setError('')
    try {
      const input = text.trim()
      const owner = hermesContext.identity()
      await hermesContext.submit(owner, input)
      setText(previous => previous.trim() === input ? '' : previous)
      setFeedback('请求已交给当前 Hermes；工具与权限由 Hermes 处理，结果会同步给 Amadeus')
      setMenu(false)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setPendingAction('') }
  }
  const toggleMic = async () => {
    const previous = mic
    micRequested.current = !previous
    setMic(!previous); setPendingAction('mic'); setFeedback(previous ? '正在关闭麦克风…' : '正在加载麦克风识别…')
    try {
      const result = await send(previous ? 'asr.stop' : 'asr.start', { source: 'hermes.fourth-pane', one_shot: true })
      if (!(previous ? result.status === 'stopped' : result.status === 'listening' || result.status === 'awake')) {
        throw new Error(String(result.error || '麦克风正由其他页面使用，请先关闭原监听'))
      }
      setMic(!previous); setFeedback(previous ? '麦克风已关闭' : '麦克风已开启；识别后填入输入框，确认后发送')
    } catch (e) {
      if (!previous) await send('asr.stop', { source: 'hermes.fourth-pane' }).catch(() => {})
      micRequested.current = previous; setMic(previous); setFeedback(''); setError(e instanceof Error ? e.message : String(e))
    }
    finally { setPendingAction('') }
  }
  const attachImage = async (file?: File) => {
    if (!file) return
    try {
      if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) throw new Error('请选择 10 MB 以内的图片')
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file)
      })
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = dataUrl
      })
      const ratio = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight, 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
      const context = canvas.getContext('2d'); if (!context) throw new Error('无法处理图片')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const normalized = canvas.toDataURL('image/jpeg', 0.82)
      setAttachment({ name: file.name, mime: 'image/jpeg', dataUrl: normalized, width: canvas.width, height: canvas.height, byteLength: Math.floor(normalized.split(',')[1].length * 3 / 4) })
      setFeedback('图片已附加，发送后由当前视觉配置处理')
    } catch (e) { setError(e instanceof Error ? e.message : '图片读取失败') }
  }
  const stop = async () => {
    ++serial.current
    turn.current = ''
    setBusy(false)
    const results = await Promise.allSettled([
      send('chat.abort', {}), send('tts.interrupt', { source: 'hermes.fourth-pane' }),
    ])
    const failure = results.find(r => r.status === 'rejected')
    if (failure?.status === 'rejected') setError(String(failure.reason?.message || failure.reason))
    else setFeedback('已停止回复和语音')
  }
  const stopping = busy && !text.trim() && !attachment
  const status = !connected ? 'Amadeus 正在加载…正在连接后端'
    : characterId === null ? 'Amadeus 正在加载…正在确认角色' : startup.detail
  return <section data-amadeus-runtime="" aria-label="Amadeus · 独立对话">
    <style>{css}</style>
    <nav>
      <button disabled={!connected || pendingAction === 'vn'} title="打开 VN Player 窗口" onClick={() => command('vn')}>VN</button>
      <button disabled={pendingAction === 'wallpaper'} title="打开 Lively Wallpaper" onClick={() => { void wallpaper() }}>壁纸</button>
      <button disabled={!connected || pendingAction === 'voice'} aria-pressed={!muted} aria-busy={pendingAction === 'voice'} title={muted ? '语音已关闭，点击开启' : '语音已开启，点击关闭'} onClick={() => {
        const previous = muted, next = !muted
        setMuted(next); setFeedback(next ? '正在关闭语音…' : '正在开启语音…')
        setPendingAction('voice'); setError('')
        void send('tts.set_muted', { muted: next }).then(p => {
          applyVoiceStatus(p); setFeedback(p.muted ? '语音已关闭' : '语音已开启')
        }).catch(e => { setMuted(previous); setFeedback(''); setError(e.message) }).finally(() => setPendingAction(''))
      }}>{muted ? '语音关' : '语音开'}</button>
      <button disabled={!connected || !characterId || pendingAction === 'character' || startup.state === 'warming' || busy} aria-busy={pendingAction === 'character'} title={`当前角色：${characterName}，点击切换为${characterId === 'chiemi' ? '红莉栖' : '千枝实'}`} onClick={() => { void switchCharacter() }}>{pendingAction === 'character' ? '切换中…' : !characterId ? '确认角色…' : (characterId === 'chiemi' ? '切为红莉栖' : '切为千枝实')}</button>
      <button aria-expanded={menu} onClick={() => setMenu(!menu)}>更多</button>
    </nav>
    <div style={{ position: 'relative', minHeight: 0, overflow: 'hidden' }}>
      <CharacterFrame key={characterId} subscribe={subscribe} onReady={ready} displayScale={displayScale} />
      {feedback && <div className="runtime-feedback" role="status" aria-live="polite">{feedback}</div>}
      {menu && <div className="menu">
        <label style={{ display: 'grid', gap: 5, padding: '6px 5px', fontSize: 11 }}>
          人物大小 {Math.round(displayScale * 100)}%
          <input aria-label="人物大小" type="range" min="0.6" max="1" step="0.05" value={displayScale}
            style={{ width: 130 }} onChange={e => changeScale(Number(e.target.value))} />
        </label>
        <button onClick={() => changeScale(0.9)}>恢复合适大小</button>
        <button disabled={!connected || pendingAction === 'character' || startup.state === 'warming' || busy} onClick={() => { void switchCharacter(); setMenu(false) }}>切换角色：{characterId === 'chiemi' ? '红莉栖' : '千枝实'}</button>
        <button disabled={!connected} onClick={() => { void openPanel('memory') }}>重要记忆</button>
        <button disabled={!connected} onClick={() => { void openPanel('context') }}>协同与隐私</button>
        <button disabled={!connected || !characterId} onClick={() => { setMenu(false); setPanel('bili') }}>刷B站</button>
        <button disabled={!connected || !hermesContext?.submit || !text.trim() || Boolean(attachment) || pendingAction === 'hermes-tools'} onClick={() => { void handoffToHermes() }}>交给 Hermes 工具处理</button>
        <button disabled={!connected || pendingAction === 'mic'} aria-pressed={mic} aria-busy={pendingAction === 'mic'} onClick={() => { void toggleMic() }}>{mic ? '关闭麦克风' : '开启麦克风'}</button>
        <button disabled={!canChat} onClick={() => { setMenu(false); imageInput.current?.click() }}>附加图片</button>
        <button disabled={!connected || busy} onClick={() => { void openPanel('sessions') }}>历史会话</button>
        <button disabled={!connected} onClick={() => command('settings')}>Amadeus 设置</button>
        <button disabled={!connected} onClick={() => command('settings', 'voice')}>语音设置</button>
        <button disabled={!connected} onClick={() => command('expressions')}>表情测试</button>
        <button disabled={!connected} onClick={() => command('backend')}>运行状态</button>
        <button disabled={!connected || busy} onClick={() => { void newSession() }}>新对话</button>
        <button disabled={!connected} onClick={() => { void stop(); setMenu(false) }}>停止说话</button>
      </div>}
      {panel === 'bili' && characterId && <BiliScrollPanel key={characterId} send={send} characterId={characterId} close={() => setPanel(null)} qrImage={qrImage}
        installTools={hermesContext?.installBiliTools}
        share={hermesContext?.submit ? async report => { await hermesContext.submit!(hermesContext.identity(), report) } : undefined} />}
      {panel && panel !== 'bili' && <section className="character-panel" role="dialog" aria-label={panel === 'memory' ? 'Amadeus 重要记忆' : panel === 'context' ? 'Amadeus 协同与隐私' : 'Amadeus 历史会话'} aria-busy={panelBusy}>
        <header><strong>{panel === 'memory' ? '重要记忆' : panel === 'context' ? '协同与隐私' : '历史会话'}</strong><button onClick={() => setPanel(null)}>关闭</button></header>
        {panel === 'memory' ? <>
          <p>你确认的重要信息会独立保存，新会话和更换模型都不会清空。聊天经历从会话存档按需回忆。</p>
          {notes.map(note => <article key={note.id}><p>{note.text}</p><button disabled={panelBusy} onClick={() => { setEditingMemory(note.id); setMemoryText(note.text) }}>更正这条</button><button disabled={panelBusy} onClick={() => { void updateMemory('character.memory.forget', { id: note.id, character_id: characterId }) }}>忘记这条</button><button disabled={panelBusy || !characterId} onClick={() => { void updateMemory('character.memory.share', { id: note.id, character_id: characterId, known_to: [characterId, characterId === 'chiemi' ? 'kurisu' : 'chiemi'] }) }}>分享给另一位</button></article>)}
          {!notes.length && !panelBusy && <p>还没有保存的重要记忆。</p>}
          <textarea aria-label="添加重要记忆" placeholder="希望 Amadeus 长期记住的事情…" maxLength={2000} value={memoryText} onChange={e => setMemoryText(e.target.value)} />
          <button disabled={panelBusy || !memoryText.trim()} onClick={() => { void updateMemory(editingMemory ? 'character.memory.update' : 'character.memory.remember', { text: memoryText.trim(), character_id: characterId, ...(editingMemory ? { id: editingMemory } : {}) }) }}>{editingMemory ? '保存更正' : '记住'}</button>
          {editingMemory && <button onClick={() => { setEditingMemory(''); setMemoryText('') }}>取消更正</button>}
        </> : panel === 'context' ? <>
          {contextError && <p role="alert">{contextError}</p>}
          <p>自动同步读取本机 Hermes 各会话的可见文字和工具结果，通过 OpenRouter 免费模型增量压缩；只保存带来源的摘要。不会读取隐藏推理、其他应用或远程 Hermes。授权一次后持续同步，切换会话、角色或重启都不会撤销；只有主动关闭同步或撤销授权才停止。</p>
          <button disabled={!hermesContext || pendingAction === 'context'} onClick={() => { void (settings?.hermes_auto_sync_enabled ? revokeContext() : authorizeContext()).catch(e => setError(e.message)) }}>{settings?.hermes_auto_sync_enabled ? '撤销 Hermes 读取授权' : '授权本机 Hermes 并持续同步'}</button>
          <p>{settings?.hermes_auto_sync_enabled ? '已授权：本机 Hermes 全部会话' : '尚未授权本机 Hermes'}</p>
          <label><input type="checkbox" checked={settings?.hermes_auto_sync_enabled ?? false} onChange={e => { void toggleAutoSync(e.target.checked).catch(error => setError(error.message)) }} />自动同步本机 Hermes 会话</label>
          <button disabled={!settings?.hermes_auto_sync_enabled} onClick={() => { setFeedback('已请求同步本机 Hermes…'); void send('companion.sync.now', {}).then(setSyncStatus).catch(e => setError(e.message)) }}>立即同步 / 重试</button>
          {syncStatus && <p role="status">{String(({ idle: '等待同步', syncing: '正在同步', ready: '同步完成', error: '同步失败，已暂停', paused: '已暂停', disabled: '自动同步关闭' } as Record<string,string>)[String(syncStatus.state)] || '等待同步')} · {Number(syncStatus.complete || 0)}/{Number(syncStatus.total || 0)} 个会话 · 已存 {Number(syncStatus.summaries || 0)} 份摘要{syncStatus.current_total_segments ? `\n当前会话：${syncStatus.current_segments}/${syncStatus.current_total_segments} 段` : ''}{'\n'}模型：{String(syncStatus.model || '')}（仅免费，无收费回退）{syncStatus.error ? `\n${syncStatus.error}` : ''}</p>}
          <button disabled={!hermesContext || !canChat || busy || Boolean(attachment) || pendingAction === 'handoff'} onClick={() => { void handoffDraft() }}>当前 Hermes 草稿交给 Amadeus</button>
          <p>这个按钮会将当前输入框的文字交给 Amadeus 单独回答，并保留 Hermes 原会话。网址可直接粘贴到聊天框；不会自动打开或抓取网页。</p>
          {settings && <>
            {([
              ['proactive_enabled', '允许主动搭话'], ['do_not_disturb', '勿扰模式'],
              ['completion_replies_enabled', 'Hermes 本轮结束后，Amadeus 单独回应'],
              ['game_text_enabled', '允许游戏文本'], ['game_screen_enabled', '允许请求游戏画面'],
            ] as const).map(([key, label]) => <label key={key} style={{ display: 'block', padding: '8px 0' }}><input type="checkbox" checked={Boolean(settings[key])} onChange={e => { void updateSettings({ [key]: e.target.checked }).catch(error => setError(error.message)) }} /> {label}</label>)}
            <label>主动发言最短间隔（秒） <input aria-label="主动发言最短间隔" type="number" min="0" max="86400" value={settings.cooldown_seconds ?? 45} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) void updateSettings({ cooldown_seconds: value }).catch(error => setError(error.message)) }} /></label>
            <p>游戏权限只影响已经选定的游戏输入。主动搭话仍受冷却、去重与勿扰限制。麦克风需单独手动开启。</p>
            <p>接话判断使用 DeepSeek 直连 Flash：明确要求 Amadeus 回答时先停止当前 Hermes 回复再接话；其他消息等待 Hermes 处理，结束后简短补充。会话压缩仍使用上方的 OpenRouter 免费模型。</p>
            <p>Hermes 聊天中的“你”和工作追问默认指 Hermes。需要读取、执行或验证的问题不接管。接话偏好沿用当前 Hermes 的原生用户画像；在 Hermes 中说明并让它记住即可，不另建画像。</p>
            <p>完工回应与日常主动搭话分别控制：Hermes 保留自己的结果，Amadeus 等空闲后独立回应；勿扰期间等待，撤销授权后取消。</p>
          </>}
        </> : <>
          {sessions.map(item => <button className="session-choice" key={item.id} aria-pressed={item.id === currentSessionId} disabled={panelBusy || busy} onClick={() => { void loadSession(item.id) }}>{item.title} · {item.message_count} 条</button>)}
          {!sessions.length && !panelBusy && <p>还没有历史会话。</p>}
        </>}
      </section>}
    </div>
    <div>
      {(error || startup.state === 'error') && <div className="runtime-status" role="alert">
        {error || status}
        {error && <button type="button" aria-label="关闭提示" onClick={() => setError('')}>关闭</button>}
      </div>}
    </div>
    <form onSubmit={submit} aria-busy={!canChat}>
      <input ref={imageInput} type="file" accept="image/*" hidden aria-label="选择聊天图片" onChange={e => { void attachImage(e.target.files?.[0]); e.target.value = '' }} />
      {attachment && <button type="button" title="移除图片" onClick={() => setAttachment(null)}>图片：{attachment.name} ×</button>}
      <textarea aria-label={`和${characterName}聊天`} placeholder={canChat ? `和${characterName}聊天…` : status}
        disabled={!canChat} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
        }} />
      <button type={stopping ? 'button' : 'submit'} disabled={!connected || (!stopping && (!canChat || (!text.trim() && !attachment)))}
        onClick={stopping ? stop : undefined} title={stopping ? '停止回复和语音' : '发送消息'}>{stopping ? '停止' : '发送'}</button>
    </form>
  </section>
}
