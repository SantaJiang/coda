import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { useProjects, useRuntime } from "../store/app"
import { conversationTurns } from "../lib/conversation"
import { minimapMarks } from "../lib/timeline-minimap"
import { ChatTurnView } from "./MessagePart"
import { TurnMinimap } from "./TurnMinimap"

/** Rail width plus clearance. The minimap only shows when this much gutter is left. */
const MINIMAP_GUTTER = 52

export function MessageTimeline() {
  const projects = useProjects()
  return <Show keyed when={projects.selectedSessionId()}>{(sessionID) => <SessionTimeline sessionID={sessionID} />}</Show>
}

function SessionTimeline(props: { sessionID: string }) {
  const runtime = useRuntime()
  const projects = useProjects()
  let scroller!: HTMLDivElement
  let inner!: HTMLDivElement
  const saved = runtime.timelineView()
  const [following, setFollowing] = createSignal(saved.following)
  const [awayFromBottom, setAwayFromBottom] = createSignal(false)
  const showLatest = () => !following() && awayFromBottom()
  const [clock, setClock] = createSignal(Date.now())
  const [narrow, setNarrow] = createSignal(false)
  const [activeTurnID, setActiveTurnID] = createSignal<string>()
  let frame: number | undefined
  let disposed = false
  let userScroll = false
  let draggingScrollbar = false
  let restoreTop = saved.following ? undefined : saved.top
  let anchor: { key: string; offset: number; turnID?: string } | undefined
  const turns = createMemo(() => conversationTurns(runtime.messages(), runtime.partsByMessage(), {
    status: runtime.status(), sending: runtime.busy() && !runtime.status(), stopping: runtime.stopping(),
    settling: runtime.settling(), stoppedTurnID: runtime.stoppedTurnID(),
    stoppedTurns: runtime.stoppedTurns(),
    permissionCount: runtime.pendingPermissions().length, questionCount: runtime.pendingQuestions().length,
    sessionError: runtime.sessionError(), now: clock(),
  }))
  const byID = createMemo(() => new Map(turns().map((turn) => [turn.id, turn])))
  // The minimap indexes turns, not headings. Prompts come from the user parts
  // so hovering the rail reads like the timeline it points into.
  const marks = createMemo(() => {
    const parts = runtime.partsByMessage()
    return minimapMarks(turns(), (turn) => {
      if (!turn.user) return ""
      return (parts[turn.user.id] ?? [])
        .map((part) => (part.type === "text" ? part.text : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    })
  })
  const selectedText = () => {
    const selection = window.getSelection()
    return Boolean(scroller && selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(scroller))
  }
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4
  // Inspection pauses following even on a single screen. Show the shortcut
  // only while the viewport actually leaves content below, and remeasure on
  // layout changes because rollback/collapse need not dispatch a scroll event.
  const measureBottom = () => setAwayFromBottom(scroller.clientHeight > 0 && !nearBottom())
  const save = () => runtime.updateTimelineView({ following: following(), top: restoreTop ?? scroller.scrollTop }, props.sessionID)
  const captureAnchor = (preferred?: HTMLElement) => {
    if (!scroller) return
    const top = scroller.getBoundingClientRect().top
    const entries = [...scroller.querySelectorAll<HTMLElement>("[data-entry-key], [data-scroll-key], [data-block-key]")]
    const visible = preferred ?? entries.find((element) => element.getBoundingClientRect().bottom > top)
    if (visible) anchor = { key: visible.dataset.scrollKey ?? visible.dataset.entryKey!, offset: visible.getBoundingClientRect().top - top, turnID: visible.closest<HTMLElement>("[data-turn-id]")?.dataset.turnId }
  }
  const applyLayout = () => {
    frame = undefined
    if (disposed) return
    if (restoreTop !== undefined) {
      // Session detail may arrive after mount. Do not overwrite its saved
      // reading position with the empty/loading timeline's clamped zero.
      if (!inner.querySelector("[data-turn-id]")) { measureBottom(); return }
      scroller.scrollTop = restoreTop
      restoreTop = undefined
    } else if (following() && !selectedText()) scroller.scrollTop = scroller.scrollHeight
    else if (anchor) {
      const element = [...scroller.querySelectorAll<HTMLElement>("[data-entry-key], [data-scroll-key], [data-block-key]")].find((element) => (element.dataset.scrollKey ?? element.dataset.entryKey) === anchor!.key)
        ?? [...scroller.querySelectorAll<HTMLElement>("[data-turn-id]")].find((element) => element.dataset.turnId === anchor!.turnID)
      if (element) scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset
    }
    measureBottom()
    // The rail is an overlay in the reading gutter. Measuring the difference
    // between the scroller and the centered column keeps it off the text at
    // every window width instead of relying on a media query.
    setNarrow((scroller.clientWidth - inner.clientWidth) / 2 < MINIMAP_GUTTER)
    save()
    captureAnchor()
  }
  // The pinned question bubble used to keep an opaque pad so the answer could
  // not slide into its border. The bubble surface and its shadow now separate
  // the pinned question from the scrolling answer.
  const scheduleLayout = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(applyLayout)
  }
  const pause = () => { restoreTop = undefined; captureAnchor(); setFollowing(false); measureBottom(); save() }
  const thoughtComplete = () => {
    // Continue at the latest text when its live preview folds away. Someone
    // reading earlier content keeps their anchor and does not get pulled down.
    if (awayFromBottom() || selectedText()) return
    setFollowing(true)
    save()
  }
  const latest = () => {
    window.getSelection()?.removeAllRanges()
    anchor = undefined
    restoreTop = undefined
    setFollowing(true)
    save()
    scheduleLayout()
  }
  // Jump must go through the same bookkeeping as a user scroll. Writing
  // scrollTop without the userScroll flag would leave `following` true and the
  // next layout pass would snap the reader back to the bottom. The anchor is
  // recaptured here so a frame already scheduled by a streaming delta cannot
  // restore the pre-jump position.
  const jumpToTurn = (turnID: string) => {
    const target = [...scroller.querySelectorAll<HTMLElement>("[data-turn-id]")].find((element) => element.dataset.turnId === turnID)
    if (!target) return
    pause()
    userScroll = true
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8
    setFollowing(nearBottom() && !selectedText())
    measureBottom()
    save()
    captureAnchor()
    setActiveTurnID(turnID)
  }
  onMount(() => {
    applyLayout()
    const onSelection = () => { if (selectedText()) pause() }
    const releaseScrollbar = () => { draggingScrollbar = false }
    document.addEventListener("selectionchange", onSelection)
    document.addEventListener("pointerup", releaseScrollbar)
    document.addEventListener("pointercancel", releaseScrollbar)
    // ResizeObserver runs before paint. Correct anchors there immediately,
    // otherwise a sidebar resize or a completed turn paints one shifted frame.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      applyLayout()
    })
    observer?.observe(inner)
    observer?.observe(scroller)
    onCleanup(() => {
      observer?.disconnect()
      document.removeEventListener("selectionchange", onSelection)
      document.removeEventListener("pointerup", releaseScrollbar)
      document.removeEventListener("pointercancel", releaseScrollbar)
    })
  })
  createEffect(on(() => [runtime.messages(), runtime.partsByMessage(), runtime.status(), runtime.settling()], scheduleLayout, { defer: true }))
  createEffect(() => {
    if (!runtime.busy() && runtime.status()?.type !== "retry") return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    onCleanup(() => window.clearInterval(timer))
  })
  // Track the turn at the top of the reading area. Keyed on the id list so a
  // streaming delta does not rebuild the observer on every token.
  let turnObserver: IntersectionObserver | undefined
  createEffect(on(() => turns().map((turn) => turn.id).join("\n"), () => {
    turnObserver?.disconnect()
    turnObserver = undefined
    if (!scroller || typeof IntersectionObserver === "undefined") return
    const visible = new Set<string>()
    const tops = new Map<string, number>()
    turnObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.turnId
        if (!id) continue
        if (entry.isIntersecting) { visible.add(id); tops.set(id, entry.boundingClientRect.top) }
        else { visible.delete(id); tops.delete(id) }
      }
      let best: string | undefined
      let bestTop = Infinity
      for (const id of visible) {
        const top = tops.get(id) ?? Infinity
        if (top < bestTop) { bestTop = top; best = id }
      }
      setActiveTurnID(best)
    }, { root: scroller, rootMargin: "0px 0px -62% 0px" })
    for (const element of scroller.querySelectorAll<HTMLElement>("[data-turn-id]")) turnObserver.observe(element)
  }))
  onCleanup(() => { turnObserver?.disconnect(); save(); disposed = true; if (frame !== undefined) cancelAnimationFrame(frame) })

  return <div class="timeline-region">
    <div class="timeline" ref={scroller} aria-busy={turns().some((turn) => turn.active)}
      onWheel={(event) => { userScroll = true; if (event.deltaY < 0) pause() }}
      onTouchStart={() => { userScroll = true; pause() }}
      onKeyDown={(event) => { if (["ArrowUp", "PageUp", "Home"].includes(event.key)) { userScroll = true; pause() } }}
      onPointerDown={(event) => {
        const target = event.target as Element
        if (target.closest(".work-head, .work-step-head")) { userScroll = false; pause() }
        else if (event.target === scroller) { draggingScrollbar = true; userScroll = true; pause() }
      }}
      onScroll={() => {
        measureBottom()
        // Layout shrinkage and our own scrollTop writes also dispatch scroll.
        // They must not replace the anchor before the next layout correction.
        if (userScroll || draggingScrollbar) {
          setFollowing(nearBottom() && !selectedText())
          userScroll = false
          save(); captureAnchor()
        }
      }}>
      <div class="timeline-inner" ref={inner}>
        <Show when={projects.connection() !== "connected"}>
          <div class="connection-notice" role="status">{projects.connection() === "connecting" ? "正在连接后端…" : "连接已中断，正在重连…"}</div>
        </Show>
        <For each={turns().map((turn) => turn.id)}>{(id) => <ChatTurnView turn={byID().get(id)!}
          partsByMessage={runtime.partsByMessage()} following={following() && !selectedText()}
          onInspect={pause}
          onThoughtComplete={thoughtComplete}
          // Mouse activation on macOS need not focus the button. Anchor the
          // toggled row itself so its new content grows below it.
          beforeLayout={(target) => captureAnchor(target?.closest<HTMLElement>("[data-scroll-key], [data-entry-key]") ?? undefined)} afterLayout={scheduleLayout} />}</For>
        <Show when={runtime.syncError()}>
          <div class="connection-notice">同步回复失败：{runtime.syncError()} <button type="button" class="ghost-btn" onClick={() => void runtime.resync()}>重新同步回复</button></div>
        </Show>
      </div>
    </div>
    <TurnMinimap marks={marks()} activeID={activeTurnID()} hidden={narrow() || marks().length < 3} onJump={jumpToTurn} />
    <button type="button" class="jump-latest" classList={{ "is-visible": showLatest() }}
      disabled={!showLatest()} aria-hidden={!showLatest()} aria-label="下拉到最新" onClick={latest}>下拉到最新</button>
  </div>
}
