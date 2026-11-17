import { afterEach, describe, expect, it } from "vitest"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { MarkdownView } from "./MarkdownView"
const cleanups: Array<() => void> = []
afterEach(() => { window.getSelection()?.removeAllRanges(); while (cleanups.length) cleanups.pop()?.() })
// Markdown is parsed at most once per frame, so a text change lands on the next one.
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
describe("streaming markdown selection", () => {
  it("preserves completed images, focused links, and code scroll positions while text streams", async () => {
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
    await frame()
    expect(container.querySelector("img")).toBe(image)
    expect(container.querySelector("pre")).toBe(code)
    expect(code.scrollLeft).toBe(120)
    expect(document.activeElement).toBe(link)
    expect(container.textContent).toContain("新的段落")
  })
  it("updates code and sanitized attributes without retaining stale nodes or unsafe markup", async () => {
    const [text, setText] = createSignal('```js\nconst value = 1')
    const container = document.createElement("div")
    const dispose = render(() => <MarkdownView text={text()} />, container)
    cleanups.push(dispose)
    const code = container.querySelector("pre")!
    setText('```js\nconst value = 12\n```\n\n<img src="x" onerror="alert(1)">')
    await frame()
    expect(container.querySelector("pre")).toBe(code)
    expect(code.textContent).toContain("12")
    expect(container.querySelector("[onerror]")).toBeNull()
    setText('替换为一段正文')
    await frame()
    expect(container.querySelector("pre, img")).toBeNull()
    expect(container.textContent).toBe("替换为一段正文\n")
  })
  it("keeps selected text stable then resumes updates after selection is released", async () => {
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
    await frame()
    expect(container.textContent?.trim()).toBe("后续更新仍然有效")
  })
  it("does not replay the fade while an existing block keeps growing", async () => {
    const [text, setText] = createSignal("正在输出")
    const container = document.createElement("div")
    const dispose = render(() => <MarkdownView text={text()} streaming />, container)
    cleanups.push(dispose)
    const paragraph = container.querySelector("p")!
    expect(paragraph.classList.contains("sd-fade")).toBe(true)
    paragraph.classList.remove("sd-fade")
    setText("正在输出更多文字")
    await frame()
    expect(container.querySelector("p")).toBe(paragraph)
    expect(paragraph.classList.contains("sd-fade")).toBe(false)

    const [listText, setListText] = createSignal("- 第一项")
    const listHost = document.createElement("div")
    const disposeList = render(() => <MarkdownView text={listText()} streaming />, listHost)
    cleanups.push(disposeList)
    const list = listHost.querySelector("ul")!
    list.classList.remove("sd-fade")
    setListText("- 第一项\n- 第二项")
    await frame()
    expect(listHost.querySelector("ul")).toBe(list)
    expect(list.classList.contains("sd-fade")).toBe(false)
    expect(list.querySelectorAll("li")).toHaveLength(2)

    setText("正在输出更多文字\n\n新的段落")
    await frame()
    const added = container.querySelector(".markdown")!.lastElementChild!
    expect(added).not.toBe(paragraph)
    expect(added.classList.contains("sd-fade")).toBe(true)
    expect(paragraph.classList.contains("sd-fade")).toBe(false)
  })
  it("renders unfinished code fences safely while streaming", () => {
    const container = document.createElement("div")
    const dispose = render(() => <MarkdownView text={'```typescript\nconst a = "<script>"'} />, container)
    cleanups.push(dispose)
    expect(container.querySelector("pre code")?.textContent).toContain('const a = "<script>"')
    expect(container.querySelector("script")).toBeNull()
  })
  it("renders the first text immediately and batches later tokens into one frame", async () => {
    const [text, setText] = createSignal("第一段")
    const container = document.createElement("div")
    const dispose = render(() => <MarkdownView text={text()} streaming caret />, container)
    cleanups.push(dispose)
    // History and the first token must not wait a frame for an empty block.
    expect(container.querySelector(".markdown")!.textContent?.trim()).toBe("第一段")
    expect(container.querySelector(".markdown")!.classList.contains("is-streaming")).toBe(true)
    setText("第一段，第二")
    expect(container.querySelector(".markdown")!.textContent?.trim()).toBe("第一段")
    setText("第一段，第二段也来了")
    await frame()
    expect(container.querySelector(".markdown")!.textContent?.trim()).toBe("第一段，第二段也来了")
  })
  it("shows an unfinished marker as formatted while streaming and raw once final", () => {
    const container = document.createElement("div")
    const dispose = render(() => <MarkdownView text="前文**注意：" streaming />, container)
    cleanups.push(dispose)
    expect(container.querySelector("strong")?.textContent).toBe("注意：")
    expect(container.textContent).not.toContain("**")
    const finalHost = document.createElement("div")
    const disposeFinal = render(() => <MarkdownView text="前文**注意：" />, finalHost)
    cleanups.push(disposeFinal)
    expect(finalHost.textContent).toContain("**注意：")
  })
})
