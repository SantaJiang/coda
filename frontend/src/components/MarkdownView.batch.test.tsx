import { expect, it, vi } from "vitest"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"

// Count parses without paying for marked/DOMPurify on every assertion.
const parses: string[] = []
vi.mock("../lib/markdown", () => ({
  renderMarkdown: (text: string) => { parses.push(text); return `<p>${text}</p>` },
}))

// The import has to follow the mock so the component picks up the stub.
const { MarkdownView } = await import("./MarkdownView")

it("parses a burst of deltas once per frame instead of once per delta", async () => {
  const [text, setText] = createSignal("第一段")
  const host = document.createElement("div")
  const dispose = render(() => <MarkdownView text={text()} streaming />, host)
  try {
    // The first paint is synchronous so history never shows an empty block.
    expect(parses).toEqual(["第一段"])
    expect(host.textContent).toBe("第一段")
    for (let i = 1; i <= 100; i++) setText("第一段" + "字".repeat(i))
    expect(parses).toHaveLength(1)
    expect(host.textContent).toBe("第一段")
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    // One pass with the latest text, not a hundred passes through the pipeline.
    expect(parses).toHaveLength(2)
    expect(parses[1]).toBe("第一段" + "字".repeat(100))
    expect(host.textContent).toBe("第一段" + "字".repeat(100))
  } finally {
    dispose()
  }
})
