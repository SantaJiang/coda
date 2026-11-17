import { describe, expect, it } from "vitest"
import { sourceHue, turnSources, webSearchSources, webSource } from "./sources"
import type { Part } from "./types"

describe("web search sources", () => {
  it("parses the tool's heading results and keeps the order", () => {
    const sources = webSearchSources([
      "## [Coda 文档](https://coda.example.com/docs)",
      "",
      "正文段落，不属于来源。",
      "## [另一个结果](https://www.other.example/path)",
      "",
    ].join("\n"))
    expect(sources).toEqual([
      { url: "https://coda.example.com/docs", title: "Coda 文档", site: "coda.example.com", host: "coda.example.com" },
      { url: "https://www.other.example/path", title: "另一个结果", site: "other.example", host: "www.other.example" },
    ])
  })

  it("drops a title that is just the URL", () => {
    const sources = webSearchSources("## [https://example.com/a](https://example.com/a)")
    expect(sources).toEqual([{ url: "https://example.com/a", title: undefined, site: "example.com", host: "example.com" }])
  })

  it("accepts bare URL lines", () => {
    const sources = webSearchSources("https://example.com/a\nhttps://example.com/b")
    expect(sources.map((source) => source.url)).toEqual(["https://example.com/a", "https://example.com/b"])
  })

  it("treats scheme, www, trailing slash and fragment as the same page", () => {
    const sources = webSearchSources([
      "https://www.example.com/page/",
      "http://example.com/page#section",
      "https://example.com/page",
    ].join("\n"))
    expect(sources).toHaveLength(1)
    expect(sources[0].url).toBe("https://www.example.com/page/")
  })

  it("keeps different paths and queries apart", () => {
    const sources = webSearchSources([
      "https://example.com/a?x=1",
      "https://example.com/a?x=2",
      "https://example.com/b",
    ].join("\n"))
    expect(sources).toHaveLength(3)
  })

  it("splits a heading title that contains brackets from the last link marker", () => {
    const sources = webSearchSources("## [RFC [1]](https://example.com/rfc)")
    expect(sources[0]).toMatchObject({ title: "RFC [1]", url: "https://example.com/rfc" })
  })

  it("skips prose and non-http schemes", () => {
    const sources = webSearchSources([
      "No search results found. Please try a different query.",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "[mail](mailto:a@example.com)",
    ].join("\n"))
    expect(sources).toEqual([])
  })

  it("handles missing output", () => {
    expect(webSearchSources(undefined)).toEqual([])
    expect(webSearchSources("")).toEqual([])
  })
})

describe("source hue", () => {
  it("is stable per site and inside the colour wheel", () => {
    expect(sourceHue("example.com")).toBe(sourceHue("example.com"))
    expect(sourceHue("example.com")).toBeGreaterThanOrEqual(0)
    expect(sourceHue("example.com")).toBeLessThan(360)
    expect(sourceHue("example.com")).not.toBe(sourceHue("other.example"))
  })
})

function toolPart(
  id: string,
  tool: string,
  input: Record<string, unknown>,
  output?: string,
  status: "completed" | "error" | "running" = "completed",
): Part {
  const base = { id, sessionID: "s", messageID: "a", type: "tool" as const, tool, callID: id }
  if (status === "error") return { ...base, state: { status, input, error: "failed" } }
  if (status === "running") return { ...base, state: { status, input } }
  return { ...base, state: { status, input, output } }
}

describe("turn sources", () => {
  it("aggregates searches and fetches in order, deduping across steps", () => {
    const result = turnSources([
      toolPart("w1", "websearch", { query: "figma" }, "## [A](https://a.example/one)\n## [B](https://b.example/two)"),
      toolPart("f1", "webfetch", { url: "https://d.example/four" }),
      toolPart("w2", "websearch", { query: "console" }, "## [C](https://c.example/three)"),
    ])
    expect(result.steps.map((step) => step.type)).toEqual(["search", "fetch", "search"])
    expect(result.sources.map((source) => source.url)).toEqual([
      "https://a.example/one",
      "https://b.example/two",
      "https://d.example/four",
      "https://c.example/three",
    ])
    expect(result.steps[0]).toMatchObject({ type: "search", query: "figma" })
  })

  it("skips unfinished tools and searches with no results", () => {
    const result = turnSources([
      toolPart("w1", "websearch", { query: "a" }, undefined, "error"),
      toolPart("w2", "websearch", { query: "b" }, "No search results found."),
      toolPart("w3", "websearch", { query: "c" }, "## [C](https://c.example)", "running"),
    ])
    expect(result.steps).toEqual([])
    expect(result.sources).toEqual([])
  })

  it("keeps the first title when a page shows up in both a search and a fetch", () => {
    const result = turnSources([
      toolPart("w1", "websearch", { query: "q" }, "## [Titled](https://x.example/page)"),
      toolPart("f1", "webfetch", { url: "https://www.x.example/page/" }),
    ])
    expect(result.steps).toHaveLength(1)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].title).toBe("Titled")
  })

  it("ignores fetches that are not http(s)", () => {
    expect(turnSources([toolPart("f1", "webfetch", { url: "file:///etc/passwd" })]).steps).toEqual([])
    expect(webSource("javascript:alert(1)")).toBeUndefined()
    expect(webSource("https://example.com/a")?.site).toBe("example.com")
  })
})
