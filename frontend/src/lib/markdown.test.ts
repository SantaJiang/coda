import { describe, expect, it } from "vitest"
import { renderMarkdown } from "./markdown"

describe("renderMarkdown autolinks", () => {
  it("does not turn www. text into a link that swallows the rest of the line", () => {
    const html = renderMarkdown("把所有文件开头那个“www.98t.la@”去掉，然后帮我筛重复视频文件")
    expect(html).not.toContain("<a")
    expect(html).toContain("去掉，然后帮我筛重复视频文件")
  })

  it("does not autolink bare www mentions", () => {
    expect(renderMarkdown("去 www.example.com 看看")).not.toContain("<a")
  })

  it("keeps explicit protocol links", () => {
    const html = renderMarkdown("打开 https://example.com/docs 看看")
    expect(html).toContain('<a href="https://example.com/docs"')
  })

  it("keeps literal entities inside code", () => {
    const html = renderMarkdown("用 `&amp;` 和 `&lt;`")
    expect(html).toContain("&amp;amp;")
    expect(html).toContain("&amp;lt;")
  })

  it("keeps explicit markdown links", () => {
    const html = renderMarkdown("[文档](https://example.com)")
    expect(html).toContain('<a href="https://example.com"')
  })
})
