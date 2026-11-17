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

describe("renderMarkdown emphasis beside CJK", () => {  it("bolds quotes that sit against Chinese text", () => {
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

describe("renderMarkdown while streaming", () => {
  it("closes an unfinished bold marker instead of flashing raw asterisks", () => {
    const html = renderMarkdown("前文**注意：", true)
    expect(html).toContain("<strong>注意：</strong>")
    expect(html).not.toContain("**")
  })

  it("closes strikethrough but leaves arithmetic and inline code alone", () => {
    expect(renderMarkdown("~~作废", true)).toContain("<del>作废</del>")
    expect(renderMarkdown("2 * 3 = 6", true)).toContain("2 * 3 = 6")
    expect(renderMarkdown("`**未闭合", true)).toContain("`**未闭合")
    expect(renderMarkdown("``a**b", true)).toContain("``a**b</p>")
  })

  it("keeps raw markers in a finished message", () => {
    expect(renderMarkdown("前文**注意：")).toContain("**")
  })

  it("leaves a lone marker that cannot open emphasis alone", () => {
    const html = renderMarkdown("输入 ** 就是加粗", true)
    expect(html).toContain("** 就是加粗")
    expect(html).toContain("加粗</p>")
  })

  it("does not close a marker that was opened far above the tail", () => {
    expect(renderMarkdown("**开头" + "字".repeat(300), true)).toContain("**开头")
  })

  it("leaves only the still-open code fence unhighlighted", () => {
    const open = renderMarkdown("```ts\nconst a = 1", true)
    expect(open).toContain("const a = 1")
    expect(open).not.toContain("hljs-keyword")
    expect(renderMarkdown("```ts\nconst a = 1\n```", true)).toContain("hljs-keyword")
  })
})
