import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { expect, it } from "vitest"
import { useDismissable } from "./dismiss"

it("consumes Escape before document-level shortcuts can interpret the closed menu as idle UI", () => {
  const [active, setActive] = createSignal(true)
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => {
    useDismissable({ active, onClose: () => setActive(false), root: () => host })
    return <button>menu</button>
  }, host)
  let stopped = false
  const onKey = (event: KeyboardEvent) => { if (!event.defaultPrevented && !active()) stopped = true }
  document.addEventListener("keydown", onKey)
  try {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    host.querySelector("button")!.dispatchEvent(event)
    expect(active()).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(stopped).toBe(false)
  } finally { document.removeEventListener("keydown", onKey); dispose(); host.remove() }
})
