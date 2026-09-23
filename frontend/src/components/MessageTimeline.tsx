import { Index, Match, Show, Switch, createEffect, createMemo, createSignal, on } from "solid-js"
import { useProjects, useRuntime } from "../store/app"
import {
  ChatTurnView,
  CompactionMark,
  groupTurns,
  nextLiveItemKey,
  timelineItemKey,
  type TimelineItem,
} from "./MessagePart"
import { WorkGroup } from "./WorkGroup"

function asCompaction(item: TimelineItem) {
  return item.kind === "compaction" ? item : undefined
}

function asTurn(item: TimelineItem) {
  return item.kind === "turn" ? item : undefined
}

export function MessageTimeline() {
  const projects = useProjects()
  return (
    <Show keyed when={projects.selectedSessionId()}>
      {(_sessionID) => <SessionTimeline />}
    </Show>
  )
}

function SessionTimeline() {
  const runtime = useRuntime()
  const projects = useProjects()
  let scroller: HTMLDivElement | undefined
  let stick = true

  const messages = createMemo(() => runtime.messages())

  const items = createMemo(() => groupTurns(messages(), runtime.partsByMessage()))
  const [liveKey, setLiveKey] = createSignal("")
  const reconnecting = createMemo(() => projects.connection() === "disconnected")
  const showLiveTail = createMemo(() => reconnecting() && !runtime.busy())
  const isLive = (item: TimelineItem, index: number) => liveKey() === timelineItemKey(item, index)

  createEffect(
    on(
      () => [runtime.busy(), items()] as const,
      ([busy, list]) => setLiveKey((latched) => nextLiveItemKey(latched, busy, list)),
    ),
  )

  const onScroll = () => {
    if (!scroller) return
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  }
  const pauseAutoScroll = () => {
    stick = false
  }
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) pauseAutoScroll()
  }
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest(".work-head, .work-status-head, .work-step-head")) pauseAutoScroll()
  }

  createEffect(
    on(
      () => [messages(), runtime.partsByMessage(), runtime.busy(), reconnecting()],
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
    <div
      class="timeline"
      ref={scroller}
      onScroll={onScroll}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      aria-busy={runtime.busy()}
    >
      <div class="timeline-inner">
        <Index each={items()}>
          {(item, index) => (
            <Switch>
              <Match when={asCompaction(item())}>
                {(compaction) => (
                  <CompactionMark
                    live={isLive(item(), index)}
                    status={compaction().status}
                    summary={compaction().summary}
                    error={compaction().error}
                  />
                )}
              </Match>
              <Match when={asTurn(item())}>
                {(turn) => (
                  <ChatTurnView
                    turn={turn()}
                    partsByMessage={runtime.partsByMessage()}
                    live={isLive(item(), index)}
                  />
                )}
              </Match>
            </Switch>
          )}
        </Index>
        <Show when={showLiveTail()}>
          <WorkGroup parts={[]} live />
        </Show>
        <Show when={!runtime.busy() && runtime.sessionError()}>
          <div class="error-card">{runtime.sessionError()}</div>
        </Show>
      </div>
    </div>
  )
}
