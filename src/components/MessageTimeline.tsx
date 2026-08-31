import { Index, Show, createEffect, createMemo, on } from "solid-js"
import { useApp } from "../store/app"
import { ChatTurnView, groupTurns } from "./MessagePart"
import { WorkGroup } from "./WorkGroup"

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
        <Index each={turns()}>
          {(turn, index) => (
            <ChatTurnView
              turn={turn()}
              partsByMessage={app.state.parts}
              live={app.busy() && index === turns().length - 1}
            />
          )}
        </Index>
        <Show when={app.busy() && (turns()[turns().length - 1]?.assistants.length ?? 0) === 0}>
          <WorkGroup parts={[]} live />
        </Show>
      </div>
    </div>
  )
}
