import { render } from "solid-js/web"
import { afterEach, expect, it, vi } from "vitest"
import { QueueDock } from "./QueueDock"

const sendQueuedNow = vi.hoisted(() => vi.fn())
const editQueued = vi.hoisted(() => vi.fn())
const removeQueued = vi.hoisted(() => vi.fn())

vi.mock("../store/app", () => ({
  useRuntime: () => ({
    queued: () => [
      {
        id: "a",
        text: "同样的，附件1是cursor的侧边栏",
        attachments: [{ id: "img", filename: "shot.png", mime: "image/png", kind: "file", url: "data:image/png;base64,xx", label: "PNG", preview: "data:image/png;base64,xx" }],
      },
      { id: "b", text: "最后，v2版本的问题", attachments: [] },
    ],
    sendQueuedNow,
    editQueued,
    removeQueued,
  }),
}))

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined
afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  sendQueuedNow.mockClear()
  editQueued.mockClear()
  removeQueued.mockClear()
})

function setup() {
  host = document.createElement("div")
  document.body.append(host)
  dispose = render(() => <QueueDock />, host)
  return host
}

it("shows the queued count, image thumb, and steer action", () => {
  const host = setup()
  expect(host.querySelector(".queue-title")?.textContent).toBe("2 Queued")
  expect(host.querySelectorAll(".queue-row")).toHaveLength(2)
  expect(host.querySelectorAll(".queue-thumb")).toHaveLength(1)
  expect(host.querySelector(".queue-row-text")?.textContent).toContain("侧边栏")
  host.querySelector<HTMLButtonElement>(".queue-steer")?.click()
  expect(sendQueuedNow).toHaveBeenCalledWith("a")
})

it("collapses to a pill and expands again", () => {
  const host = setup()
  host.querySelector<HTMLButtonElement>(".queue-collapse")?.click()
  expect(host.querySelector(".queue-dock")).toBeNull()
  expect(host.querySelector(".queue-pill")?.textContent).toBe("Queued2")
  host.querySelector<HTMLButtonElement>(".queue-pill")?.click()
  expect(host.querySelector(".queue-title")?.textContent).toBe("2 Queued")
})
