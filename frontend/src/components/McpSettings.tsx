import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import {
  authenticateMcp,
  connectMcp,
  disconnectMcp,
  fetchHomeDir,
  getGlobalConfig,
  listMcp,
  removeMcp,
  saveMcpServer,
} from "../lib/api"
import { buildMcpConfig, mcpDetail, mcpStatusLabel, type McpConfigEntry, type McpStatus } from "../lib/mcp"
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
    void run(server.name, async () => {
      const directory = await workspace()
      if (!directory) throw new Error("先打开一个项目")
      if (server.status.status === "connected") return disconnectMcp(directory, server.name)
      if (server.status.status === "needs_auth") return authenticateMcp(directory, server.name)
      return connectMcp(directory, server.name)
    })
  }

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
        </div>
      </div>
    </Show>
  )
}
