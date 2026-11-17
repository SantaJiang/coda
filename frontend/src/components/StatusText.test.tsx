import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import type { TurnLabel } from "../lib/conversation"
import { StatusText, useStatusLine } from "./StatusText"
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); vi.useRealTimers(); vi.unstubAllGlobals() })
function setup() {
  const [label, setLabel] = createSignal<TurnLabel>({ key: "Planning next moves", text: "Planning next moves", announce: "Planning next moves" })
  const [live, setLive] = createSignal(true)
  const host = document.createElement("div")
  dispose = render(() => { const line = useStatusLine(label, live); return <StatusText line={line()} active={live()} /> }, host)
  const say = (text: string) => setLabel({ key: text, text, announce: text })
  return { host, setLabel, say, setLive }
}
it("animates changes upwards, restarts for a newer state, then releases the outgoing text", () => {
  vi.useFakeTimers()
  const { host, say } = setup()
  expect(host.querySelector(".flipping")).toBeNull()
  say("Thinking")
  expect(host.querySelector(".flipping")).toBeTruthy()
  expect(host.querySelector(".out")?.textContent).toBe("Planning next moves")
  expect(host.querySelector(".in")?.textContent).toBe("Thinking")
  vi.advanceTimersByTime(100)
  say("Reading app.ts")
  expect(host.querySelector(".out")?.textContent).toBe("Thinking")
  vi.advanceTimersByTime(320)
  expect(host.querySelector(".out")).toBeNull()
  expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Reading app.ts")
})
it("respects reduced motion and clears animation on stopping", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  const { host, say, setLive } = setup()
  say("Thinking")
  expect(host.querySelector(".flipping")).toBeNull()
  expect(host.querySelector(".out")).toBeNull()
  setLive(false)
  expect(host.querySelector(".work-status-wave")).toBeNull()
})
it("ticks a countdown in place, keeping one identity and one announced sentence", () => {
  vi.useFakeTimers()
  const { host, setLabel } = setup()
  const wait = (text: string) => setLabel({ key: "shell-wait", text, announce: "Waiting for shell", clock: true })
  wait("Waiting up to 1m 0s for shell")
  vi.advanceTimersByTime(320)
  const line = host.querySelector(".work-status-line.in")
  const status = host.querySelector('[role="status"]')
  expect(status?.getAttribute("aria-label")).toBe("Waiting for shell")
  wait("Waiting up to 0m 59s for shell")
  expect(host.querySelector(".work-status-line.in")).toBe(line)
  expect(line?.textContent).toBe("Waiting up to 0m 59s for shell")
  expect(host.querySelector(".flipping, .out, .work-status-wave")).toBeNull()
  expect(host.querySelector(".shell-wait")).toBeTruthy()
  // The clock never rewrites the live region, so assistive tech hears the state only once.
  expect(status?.getAttribute("aria-label")).toBe("Waiting for shell")
  setLabel({ key: "retry · attempt 2", text: "Retrying in 9s · attempt 2", announce: "Retrying · attempt 2", clock: true })
  expect(host.querySelector(".flipping")).toBeTruthy()
  expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Retrying · attempt 2")
})
