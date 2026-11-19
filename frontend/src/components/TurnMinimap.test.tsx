import { afterEach, expect, it, vi } from "vitest"
import { render } from "solid-js/web"
import type { MinimapMark } from "../lib/timeline-minimap"
import { TurnMinimap } from "./TurnMinimap"

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

function mark(id: string, overrides: Partial<MinimapMark> = {}): MinimapMark {
  return {
    id,
    ids: [id],
    count: 1,
    weight: 0.5,
    label: "已完成",
    question: `提问 ${id}`,
    active: false,
    failed: false,
    ...overrides,
  }
}

function mount(marks: MinimapMark[], options: { hidden?: boolean; gutter?: number; onJump?: (id: string) => void } = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => (
    <TurnMinimap marks={marks} activeID={undefined} gutter={options.gutter ?? 0}
      hidden={options.hidden ?? false} onJump={options.onJump ?? (() => {})} />
  ), host)
  return { host, dispose }
}

it("renders one button per mark and jumps to its turn", () => {
  const jumped: string[] = []
  const { host, dispose } = mount([mark("a"), mark("b")], { onJump: (id) => jumped.push(id) })
  const buttons = [...host.querySelectorAll<HTMLButtonElement>(".turn-mark")]
  expect(buttons).toHaveLength(2)
  buttons[1]!.click()
  expect(jumped).toEqual(["b"])
  dispose()
})

it("signals the current turn without reordering the rail", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => (
    <TurnMinimap marks={[mark("a"), mark("b")]} activeID="b" gutter={0} hidden={false} onJump={() => {}} />
  ), host)
  const buttons = [...host.querySelectorAll<HTMLElement>(".turn-mark")]
  expect(buttons[0]!.dataset.active).toBe("false")
  expect(buttons[1]!.dataset.active).toBe("true")
  expect(buttons[1]!.getAttribute("aria-current")).toBe("true")
  dispose()
})

it("keeps the rail out of the tab order and off the pointer when hidden", () => {
  const { host, dispose } = mount([mark("a")], { hidden: true })
  const rail = host.querySelector<HTMLElement>(".turn-minimap")
  expect(rail?.dataset.hidden).toBe("true")
  expect(rail?.getAttribute("aria-hidden")).toBe("true")
  // An invisible button must not stay in the tab order.
  expect(host.querySelector<HTMLElement>(".turn-mark")?.getAttribute("tabindex")).toBe("-1")
  dispose()
})

it("grows the rail into the gutter and keeps it inside the padding without one", () => {
  const tight = mount([mark("a")], { gutter: 0 })
  const tightRail = tight.host.querySelector<HTMLElement>(".turn-minimap-rail")!
  expect(tightRail.style.left).toBe("0px")
  expect(tightRail.style.width).toBe("20px")
  tight.dispose()

  const roomy = mount([mark("a")], { gutter: 100 })
  const roomyRail = roomy.host.querySelector<HTMLElement>(".turn-minimap-rail")!
  expect(roomyRail.style.width).toBe("40px")
  expect(roomyRail.style.left).toBe("-20px")
  roomy.dispose()
})

it("shows the prompt of the hovered mark", () => {
  const { host, dispose } = mount([mark("a", { question: "为什么时间线会跳到底部" })])
  const button = host.querySelector<HTMLElement>(".turn-mark")!
  button.dispatchEvent(new Event("pointerenter"))
  expect(host.querySelector(".turn-mark-tip-text")?.textContent).toBe("为什么时间线会跳到底部")
  dispose()
})
