// Only the focused, connection-qualified chat is readable. Never fall back to
// the gateway's active profile: another tile may own an identical session id.
export function createHermesContext(host) {
  let observedOwner = '', lastAssistant = '', completedTurn = '', completionSignal = false, lastUser = null, userTurn = ''
  const identity = () => {
    const owner = host?.state?.focusedSessionOwner?.get()
    const session = host?.state?.focusedStoredSessionId?.get()
    if (!owner?.connectionId || !owner.profile || !session) throw new Error('当前 Hermes 会话归属尚未确定')
    return { connection_id: owner.connectionId, profile: owner.profile, session_id: session }
  }
  const same = (a, b) => ['connection_id', 'profile', 'session_id'].every(key => a[key] === b[key])
  const assertCurrent = owner => {
    if (!same(owner, identity())) throw new Error('Hermes 会话已切换，正在读取新会话')
  }
  const capture = async (owner = identity(), read) => {
    assertCurrent(owner)
    const routes = await host.profileRoutes()
    assertCurrent(owner)
    const matches = routes.filter(route => route.connectionId === owner.connection_id && route.profile === owner.profile)
    if (matches.length !== 1) throw new Error('当前 Hermes 会话来源不唯一，未读取聊天')
    if (owner.connection_id !== 'local') throw new Error('目前仅授权本机 Hermes，未读取远程会话')
    if (typeof read !== 'function') throw new Error('本机会话读取服务未连接')
    // Stored IDs belong to the durable database, not the runtime-only
    // session.history RPC. The consented Amadeus Host reads local storage.
    const response = await read(owner)
    assertCurrent(owner)
    // Neither the shared content nor the completion fingerprint includes reasoning.
    const visibleText = item => typeof item.text === 'string' ? item.text : typeof item.content === 'string' ? item.content : Array.isArray(item.content)
        ? item.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : ''
    const messages = (Array.isArray(response?.messages) ? response.messages : []).slice(-30).flatMap(item => {
      if (!['user', 'assistant', 'tool'].includes(item.role)) return []
      const content = visibleText(item)
      return content.trim() ? [{ role: item.role, content: content.slice(0, 2000) }] : []
    })
    const busy = Boolean(host.state.busy.get())
    const ownerKey = JSON.stringify(owner)
    const replyText = (response.messages || []).filter(m => m.role === 'assistant').map(visibleText).join('\n')
    const signature = response.last_reply_id > (response.last_user_id ?? -1)
      ? JSON.stringify([response.last_reply_id, response.last_user_id, replyText]) : ''
    if (observedOwner !== ownerKey) {
      observedOwner = ownerKey; lastAssistant = signature; completedTurn = ''; completionSignal = false
      lastUser = response.last_user_id
      userTurn = lastUser != null && lastUser > (response.last_reply_id ?? -1) ? `user-${lastUser}` : ''
    } else if (response.last_user_id != null && response.last_user_id !== lastUser) {
      lastUser = response.last_user_id; userTurn = `user-${lastUser}`; completedTurn = ''
    } else if (!busy && completionSignal && signature && signature !== lastAssistant) {
      // The event only triggers a read. The reply/identity comes from this
      // explicitly authorized source's own durable history, never event text.
      let hash = 2166136261
      for (const char of signature) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
      completedTurn = `reply-${response.last_reply_id}-${hash >>> 0}`
      lastAssistant = signature; completionSignal = false
    }
    if (busy) completedTurn = ''
    return { owner, messages, summary_pending: !response.summary_complete, work_state: { busy,
      ...(userTurn ? { user_turn: userTurn } : {}), ...(completedTurn ? { completed_turn: completedTurn } : {}) } }
  }
  return {
    identity, assertCurrent, capture,
    async installBiliTools(spec) {
      const owner = identity()
      if (owner.connection_id !== 'local') throw new Error('仅支持本机 Hermes 工具接入')
      if (host.state.busy.get()) throw new Error('请等 Hermes 当前回复结束后再接入工具')
      if (spec?.name !== 'amadeus_bili_scroll' || typeof spec?.config?.command !== 'string') throw new Error('无效 B站工具配置')
      const routes = await host.profileRoutes()
      assertCurrent(owner)
      const matches = routes.filter(r => r.connectionId === owner.connection_id && r.profile === owner.profile)
      if (matches.length !== 1) throw new Error('当前 Hermes 来源不唯一')
      const listed = await host.requestProfile(matches[0], 'mcp.servers.list', {})
      assertCurrent(owner)
      if ((listed?.servers || []).some(s => s.name === spec.name)) return { existing: true }
      const added = await host.requestProfile(matches[0], 'mcp.servers.add', { name: spec.name, config: spec.config }, 30000)
      if (!added?.ok) throw new Error('Hermes 未接受 B站 MCP 配置，未覆盖任何原配置')
      assertCurrent(owner)
      const result = await host.requestProfile(matches[0], 'reload.mcp', { confirm: true, session_id: host.state.focusedSessionId?.get() || '' }, 60000)
      if (result?.status === 'confirm_required' || result?.error) throw new Error('工具已注册，Hermes 工具刷新尚未完成')
      return { accepted: true }
    },
    async interrupt(owner, turn, read) {
      assertCurrent(owner)
      const source = await read(owner)
      assertCurrent(owner)
      if (`user-${source.last_user_id}` !== turn) throw new Error('Hermes 已收到更新的消息，取消旧接话')
      if (!host.state.busy.get()) return { status: 'idle' }
      const routes = await host.profileRoutes()
      assertCurrent(owner)
      const matches = routes.filter(r => r.connectionId === owner.connection_id && r.profile === owner.profile)
      const runtime = host.state.focusedSessionId?.get()
      if (owner.connection_id !== 'local' || matches.length !== 1 || !runtime) throw new Error('无法确认当前 Hermes 运行会话，未发送打断')
      const result = await host.requestProfile(matches[0], 'session.interrupt', { session_id: runtime }, 8000)
      assertCurrent(owner)
      if (result?.status !== 'interrupted') throw new Error('Hermes 未确认打断，Amadeus 暂不接话')
      return { status: 'interrupted' }
    },
    async submit(owner, text) {
      assertCurrent(owner)
      if (owner.connection_id !== 'local') throw new Error('仅支持本机 Hermes 工具协作')
      if (!host.composer.submit(owner.session_id, `[用户从 Amadeus 第四栏转交给 Hermes 处理]\n${text}`)) throw new Error('当前 Hermes 输入界面未接受请求')
      return { status: 'accepted' }
    },
    async draft(owner) {
      assertCurrent(owner)
      const text = await host.composer.getDraft(owner.session_id)
      assertCurrent(owner)
      if (!text?.trim()) throw new Error('当前 Hermes 输入框没有可交接的文字')
      return text
    },
    async clearDraft(owner, previous) {
      assertCurrent(owner)
      if (await host.composer.getDraft(owner.session_id) !== previous) return false
      assertCurrent(owner)
      return host.composer.setDraft(owner.session_id, '')
    },
    subscribe(listener) {
      const stops = ['focusedSessionOwner', 'focusedStoredSessionId', 'busy'].map(key => host.state[key].subscribe(listener))
      // Events only trigger a fresh scoped read; their unscoped payloads are
      // never used as source evidence or permission to observe another chat.
      for (const type of ['message.complete', 'tool.complete', 'session.info']) stops.push(host.onEvent(type, event => {
        if (type === 'message.complete' && !event?.replayed) completionSignal = true
        listener()
      }))
      return () => stops.forEach(stop => stop())
    },
  }
}
