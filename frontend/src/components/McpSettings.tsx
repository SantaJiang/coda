import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import {
  cancelMcpOAuth,
  completeMcpOAuth,
  connectMcp,
  disconnectMcp,
  fetchHomeDir,
  getGlobalConfig,
  getMcpIntegration,
  getMcpOAuthStatus,
  listMcp,
  listMcpResources,
  removeMcp,
  saveMcpServer,
  startMcpOAuth,
  type McpResourceCatalog,
} from "../lib/api"
import { buildMcpConfig, mcpDetail, mcpStatusLabel, validMcpName, type McpConfigEntry, type McpStatus } from "../lib/mcp"
import { interactiveOAuthMethod, type McpOAuthAttempt, type McpOAuthStatus } from "../lib/mcp-oauth"
import { connectClientMcp, type ClientMcpConnection } from "../lib/client-mcp"
import { noteTools } from "../lib/client-mcp-tools"
import { openExternalLink } from "../lib/desktop"
import { useChrome, useProjects } from "../store/app"
import { Icon } from "./Icon"

type ServerRow = { name: string; status: McpStatus; detail: string }

export function McpSettings() {
  const chrome = useChrome()
  const projects = useProjects()
  const [servers, setServers] = createSignal<ServerRow[]>([])
  const [loading, setLoading] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [pending, setPending] = createSignal("")
  const [error, setError] = createSignal("")
  const [confirming, setConfirming] = createSignal("")
  const [kind, setKind] = createSignal<"local" | "remote">("local")
  const [name, setName] = createSignal("")
  const [command, setCommand] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [assignments, setAssignments] = createSignal("")
  const [resourcesFor, setResourcesFor] = createSignal("")
  const [resources, setResources] = createSignal<McpResourceCatalog | null>(null)
  const [resourceError, setResourceError] = createSignal("")
  const [signIn, setSignIn] = createSignal<{
    name: string
    integrationID: string
    attempt: McpOAuthAttempt
    status: McpOAuthStatus | null
    input: string
    busy: boolean
    error: string
  } | null>(null)
  const [clientName, setClientName] = createSignal("coda-client")
  const [clientStatus, setClientStatus] = createSignal<"idle" | "connecting" | "connected">("idle")
  const [clientError, setClientError] = createSignal("")
  let clientConnection: ClientMcpConnection | null = null
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  const ordered = createMemo(() => [...servers()].sort((a, b) => a.name.localeCompare(b.name)))

  let ticket = 0
  const refresh = async () => {
    const current = ++ticket
    setLoading(untrack(() => servers().length) === 0)
    setError("")
    try {
      const directory = await workspace()
      if (!directory) {
        if (current === ticket) setError("先打开一个项目")
        return
      }
      const [status, config] = await Promise.all([
        listMcp(directory),
        getGlobalConfig().catch((): { mcp: Record<string, McpConfigEntry> } => ({ mcp: {} })),
      ])
      if (current !== ticket) return
      const defined = config.mcp ?? {}
      setServers(
        Object.entries(status).map(([serverName, serverStatus]) => ({
          name: serverName,
          status: serverStatus,
          detail: mcpDetail(defined[serverName] as McpConfigEntry | undefined),
        })),
      )
    } catch (cause) {
      if (current === ticket) setError(cause instanceof Error ? cause.message : "读取 MCP 失败")
    } finally {
      if (current === ticket) setLoading(false)
    }
  }

  const workspace = async () => projects.selectedProject()?.path || (await fetchHomeDir()) || ""

  createEffect(() => {
    if (!chrome.mcpSettingsOpen()) return
    void refresh()
  })

  onCleanup(() => {
    if (pollTimer) clearTimeout(pollTimer)
    clientConnection?.close()
    clientConnection = null
  })

  createEffect(() => {
    if (!chrome.mcpSettingsOpen()) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      chrome.closeMcpSettings()
    }
    document.addEventListener("keydown", onKey, true)
    onCleanup(() => document.removeEventListener("keydown", onKey, true))
  })

  const run = async (serverName: string, action: () => Promise<unknown>) => {
    if (pending()) return
    setPending(serverName)
    setError("")
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MCP 操作失败")
    } finally {
      setPending("")
    }
  }

  const toggle = (server: ServerRow) => {
    if (server.status.status === "needs_auth" && server.status.integrationID) {
      void authorize(server, server.status.integrationID)
      return
    }
    void run(server.name, async () => {
      const directory = await workspace()
      if (!directory) throw new Error("先打开一个项目")
      if (server.status.status === "connected") return disconnectMcp(directory, server.name)
      return connectMcp(directory, server.name)
    })
  }

  const pollSignIn = async () => {
    const current = signIn()
    if (!current || current.status?.status === "complete") return
    const deadline = Date.now() + Math.min(current.attempt.lifetime, 120_000)
    const tick = async () => {
      const active = signIn()
      if (!active) return
      if (Date.now() > deadline) {
        setSignIn({ ...active, status: { status: "expired" }, busy: false })
        return
      }
      try {
        const directory = await workspace()
        if (!directory) return
        const status = await getMcpOAuthStatus(directory, active.integrationID, active.attempt.attemptID)
        const latest = signIn()
        if (!latest || latest.attempt.attemptID !== active.attempt.attemptID) return
        setSignIn({ ...latest, status, busy: false })
        if (status.status === "complete") {
          await run(active.name, async () => connectMcp(directory, active.name))
          setSignIn(null)
          return
        }
        if (status.status === "pending") pollTimer = setTimeout(() => void tick(), 1200)
      } catch (cause) {
        const latest = signIn()
        if (!latest) return
        setSignIn({ ...latest, status: { status: "failed", message: cause instanceof Error ? cause.message : "查询授权状态失败" }, busy: false })
      }
    }
    await tick()
  }

  const authorize = async (server: ServerRow, integrationID: string) => {
    if (!integrationID || pending()) return
    setError("")
    setPending(server.name)
    try {
      const directory = await workspace()
      if (!directory) throw new Error("先打开一个项目")
      const integration = await getMcpIntegration(directory, integrationID)
      const method = interactiveOAuthMethod(integration)
      if (!method) throw new Error(`${server.name} 没有可用的交互式授权方式`)
      const attempt = await startMcpOAuth(directory, integrationID, method.id)
      if (!attempt.attemptID || !attempt.url) throw new Error("后端没有返回授权地址")
      setSignIn({ name: server.name, integrationID, attempt, status: null, input: "", busy: false, error: "" })
      await openExternalLink(attempt.url)
      void pollSignIn()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "开始授权失败")
    } finally {
      setPending("")
    }
  }

  const closeSignIn = async () => {
    const current = signIn()
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = undefined
    setSignIn(null)
    if (current && current.status?.status !== "complete") {
      const directory = await workspace()
      if (directory) await cancelMcpOAuth(directory, current.integrationID, current.attempt.attemptID).catch(() => undefined)
    }
    await refresh()
  }

  const submitRedirect = async () => {
    const current = signIn()
    const directory = await workspace()
    if (!current || !directory || !current.input.trim() || current.busy) return
    setSignIn({ ...current, busy: true, error: "" })
    try {
      await completeMcpOAuth(directory, current.integrationID, current.attempt.attemptID, current.input.trim())
      // The backend settles the credential asynchronously; keep polling until its own
      // status turns complete before reconnecting.
      setSignIn({ ...current, busy: false })
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = undefined
      void pollSignIn()
    } catch (cause) {
      setSignIn({ ...current, busy: false, error: cause instanceof Error ? cause.message : "提交授权结果失败" })
    }
  }

  const showResources = async (serverName: string) => {
    setResourcesFor(serverName)
    setResources(null)
    setResourceError("")
    try {
      const directory = await workspace()
      if (!directory) throw new Error("先打开一个项目")
      const catalog = await listMcpResources(directory)
      const resources = catalog.resources.filter((item) => item.server === serverName)
      const templates = catalog.templates.filter((item) => item.server === serverName)
      setResources({ resources, templates })
    } catch (cause) {
      setResourceError(cause instanceof Error ? cause.message : "读取 MCP 资源失败")
    }
  }

  const toggleClientMcp = async () => {
    if (clientConnection) {
      clientConnection.close()
      clientConnection = null
      setClientStatus("idle")
      return
    }
    const name = clientName().trim()
    const directory = await workspace()
    setClientError("")
    if (!validMcpName(name) || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      setClientError("客户端名称只能包含字母、数字、下划线和横线")
      return
    }
    if (!directory) {
      setClientError("先打开一个项目")
      return
    }
    try {
      clientConnection = await connectClientMcp({
        directory,
        name,
        tools: noteTools(directory),
        onStatus: (status) => {
          if (status === "disconnected") clientConnection = null
          setClientStatus(status === "disconnected" ? "idle" : status)
        },
        onError: (message) => setClientError(message),
      })
    } catch (cause) {
      setClientError(cause instanceof Error ? cause.message : "连接客户端 MCP 失败")
      setClientStatus("idle")
    }
  }

  const signInErrorMessage = (status: McpOAuthStatus | null) =>
    status?.status === "failed" ? status.message : "授权已过期"

  const remove = (serverName: string) => {
    if (confirming() !== serverName) {
      setConfirming(serverName)
      return
    }
    setConfirming("")
    void run(serverName, async () => {
      const directory = await workspace()
      if (!directory) throw new Error("先打开一个项目")
      await removeMcp(directory, serverName)
    })
  }

  const add = async (event: SubmitEvent) => {
    event.preventDefault()
    const built = buildMcpConfig({
      name: name(),
      type: kind(),
      command: command(),
      url: url(),
      assignments: assignments(),
    })
    if ("error" in built) {
      setError(built.error)
      return
    }
    if (servers().some((server) => server.name === built.name)) {
      setError("已经有同名服务器")
      return
    }
    setSaving(true)
    setError("")
    try {
      await saveMcpServer(built.name, built.server)
      setName("")
      setCommand("")
      setUrl("")
      setAssignments("")
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加失败")
    } finally {
      setSaving(false)
    }
  }

  const onOverlay = (event: MouseEvent) => {
    if (event.target === event.currentTarget) chrome.closeMcpSettings()
  }

  return (
    <Show when={chrome.mcpSettingsOpen()}>
      <div class="dialog-overlay nested" onMouseDown={onOverlay}>
        <div class="dialog mcp-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
          <header class="dialog-head">
            <h2 id="mcp-title">MCP</h2>
            <button type="button" class="icon-btn" onClick={() => chrome.closeMcpSettings()} aria-label="关闭">
              <Icon name="times" />
            </button>
          </header>
          <p class="dialog-hint">连接外部工具。添加后写入本机配置，所有项目都能用。</p>
          <Show when={error()}>
            <div class="dialog-error" role="alert">{error()}</div>
          </Show>
          <Show when={loading() && ordered().length === 0}>
            <p class="field-hint">正在读取…</p>
          </Show>
          <Show when={!loading() && ordered().length === 0 && !error()}>
            <p class="field-hint">还没有服务器</p>
          </Show>
          <For each={ordered()}>
            {(server) => {
              const failed = () => server.status.status === "failed" || server.status.status === "needs_client_registration"
              const detail = () => ("error" in server.status ? server.status.error : server.detail)
              return (
                <div class="model-row">
                  <div class="mcp-copy">
                    <div class="model-row-name">{server.name}</div>
                    <div class="mcp-status" classList={{ bad: failed() || server.status.status === "needs_auth" }} title={detail()}>
                      {mcpStatusLabel(server.status.status)}
                      <Show when={detail()}> · {detail()}</Show>
                    </div>
                  </div>
                  <div class="mcp-actions">
                    <Show when={server.status.status === "connected"}>
                      <button type="button" class="text-btn" onClick={() => void showResources(server.name)}>资源</button>
                    </Show>
                    <Show when={server.status.status === "needs_auth" && server.status.integrationID}>
                      {(integrationID) => (
                        <button
                          type="button"
                          class="text-btn"
                          disabled={pending() === server.name}
                          onClick={() => void authorize(server, integrationID())}
                        >
                          授权
                        </button>
                      )}
                    </Show>
                    <button
                      type="button"
                      class="text-btn"
                      disabled={pending() === server.name}
                      onClick={() => remove(server.name)}
                    >
                      {confirming() === server.name ? "确认" : "删除"}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      class="settings-switch-btn"
                      aria-label={`${server.status.status === "connected" ? "停用" : "启用"} ${server.name}`}
                      aria-checked={server.status.status === "connected"}
                      disabled={pending() === server.name || saving()}
                      onClick={() => toggle(server)}
                    >
                      <span class="settings-switch" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )
            }}
          </For>
          <form class="model-form mcp-form" onSubmit={(event) => void add(event)}>
            <div class="mcp-kind-row" role="radiogroup" aria-label="服务器类型">
              <button type="button" role="radio" aria-checked={kind() === "local"} class="mcp-kind-chip" classList={{ active: kind() === "local" }} onClick={() => setKind("local")}>本地</button>
              <button type="button" role="radio" aria-checked={kind() === "remote"} class="mcp-kind-chip" classList={{ active: kind() === "remote" }} onClick={() => setKind("remote")}>远程</button>
            </div>
            <label class="field">
              名称
              <input value={name()} onInput={(event) => setName(event.currentTarget.value)} placeholder="filesystem" autocomplete="off" />
            </label>
            <Show when={kind() === "local"} fallback={
              <label class="field">
                地址
                <input value={url()} onInput={(event) => setUrl(event.currentTarget.value)} placeholder="https://example.com/mcp" autocomplete="off" />
              </label>
            }>
              <label class="field">
                命令
                <input value={command()} onInput={(event) => setCommand(event.currentTarget.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem /path" autocomplete="off" />
              </label>
            </Show>
            <label class="field">
              {kind() === "local" ? "环境变量" : "请求头"}
              <textarea
                value={assignments()}
                onInput={(event) => setAssignments(event.currentTarget.value)}
                placeholder="KEY=value"
                rows={2}
              />
            </label>
            <div class="dialog-actions">
              <button type="submit" class="send-btn" disabled={saving() || !!pending()}>
                {saving() ? "添加中…" : "添加"}
              </button>
            </div>
          </form>
          <section class="mcp-client-section">
            <h3>客户端工具</h3>
            <p class="dialog-hint">让桌面端作为 MCP 服务器接入后端，提供 coda_remember / coda_recall 两个笔记工具，连接期间可用。</p>
            <div class="field-row">
              <input
                value={clientName()}
                placeholder="coda-client"
                disabled={clientStatus() !== "idle"}
                onInput={(event) => setClientName(event.currentTarget.value)}
              />
              <button type="button" class="ghost-btn" onClick={() => void toggleClientMcp()}>
                {clientStatus() === "idle" ? "连接" : clientStatus() === "connected" ? "断开" : "连接中…"}
              </button>
            </div>
            <Show when={clientError()}>
              <div class="dialog-error">{clientError()}</div>
            </Show>
          </section>
        </div>
      </div>

      <Show when={signIn()}>
        {(current) => (
          <div class="dialog-overlay nested">
            <div class="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-oauth-title">
              <header class="dialog-head">
                <h2 id="mcp-oauth-title">授权 {current().name}</h2>
                <button type="button" class="icon-btn" aria-label="关闭" onClick={() => void closeSignIn()}>
                  <Icon name="times" />
                </button>
              </header>
              <p class="dialog-hint">{current().attempt.instructions || "已在系统浏览器打开授权页，等待授权完成。"}</p>
              <Show when={current().status?.status === "pending" || !current().status}>
                <div class="field-hint">等待浏览器中完成授权…</div>
              </Show>
              <Show when={current().status?.status === "complete"}>
                <div class="field-hint">授权成功，正在连接…</div>
              </Show>
              <Show when={current().status?.status === "failed" || current().status?.status === "expired" || current().error}>
                <div class="dialog-error" role="alert">
                  {current().error || signInErrorMessage(current().status)}
                </div>
              </Show>
              <Show when={current().attempt.paste || current().attempt.mode === "code"}>
                <label class="field">
                  授权完成后的跳转地址
                  <textarea
                    value={current().input}
                    rows={2}
                    placeholder="粘贴浏览器地址栏中的完整 URL"
                    onInput={(event) => setSignIn({ ...current(), input: event.currentTarget.value })}
                  />
                </label>
              </Show>
              <div class="dialog-actions">
                <button type="button" class="ghost-btn" onClick={() => void closeSignIn()}>取消</button>
                <Show when={current().attempt.paste || current().attempt.mode === "code"}>
                  <button type="button" class="send-btn" disabled={current().busy || !current().input.trim()} onClick={() => void submitRedirect()}>
                    提交授权结果
                  </button>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>

      <Show when={resourcesFor()}>
        {(serverName) => (
          <div class="dialog-overlay nested" onMouseDown={(event) => { if (event.target === event.currentTarget) setResourcesFor("") }}>
            <div class="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-resources-title">
              <header class="dialog-head">
                <h2 id="mcp-resources-title">{serverName()} 的资源</h2>
                <button type="button" class="icon-btn" aria-label="关闭" onClick={() => setResourcesFor("")}>
                  <Icon name="times" />
                </button>
              </header>
              <Show when={resourceError()}>
                <div class="dialog-error">{resourceError()}</div>
              </Show>
              <Show when={!resources() && !resourceError()}>
                <div class="field-hint">读取中…</div>
              </Show>
              <Show when={resources() && !resources()!.resources.length && !resources()!.templates.length}>
                <div class="field-hint">这个服务器没有公开资源</div>
              </Show>
              <For each={resources()?.resources ?? []}>
                {(resource) => (
                  <div class="mcp-resource-row">
                    <div>{resource.name}</div>
                    <div class="mcp-resource-uri">{resource.uri}</div>
                  </div>
                )}
              </For>
              <For each={resources()?.templates ?? []}>
                {(template) => (
                  <div class="mcp-resource-row">
                    <div>{template.name}</div>
                    <div class="mcp-resource-uri">{template.uriTemplate}</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </Show>
  )
}
