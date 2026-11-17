import { afterEach, describe, expect, it, vi } from "vitest"
import { render } from "solid-js/web"
import { turnSources } from "../lib/sources"
import type { Part } from "../lib/types"
import { SourcesChip } from "./SourcesChip"

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
  vi.restoreAllMocks()
})

function part(id: string, tool: string, input: Record<string, unknown>, output?: string): Part {
  return {
    id,
    sessionID: "s",
    messageID: "a",
    type: "tool",
    tool,
    callID: id,
    state: { status: "completed", input, output },
  }
}

function setup(parts: Part[]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(() => <SourcesChip sources={turnSources(parts)} />, container)
  cleanups.push(() => {
    dispose()
    container.remove()
  })
  return container
}

const search = part(
  "w1",
  "websearch",
  { query: "figma mcp setup" },
  "## [Figma](https://figma.com/a)\n## [Design](https://designagentlab.com)\n## [GitHub](https://github.com/x)",
)
const fetch = part("f1", "webfetch", { url: "https://inthepocket.design/guide" })

describe("sources chip", () => {
  it("shows the count and only distinct site tiles", () => {
    const container = setup([search, fetch])
    expect(container.querySelector(".sources-chip-label")?.textContent).toBe("4 个来源")
    expect(container.querySelectorAll(".sources-chip .source-tile")).toHaveLength(3)
  })

  it("opens a panel grouped by search and fetch", () => {
    const container = setup([search, fetch])
    ;(container.querySelector(".sources-chip") as HTMLButtonElement).click()
    const panel = container.querySelector('[role="dialog"]')
    expect(panel?.textContent).toContain("搜索 · figma mcp setup")
    expect(panel?.textContent).toContain("抓取")
    expect(container.querySelectorAll(".sources-popover .source-row")).toHaveLength(4)
  })

  it("opens a source in the browser and closes the panel", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    const container = setup([search])
    ;(container.querySelector(".sources-chip") as HTMLButtonElement).click()
    ;(container.querySelector(".sources-popover .source-row") as HTMLButtonElement).click()
    expect(open).toHaveBeenCalledWith("https://figma.com/a", "_blank", "noopener,noreferrer")
    expect(container.querySelector(".sources-popover")).toBeNull()
  })

  it("closes on Escape", () => {
    const container = setup([search])
    ;(container.querySelector(".sources-chip") as HTMLButtonElement).click()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(container.querySelector(".sources-popover")).toBeNull()
  })
})
