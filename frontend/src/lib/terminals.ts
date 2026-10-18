import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { LONG_TERMINAL_MS } from "./terminal-policy"
export { LONG_TERMINAL_MS } from "./terminal-policy"
import { isTerminalRunning } from "./api"
import type { TerminalInfo } from "./terminal-contracts"
import { defaultTerminalClient, type TerminalClient } from "./terminal-client"

type View = {
  open: boolean
  tab: "terminal" | "plan"
  selected?: string
  width: number
  scroll: Record<string, number>
}
const views = new Map<string, View>()
const blank = (): View => ({
  open: false,
  tab: "terminal",
  width: 420,
  scroll: {},
})
function load(key: string): View {
  if (views.has(key)) return views.get(key)!
  try {
    const saved = JSON.parse(localStorage.getItem(`coda.terminalView:${key}`) || "null")
    if (saved)
      return {
        ...blank(),
        ...saved,
        width: Math.max(260, Math.min(700, Number(saved.width) || 420)),
      }
  } catch {}
  return blank()
}
// Short commands keep their ordinary tool step; only sustained commands get a panel entry.
export function isLongTerminal(info: TerminalInfo, now = Date.now()) {
  return (info.endedAt ?? now) - info.startedAt >= LONG_TERMINAL_MS
}
export function useTerminals(directory: Accessor<string | undefined>, sessionID: Accessor<string | undefined>, client: TerminalClient = defaultTerminalClient) {
  const [items, setItems] = createSignal<TerminalInfo[]>([])
  const [view, setView] = createSignal(blank())
  const [error, setError] = createSignal("")
  const [now, setNow] = createSignal(Date.now())
  const key = () => `${directory() ?? ""}:${sessionID() ?? ""}`
  const patch = (next: Partial<View>) => {
    const value = { ...view(), ...next }
    setView(value)
    views.set(key(), value)
    try {
      localStorage.setItem(`coda.terminalView:${key()}`, JSON.stringify(value))
    } catch {}
  }
  let refreshCurrent: (() => Promise<void>) | undefined
  createEffect(() => {
    const dir = directory(),
      id = sessionID(),
      currentKey = key()
    setItems([])
    setError("")
    setView(load(currentKey))
    if (!dir || !id || id.startsWith("draft")) return
    let disposed = false,
      pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const data = await client.list(dir, id)
        if (!disposed) {
          setItems(data.items)
          setError("")
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : "终端状态同步失败")
      } finally {
        pending = false
      }
    }
    refreshCurrent = refresh
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    onCleanup(() => {
      disposed = true
      window.clearInterval(timer)
      if (refreshCurrent === refresh) refreshCurrent = undefined
    })
  })
  const tick = window.setInterval(() => setNow(Date.now()), 250)
  onCleanup(() => window.clearInterval(tick))
  const visible = createMemo(() => items().filter((info) => !info.hidden && isLongTerminal(info, now())))
  const selected = createMemo(
    () =>
      visible().find((info) => info.id === view().selected) ??
      visible().find(isTerminalRunning) ??
      visible()[visible().length - 1],
  )
  const open = (id?: string) => {
    if (id && items().some((info) => info.id === id && info.hidden)) void action(id, "show")
    patch({ open: true, tab: "terminal", selected: id ?? selected()?.id })
  }
  const reveal = (event: Event) => {
    const id = (event as CustomEvent<string>).detail
    if (items().some((info) => info.id === id)) open(id)
  }
  window.addEventListener("coda:open-terminal", reveal)
  onCleanup(() => window.removeEventListener("coda:open-terminal", reveal))
  const action = async (id: string, action: "cancel" | "hide" | "show" | "resume") => {
    const dir = directory(),
      session = sessionID()
    if (!dir || !session) return
    const currentKey = key()
    try {
      await client.control(dir, session, id, action)
      if (key() === currentKey) await refreshCurrent?.()
    } catch (e) {
      if (key() === currentKey) setError(e instanceof Error ? e.message : "终端操作失败")
    }
  }
  const waiting = createMemo(() =>
    visible().find((info) => isTerminalRunning(info) && info.nextCheckAt && info.nextCheckAt > now()),
  )
  return {
    client,
    items,
    visible,
    selected,
    view,
    patch,
    open,
    action,
    error,
    now,
    waiting,
  }
}
export type Terminals = ReturnType<typeof useTerminals>
export const terminalStatusLabel = (info: TerminalInfo) =>
  ({
    starting: "启动中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
    interrupted: "已中断",
  })[info.status]
