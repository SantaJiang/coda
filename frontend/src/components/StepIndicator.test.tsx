import { afterEach, expect, it } from "vitest"
import { render } from "solid-js/web"
import { StepIndicator, type StepIndicatorProps } from "./StepIndicator"

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function setup(props: StepIndicatorProps) {
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => <StepIndicator {...props} />, container)
  cleanups.push(() => {
    dispose()
    container.remove()
  })
  return container
}

const segmentsOf = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>(".step-seg")]

it("renders one segment per step", () => {
  const container = setup({ total: 4, active: 0 })
  expect(segmentsOf(container)).toHaveLength(4)
})

it("marks the active step and leaves the rest pending", () => {
  const container = setup({ total: 3, active: 1 })
  const [first, second, third] = segmentsOf(container)
  expect(second.dataset.state).toBe("active")
  expect(second.getAttribute("aria-current")).toBe("step")
  expect(first.dataset.state).toBe("pending")
  expect(first.hasAttribute("aria-current")).toBe(false)
  expect(third.dataset.state).toBe("pending")
})

it("lets the active state win over answered", () => {
  const container = setup({ total: 2, active: 0, answered: () => true })
  expect(segmentsOf(container)[0].dataset.state).toBe("active")
  expect(segmentsOf(container)[1].dataset.state).toBe("answered")
})

it("labels the track with the current position", () => {
  const container = setup({ total: 3, active: 1 })
  expect(container.querySelector(".step-track")?.getAttribute("aria-label")).toBe("第 2 题，共 3 题")
})

it("selects a step on click", () => {
  let picked: number | undefined
  const container = setup({
    total: 3,
    active: 0,
    onSelect: (index) => {
      picked = index
    },
  })
  segmentsOf(container)[2].click()
  expect(picked).toBe(2)
})

it("disables every segment while submitting", () => {
  const container = setup({ total: 3, active: 0, disabled: true })
  expect(segmentsOf(container).every((segment) => segment.disabled)).toBe(true)
})

it("shows a full fill without animation when no countdown is running", () => {
  const container = setup({ total: 2, active: 0 })
  const fill = container.querySelector(".step-seg-fill")
  expect(fill).not.toBeNull()
  expect(fill?.hasAttribute("data-run")).toBe(false)
})

it("drains the active fill while the countdown runs", () => {
  const container = setup({ total: 2, active: 0, countdownKey: 1, countdownSeconds: 8 })
  const fill = container.querySelector(".step-seg-fill")
  expect(fill?.hasAttribute("data-run")).toBe(true)
  const track = container.querySelector<HTMLElement>(".step-track")
  expect(track?.style.getPropertyValue("--step-countdown")).toBe("8s")
})

it("only fills the active segment", () => {
  const container = setup({ total: 3, active: 1 })
  expect(container.querySelectorAll(".step-seg-fill")).toHaveLength(1)
})
