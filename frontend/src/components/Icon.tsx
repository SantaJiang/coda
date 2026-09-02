import type { JSX } from "solid-js"

const GLYPHS: Record<string, string> = {
  plus: "\uf067",
  folder: "\uf07b",
  comments: "\uf086",
  "ellipsis-v": "\uf142",
  "ellipsis-h": "\uf141",
  "chevron-right": "\uf054",
  times: "\uf00d",
  cog: "\uf013",
  copy: "\uf0c5",
  "paper-plane": "\uf1d8",
  pencil: "\uf040",
  trash: "\uf014",
  "code-fork": "\uf126",
}

export function Icon(props: { name: string; class?: string; style?: JSX.CSSProperties }) {
  return (
    <span class={`fa ${props.class ?? ""}`} style={props.style} aria-hidden="true">
      {GLYPHS[props.name] ?? ""}
    </span>
  )
}
