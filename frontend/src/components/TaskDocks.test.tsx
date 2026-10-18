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
