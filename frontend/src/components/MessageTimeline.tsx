import { Index, Match, Show, Switch, createEffect, createMemo, on } from "solid-js"
import { useApp } from "../store/app"
import { ChatTurnView, CompactionMark, groupTurns, type TimelineItem } from "./MessagePart"
import { WorkGroup } from "./WorkGroup"

function asCompaction(item: TimelineItem) {
  return item.kind === "compaction" ? item : undefined
}

function asTurn(item: TimelineItem) {
  return item.kind === "turn" ? item : undefined
}

export function MessageTimeline() {
  const app = useApp()
  let scroller: HTMLDivElement | undefined
  let stick = true

  const messages = createMemo(() => {
    const id = app.state.selectedSessionId
    if (!id) return []
    return app.state.messages[id] ?? []
  })

  const items = createMemo(() => groupTurns(messages(), app.state.parts))
  const last = createMemo(() => items()[items().length - 1])
  const waiting = createMemo(() => {
    const item = last()
    return Boolean(app.busy() && item?.kind === "turn" && item.assistants.length === 0)
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
        <Index each={items()}>
          {(item, index) => (
            <Switch>
              <Match when={asCompaction(item())}>
                {(compaction) => (
                  <CompactionMark
                    live={app.busy() && index === items().length - 1 && compaction().status === "running"}
                    summary={compaction().summary}
                  />
                )}
              </Match>
              <Match when={asTurn(item())}>
                {(turn) => (
                  <ChatTurnView
                    turn={turn()}
                    partsByMessage={app.state.parts}
                    live={app.busy() && index === items().length - 1}
                  />
                )}
              </Match>
            </Switch>
          )}
        </Index>
        <Show when={waiting()}>
          <WorkGroup parts={[]} live />
        </Show>
      </div>
    </div>
  )
}
