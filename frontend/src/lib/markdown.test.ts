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

describe("renderMarkdown emphasis beside CJK", () => {
  it("bolds quotes that sit against Chinese text", () => {
    const html = renderMarkdown("简单说：是**“共用基建，各自打包”**——你可以把它看作是一个工具链")
    expect(html).toContain("<strong>“共用基建，各自打包”</strong>")
    expect(html).not.toContain("**")
  })

  it("bolds emphasis that ends on punctuation and continues in Chinese", () => {
    const html = renderMarkdown("前文**注意：**后面还有字")
    expect(html).toContain("<strong>注意：</strong>后面还有字")
    expect(html).not.toContain("**")
  })

  it("bolds parenthetical text between Chinese characters", () => {
    const html = renderMarkdown("文字**（括号）**文字")
    expect(html).toContain("<strong>（括号）</strong>")
    expect(html).not.toContain("**")
  })

  it("keeps bold inside Chinese words", () => {
    const html = renderMarkdown("但**不存在**单一")
    expect(html).toContain("<strong>不存在</strong>")
  })

  it("does not bold ASCII letters wrapped around quotes", () => {
    const html = renderMarkdown('word**"quote"**more')
    expect(html).not.toContain("<strong>")
    expect(html).toContain("**")
  })
})
