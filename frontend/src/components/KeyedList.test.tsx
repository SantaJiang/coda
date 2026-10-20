import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { expect, it } from "vitest"
import { KeyedList } from "./KeyedList"

it("retains focused rows across snapshot replacement, reorder, insertion and removal", () => {
  const [items, setItems] = createSignal([{ id: "a", title: "first" }, { id: "b", title: "second" }])
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => <KeyedList each={items()} by={(item) => item.id}>{(item) => <button data-id={item().id}>{item().title}</button>}</KeyedList>, host)
  try {
    const first = host.querySelector<HTMLButtonElement>('[data-id="a"]')!
    first.focus()
    setItems([{ id: "a", title: "updated" }, { id: "b", title: "second" }])
    expect(host.querySelector('[data-id="a"]')).toBe(first)
    expect(document.activeElement).toBe(first)
    expect(first.textContent).toBe("updated")
    setItems([{ id: "c", title: "new" }, { id: "b", title: "second" }, { id: "a", title: "updated" }])
    expect(host.lastElementChild).toBe(first)
    setItems([{ id: "a", title: "only" }])
    expect(host.children).toHaveLength(1)
    expect(host.firstElementChild).toBe(first)
  } finally { dispose(); host.remove() }
})
