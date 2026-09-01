import type { JSX } from "solid-js"

const GLYPHS: Record<string, string> = {
  plus: "\uf067",
  folder: "\uf07b",
  comments: "\uf086",
  "ellipsis-v": "\uf142",
  "caret-right": "\uf0da",
  "chevron-right": "\uf054",
  times: "\uf00d",
  "code-fork": "\uf126",
}

export function Icon(props: { name: string; class?: string; style?: JSX.CSSProperties }) {
  return (
    <span class={`fa ${props.class ?? ""}`} style={props.style} aria-hidden="true">
      {GLYPHS[props.name] ?? ""}
    </span>
  )
}
