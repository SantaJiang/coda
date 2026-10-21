import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { expect, it, vi } from "vitest"
import { Sidebar } from "./Sidebar"
import { StoreProviders } from "../store/ctx"
import type { ProjectApi, RuntimeApi, ModelApi, ChromeApi } from "../store/contracts"

it("does not move or recreate a rename input when session snapshots change recency", async () => {
  const [sessions, setSessions] = createSignal([
    { id: "one", title: "first", time: { created: 1, updated: 2 } },
    { id: "two", title: "second", time: { created: 1, updated: 1 } },
  ])
  const rename = vi.fn()
  const host = document.createElement("div")
  document.body.append(host)
  const projects = { projects: () => [{ id: "p", name: "app", path: "/tmp/rename-qa", expanded: true }], selectedProject: () => ({ id: "p" }), selectedSessionId: () => "one", sessionsFor: sessions, connection: () => "connected", renameSession: rename } as unknown as ProjectApi
  const dispose = render(() => <StoreProviders projects={projects} runtime={{ sessionDot: () => null } as unknown as RuntimeApi} models={{} as ModelApi} chrome={{} as ChromeApi}><Sidebar /></StoreProviders>, host)
  try {
    host.querySelectorAll(".tree-session-main")[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    ;[...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "重命名")!.click()
    await Promise.resolve()
    const input = host.querySelector<HTMLInputElement>(".tree-rename")!
    expect(document.activeElement).toBe(input)
    input.value = "unfinished rename"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    setSessions([{ id: "one", title: "first", time: { created: 1, updated: 2 } }, { id: "two", title: "second", time: { created: 1, updated: 99 } }])
    expect(host.querySelector(".tree-rename")).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(host.querySelectorAll(".tree-session")[1].contains(input)).toBe(true)
    expect(input.value).toBe("unfinished rename")
    expect(rename).not.toHaveBeenCalled()
  } finally { dispose(); host.remove() }
})

function renderSessionPreview() {
  const items = [
    { id: "a", name: "coda", path: "/tmp/coda", expanded: true },
    { id: "b", name: "Echo", path: "/tmp/echo", expanded: true },
  ]
  const [selected, setSelected] = createSignal<string | null>("a-0")
  const selectSession = vi.fn()
  const projects = {
    projects: () => items,
    selectedProject: () => items[0],
    selectedSessionId: selected,
    sessionsFor: (path: string) => Array.from({ length: 8 }, (_, index) => ({
      id: `${path === items[0].path ? "a" : "b"}-${index}`,
      title: `会话 ${index + 1}`,
      time: { created: 1, updated: 10 - index },
    })),
    connection: () => "connected",
    selectSession,
  } as unknown as ProjectApi
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => (
    <StoreProviders projects={projects} runtime={{ sessionDot: () => null } as unknown as RuntimeApi} models={{} as ModelApi} chrome={{} as ChromeApi}>
      <Sidebar />
    </StoreProviders>
  ), host)
  return { host, setSelected, selectSession, cleanup: () => { dispose(); host.remove() } }
}

it("previews five recent sessions per project and expands each group independently", () => {
  const { host, selectSession, cleanup } = renderSessionPreview()
  try {
    const groups = host.querySelectorAll(".tree-project")
    const firstSession = groups[0].querySelector<HTMLButtonElement>(".tree-session-main")!
    const more = groups[0].querySelector<HTMLButtonElement>(".tree-show-more")!
    expect(groups[0].querySelectorAll(".tree-session")).toHaveLength(5)
    expect(groups[1].querySelectorAll(".tree-session")).toHaveLength(5)
    expect(more.textContent).toBe("展开显示")
    expect(more.getAttribute("aria-expanded")).toBe("false")
    more.click()
    expect(groups[0].querySelectorAll(".tree-session")).toHaveLength(8)
    expect(groups[1].querySelectorAll(".tree-session")).toHaveLength(5)
    expect(more.textContent).toBe("收起显示")
    groups[0].querySelectorAll<HTMLButtonElement>(".tree-session-main")[7].click()
    expect(selectSession).toHaveBeenCalledWith(expect.objectContaining({ id: "a-7" }))
    more.click()
    expect(groups[0].querySelectorAll(".tree-session")).toHaveLength(5)
    expect(groups[0].querySelector(".tree-session-main")).toBe(firstSession)
  } finally { cleanup() }
})

it("keeps an older active session visible when selection changes or the preview is collapsed", () => {
  const { host, setSelected, cleanup } = renderSessionPreview()
  try {
    const group = host.querySelector(".tree-project")!
    setSelected("a-6")
    expect(group.querySelector(".tree-session.active")?.textContent).toBe("会话 7")
    expect(group.querySelectorAll(".tree-session")).toHaveLength(7)
    group.querySelector<HTMLButtonElement>(".tree-show-more")!.click()
    expect(group.querySelectorAll(".tree-session")).toHaveLength(8)
    group.querySelector<HTMLButtonElement>(".tree-show-more")!.click()
    expect(group.querySelector(".tree-session.active")?.textContent).toBe("会话 7")
    setSelected("a-0")
    expect(group.querySelectorAll(".tree-session")).toHaveLength(5)
  } finally { cleanup() }
})
