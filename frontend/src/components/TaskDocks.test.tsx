import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import type { Terminals } from "../lib/terminals"
import { TodoDock } from "./TodoDock"
import { TerminalDock } from "./TerminalDock"

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()))
it("shows an unfinished idle plan without pretending its in-progress item is still running", () => {
  const [busy, setBusy] = createSignal(false)
  const [todos, setTodos] = createSignal([{ content: "Verify packaging", status: "in_progress", priority: "high" }])
  const runtime = { busy, todos } as unknown as RuntimeApi
  const host = document.createElement("div")
  document.body.appendChild(host)
  cleanups.push(() => host.remove())
  cleanups.push(render(() => <StoreProviders runtime={runtime} projects={{} as ProjectApi} models={{} as ModelApi} chrome={{} as ChromeApi}><TodoDock embedded /></StoreProviders>, host))
  expect(host.querySelector(".plan-unfinished")?.textContent).toBe("计划仍有 1 项未完成")
  expect(host.querySelector("li.active")).toBeNull()
  setBusy(true)
  expect(host.querySelector(".plan-unfinished")).toBeNull()
  expect(host.querySelector("li.active")).toBeTruthy()
  setTodos([{ content: "Verify packaging", status: "completed", priority: "high" }])
  setBusy(false)
  expect(host.querySelector("li.done")).toBeTruthy()
  expect(host.querySelector(".plan-unfinished")).toBeNull()
})
it("keeps manual recovery available for a short interrupted command without a terminal entry", () => {
  const action = vi.fn()
  const t = { items: () => [{ id: "short", recoverable: true }], visible: () => [], selected: () => undefined, view: () => ({ open: false }), waiting: () => undefined, error: () => "", action } as unknown as Terminals
  const host = document.createElement("div")
  document.body.appendChild(host)
  cleanups.push(() => host.remove())
  cleanups.push(render(() => <TerminalDock terminals={t} />, host))
  expect(host.querySelector(".terminal-dock-button")).toBeNull()
  expect(host.querySelector(".terminal-resume")?.textContent).toContain("继续任务")
  ;(host.querySelector(".terminal-resume") as HTMLButtonElement).click()
  expect(action).toHaveBeenCalledWith("short", "resume")
})

it("shows the same minute/second shell countdown in place across the minute boundary", () => {
  const start = 1_700_000_000_000
  const [now, setNow] = createSignal(start)
  const info = { id: "waiting", status: "running", lastOutputAt: start, nextCheckAt: start + 90000 }
  const t = { items: () => [info], visible: () => [info], selected: () => info, view: () => ({ open: false }), waiting: () => info, error: () => "", now } as unknown as Terminals
  const host = document.createElement("div")
  document.body.append(host)
  cleanups.push(() => host.remove())
  cleanups.push(render(() => <TerminalDock terminals={t} />, host))
  const line = host.querySelector(".shell-wait")!
  expect(line.textContent).toBe("Waiting up to 1m 30s for shell")
  setNow(start + 30000)
  expect(line.textContent).toBe("Waiting up to 1m 0s for shell")
  setNow(start + 31000)
  expect(host.querySelector(".shell-wait")).toBe(line)
  expect(line.textContent).toBe("Waiting up to 0m 59s for shell")
})
