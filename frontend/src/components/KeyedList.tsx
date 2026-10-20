import { For, createMemo, type Accessor, type JSX } from "solid-js"

/** Keep focused/expanded rows alive when a snapshot replaces their data objects. */
export function KeyedList<T>(props: {
  each: readonly T[]
  by: (item: T) => string
  children: (item: Accessor<T>, index: Accessor<number>) => JSX.Element
}) {
  const items = createMemo(() => new Map(props.each.map((item) => [props.by(item), item])))
  return <For each={[...items().keys()]}>{(key, index) => props.children(() => items().get(key)!, index)}</For>
}
