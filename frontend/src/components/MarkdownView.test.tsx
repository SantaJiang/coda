import { afterEach, describe, expect, it } from "vitest"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { MarkdownView } from "./MarkdownView"
const cleanups: Array<() => void> = []
afterEach(() => { window.getSelection()?.removeAllRanges(); while (cleanups.length) cleanups.pop()?.() })
describe("streaming markdown selection", () => {
  it("preserves completed images, focused links, and code scroll positions while text streams", () => {
    const initial = '![图](https://example.test/image.png)\n\n[链接](https://example.test)\n\n```text\nlong line\n```\n\n正文'
    const [text, setText] = createSignal(initial)
    const container = document.createElement("div")
    document.body.append(container)
    const dispose = render(() => <MarkdownView text={text()} />, container)
    cleanups.push(() => { dispose(); container.remove() })
    const image = container.querySelector("img")!
    const link = container.querySelector("a")!
    const code = container.querySelector("pre")!
    code.scrollLeft = 120
    link.focus()
    setText(initial + '继续输出\n\n新的段落')
    expect(container.querySelector("img")).toBe(image)
    expect(container.querySelector("pre")).toBe(code)
    expect(code.scrollLeft).toBe(120)
    expect(document.activeElement).toBe(link)
    expect(container.textContent).toContain("新的段落")
  })
  it("updates code and sanitized attributes without retaining stale nodes or unsafe markup", () => {
    const [text, setText] = createSignal('```js\nconst value = 1')
    const container = document.createElement("div")
    const dispose = render(() => <MarkdownView text={text()} />, container)
    cleanups.push(dispose)
    const code = container.querySelector("pre")!
    setText('```js\nconst value = 12\n```\n\n<img src="x" onerror="alert(1)">')
    expect(container.querySelector("pre")).toBe(code)
    expect(code.textContent).toContain("12")
    expect(container.querySelector("[onerror]")).toBeNull()
    setText('替换为一段正文')
    expect(container.querySelector("pre, img")).toBeNull()
    expect(container.textContent).toBe("替换为一段正文\n")
  })
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
