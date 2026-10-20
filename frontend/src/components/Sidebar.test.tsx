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
