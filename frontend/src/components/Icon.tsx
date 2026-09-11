import type { JSX } from "solid-js"

const GLYPHS = {
  plus: "\uf067",
  folder: "\uf07b",
  home: "\uf015",
  "ellipsis-h": "\uf141",
  "chevron-left": "\uf053",
  "chevron-right": "\uf054",
  times: "\uf00d",
  cog: "\uf013",
  copy: "\uf0c5",
  "paper-plane": "\uf1d8",
  pencil: "\uf040",
  trash: "\uf014",
  "code-fork": "\uf126",
  warning: "\uf071",
} as const

export type IconName = keyof typeof GLYPHS

export function Icon(props: { name: IconName; class?: string; style?: JSX.CSSProperties }) {
  return (
    <span class={`fa ${props.class ?? ""}`} style={props.style} aria-hidden="true">
      {GLYPHS[props.name]}
    </span>
  )
}
