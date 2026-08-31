import { For, Show, createEffect, createMemo, on } from "solid-js"
import { useApp } from "../store/app"
import { ChatTurnView, groupTurns } from "./MessagePart"

export function MessageTimeline() {
  const app = useApp()
  let scroller: HTMLDivElement | undefined
  let stick = true

  const messages = createMemo(() => {
    const id = app.state.selectedSessionId
    if (!id) return []
    return app.state.messages[id] ?? []
  })

  const turns = createMemo(() => groupTurns(messages()))
  const lastTurnHasAnswer = createMemo(() => {
    const last = turns()[turns().length - 1]
    if (!last) return false
    return last.assistants.some((message) =>
      (app.state.parts[message.id] ?? []).some(
        (part) => part.type === "text" && Boolean((part as { text?: string }).text?.trim()),
      ),
    )
  })

  const onScroll = () => {
    if (!scroller) return
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  }

  createEffect(
    on(
      () => [messages(), app.state.parts, app.busy()],
      () => {
        if (stick && scroller) {
          requestAnimationFrame(() => {
            scroller?.scrollTo({ top: scroller.scrollHeight })
          })
        }
      },
    ),
  )

  return (
    <div class="timeline" ref={scroller} onScroll={onScroll}>
      <div class="timeline-inner">
        <For each={turns()}>
          {(turn, index) => (
            <ChatTurnView
              turn={turn}
              partsByMessage={app.state.parts}
              live={app.busy() && index() === turns().length - 1}
            />
          )}
        </For>
        <Show when={app.busy() && !lastTurnHasAnswer()}>
          <div class="working">
            <span class="spinner" />
            <span>正在思考与调用工具…</span>
          </div>
        </Show>
      </div>
    </div>
  )
}
