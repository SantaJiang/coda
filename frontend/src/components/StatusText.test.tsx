import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { StatusText, useStatusLine } from "./StatusText"
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); vi.useRealTimers(); vi.unstubAllGlobals() })
function setup() {
  const [label, setLabel] = createSignal("Planning next moves")
  const [live, setLive] = createSignal(true)
  const host = document.createElement("div")
  dispose = render(() => { const line = useStatusLine(label, live); return <StatusText line={line()} active={live()} /> }, host)
  return { host, setLabel, setLive }
}
it("animates changes upwards, restarts for a newer state, then releases the outgoing text", () => {
  vi.useFakeTimers()
  const { host, setLabel } = setup()
  expect(host.querySelector(".flipping")).toBeNull()
  setLabel("Thinking")
  expect(host.querySelector(".flipping")).toBeTruthy()
  expect(host.querySelector(".out")?.textContent).toBe("Planning next moves")
  expect(host.querySelector(".in")?.textContent).toBe("Thinking")
  vi.advanceTimersByTime(100)
  setLabel("Reading app.ts")
  expect(host.querySelector(".out")?.textContent).toBe("Thinking")
  vi.advanceTimersByTime(320)
  expect(host.querySelector(".out")).toBeNull()
  expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Reading app.ts")
})
it("respects reduced motion and clears animation on stopping", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  const { host, setLabel, setLive } = setup()
  setLabel("Thinking")
  expect(host.querySelector(".flipping")).toBeNull()
  expect(host.querySelector(".out")).toBeNull()
  setLive(false)
  expect(host.querySelector(".work-status-wave")).toBeNull()
})
it("updates shell and retry countdowns in place without flip or shimmer", () => {
  vi.useFakeTimers()
  const { host, setLabel } = setup()
  setLabel("Waiting up to 1m 0s for shell")
  vi.advanceTimersByTime(320)
  const line = host.querySelector(".work-status-line.in")
  setLabel("Waiting up to 0m 59s for shell")
  expect(host.querySelector(".work-status-line.in")).toBe(line)
  expect(line?.textContent).toBe("Waiting up to 0m 59s for shell")
  expect(host.querySelector(".flipping, .out, .work-status-wave")).toBeNull()
  setLabel("Retrying in 10s · attempt 2")
  setLabel("Retrying in 9s · attempt 2")
  expect(host.querySelector(".flipping, .out, .work-status-wave")).toBeNull()
  setLabel("Reading app.ts")
  expect(host.querySelector(".flipping")).toBeTruthy()
})
