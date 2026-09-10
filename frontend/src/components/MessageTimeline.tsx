import { Index, Match, Show, Switch, createEffect, createMemo, on } from "solid-js"
import { useRuntime } from "../store/app"
import { ChatTurnView, CompactionMark, groupTurns, type TimelineItem } from "./MessagePart"
import { WorkGroup } from "./WorkGroup"

function asCompaction(item: TimelineItem) {
  return item.kind === "compaction" ? item : undefined
}

function asTurn(item: TimelineItem) {
  return item.kind === "turn" ? item : undefined
}

export function MessageTimeline() {
  const runtime = useRuntime()
  let scroller: HTMLDivElement | undefined
  let stick = true

  const messages = createMemo(() => runtime.messages())

  const items = createMemo(() => groupTurns(messages(), runtime.partsByMessage()))
  const last = createMemo(() => items()[items().length - 1])
  const waiting = createMemo(() => {
    const item = last()
    return Boolean(runtime.busy() && item?.kind === "turn" && item.assistants.length === 0)
  })

  const onScroll = () => {
    if (!scroller) return
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  }

  createEffect(
    on(
      () => [messages(), runtime.partsByMessage(), runtime.busy()],
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
                    live={runtime.busy() && index === items().length - 1 && compaction().status === "running"}
                    summary={compaction().summary}
                  />
                )}
              </Match>
              <Match when={asTurn(item())}>
                {(turn) => (
                  <ChatTurnView
                    turn={turn()}
                    partsByMessage={runtime.partsByMessage()}
                    live={runtime.busy() && index === items().length - 1}
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
