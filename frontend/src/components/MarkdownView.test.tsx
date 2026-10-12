import { afterEach, describe, expect, it } from "vitest"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { MarkdownView } from "./MarkdownView"
const cleanups: Array<() => void> = []
afterEach(() => { window.getSelection()?.removeAllRanges(); while (cleanups.length) cleanups.pop()?.() })
describe("streaming markdown selection", () => {
  it("keeps selected text stable then resumes updates after selection is released", () => {
    const [text, setText] = createSignal("正在输出第一段")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const dispose = render(() => <MarkdownView text={text()} />, container)
    cleanups.push(() => { dispose(); container.remove() })
    const node = container.querySelector("p")!.firstChild!
    const range = document.createRange()
    range.setStart(node, 0); range.setEnd(node, 4)
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
    setText("正在输出第一段，第二段也来了")
    expect(window.getSelection()!.toString()).toBe("正在输出")
    expect(container.textContent?.trim()).toBe("正在输出第一段")
    window.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange"))
    expect(container.textContent?.trim()).toBe("正在输出第一段，第二段也来了")
    setText("后续更新仍然有效")
    expect(container.textContent?.trim()).toBe("后续更新仍然有效")
  })
  it("renders unfinished code fences safely while streaming", () => {
    const container = document.createElement("div")
    const dispose = render(() => <MarkdownView text={'```typescript\nconst a = "<script>"'} />, container)
    cleanups.push(dispose)
    expect(container.querySelector("pre code")?.textContent).toContain('const a = "<script>"')
    expect(container.querySelector("script")).toBeNull()
  })
})
