import { Show } from "solid-js"
import type { WebSource } from "../lib/sources"
import { sourceHue } from "../lib/sources"

/** 站点字母块：颜色由站点名决定，深浅色下都是同一个色。 */
export function SourceTile(props: { source: WebSource }) {
  return (
    <span class="source-tile" style={{ "--source-hue": String(sourceHue(props.source.site)) }} aria-hidden="true">
      {props.source.site.charAt(0)}
    </span>
  )
}

/** 一条可点击来源：标题 + 站点；没有标题时只显示站点。 */
export function SourceRow(props: { source: WebSource; onOpen: () => void }) {
  return (
    <button
      type="button"
      class="source-row"
      title={props.source.url}
      aria-label={`在浏览器中打开 ${props.source.title ?? props.source.site}`}
      onClick={props.onOpen}
    >
      <SourceTile source={props.source} />
      <span class="source-text">
        <span class="source-title">{props.source.title ?? props.source.site}</span>
        <Show when={props.source.title}><span class="source-site">{props.source.site}</span></Show>
      </span>
    </button>
  )
}
