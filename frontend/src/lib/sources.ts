/** 一条网页来源：搜索结果或抓取过的页面。 */
export type WebSource = {
  /** 规范化后的 http(s) 地址。 */
  url: string
  /** 结果标题；搜索只给了 URL 时缺省。 */
  title?: string
  /** 展示用站点名，去掉 www.。 */
  site: string
  /** 完整 host。 */
  host: string
}

/**
 * websearch 工具把每条结果写成 `## [title](url)` 标题，再跟正文；没有标题的结果直接写 URL。
 * 这里只认这两种行，正文原样跳过。
 */
export function webSearchSources(output: string | undefined): WebSource[] {
  if (!output) return []
  const seen = new Set<string>()
  return output.split("\n").flatMap((line) => {
    const link = parseLine(line.trim())
    if (!link) return []
    const found = sourceOf(link.url, link.title)
    if (!found || seen.has(found.key)) return []
    seen.add(found.key)
    return [found.source]
  })
}

/** 站点色相：同一个站点每次都一样，给字母块上色用。 */
export function sourceHue(site: string): number {
  let hash = 2166136261
  for (const char of site) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619)
  return (hash >>> 0) % 360
}

function parseLine(line: string): { url: string; title?: string } | undefined {
  return headingLink(line) ?? bareUrl(line)
}

// 标题里可能自带 "]("，所以从最后一个 "](" 分开。
function headingLink(line: string) {
  if (!line.startsWith("#") || !line.endsWith(")") || line.length < 6) return undefined
  const split = line.lastIndexOf("](")
  const start = line.indexOf("[")
  if (split < 0 || start < 0 || start > split) return undefined
  return { title: line.slice(start + 1, split).trim(), url: line.slice(split + 2, -1).trim() }
}

function bareUrl(line: string) {
  if (!/^https?:\/\/\S+$/i.test(line)) return undefined
  return { url: line }
}

// 同一个页面：协议、www.、尾斜杠和锚点都不算新来源。
function sourceOf(url: string, title?: string) {
  const parsed = parseHttpUrl(url)
  if (!parsed) return undefined
  const host = parsed.hostname
  const site = host.replace(/^www\./, "")
  const name = title?.trim()
  return {
    source: {
      url: parsed.href,
      title: name && name !== url && name !== parsed.href ? name : undefined,
      site,
      host,
    },
    key: `${site}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`,
  }
}

function parseHttpUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : undefined
  } catch {
    return undefined
  }
}
