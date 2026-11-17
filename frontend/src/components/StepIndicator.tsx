import { For, Show } from "solid-js"

export type StepState = "pending" | "answered" | "active"

export type StepIndicatorProps = {
  total: number
  active: number
  answered?: (index: number) => boolean
  onSelect?: (index: number) => void
  disabled?: boolean
  // 每次变化都会重建填充节点，从而重启耗尽动画
  // 必须从 1 起：Show 把 0 当假值，会直接走 fallback
  countdownKey?: number
  countdownSeconds?: number
}

export function StepIndicator(props: StepIndicatorProps) {
  const segments = () => Array.from({ length: Math.max(0, props.total) }, (_, index) => index)
  const stateOf = (index: number): StepState =>
    index === props.active ? "active" : props.answered?.(index) ? "answered" : "pending"

  return (
    <div
      class="step-track"
      role="group"
      aria-label={`第 ${props.active + 1} 题，共 ${props.total} 题`}
      style={{ "--step-countdown": `${props.countdownSeconds ?? 5}s` }}
    >
      <For each={segments()}>
        {(index) => (
          <button
            type="button"
            class="step-seg"
            data-state={stateOf(index)}
            disabled={props.disabled}
            aria-label={`第 ${index + 1} 题${props.answered?.(index) ? "，已答" : ""}`}
            aria-current={index === props.active ? "step" : undefined}
            onClick={() => props.onSelect?.(index)}
          >
            <span class="step-seg-dot">
              <Show when={index === props.active}>
                <Show when={props.countdownKey} keyed fallback={<span class="step-seg-fill" />}>
                  {/* 必须带形参：Solid 用 child.length > 0 判断是否重建，零参函数会被当静态节点 */}
                  {(_epoch) => <span class="step-seg-fill" data-run="" />}
                </Show>
              </Show>
            </span>
          </button>
        )}
      </For>
    </div>
  )
}
