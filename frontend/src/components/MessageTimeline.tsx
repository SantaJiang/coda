import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { useProjects, useRuntime } from "../store/app"
import { conversationTurns } from "../lib/conversation"
import { ChatTurnView } from "./MessagePart"

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
  const [clock, setClock] = createSignal(Date.now())
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
  const selectedText = () => {
    const selection = window.getSelection()
    return Boolean(scroller && selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(scroller))
  }
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  const save = () => runtime.updateTimelineView({ following: following(), top: restoreTop ?? scroller.scrollTop }, props.sessionID)
  const captureAnchor = (preferred?: HTMLElement) => {
    if (!scroller) return
    const top = scroller.getBoundingClientRect().top
    const entries = [...scroller.querySelectorAll<HTMLElement>("[data-entry-key], [data-block-key]")]
    const visible = preferred ?? entries.find((element) => element.getBoundingClientRect().bottom > top)
    if (visible) anchor = { key: visible.dataset.scrollKey ?? visible.dataset.entryKey!, offset: visible.getBoundingClientRect().top - top, turnID: visible.closest<HTMLElement>("[data-turn-id]")?.dataset.turnId }
  }
  const applyLayout = () => {
    frame = undefined
    if (disposed) return
    if (restoreTop !== undefined) {
      // Session detail may arrive after mount. Do not overwrite its saved
      // reading position with the empty/loading timeline's clamped zero.
      if (!inner.querySelector("[data-turn-id]")) return
      scroller.scrollTop = restoreTop
      restoreTop = undefined
    } else if (following() && !selectedText()) scroller.scrollTop = scroller.scrollHeight
    else if (anchor) {
      const element = [...scroller.querySelectorAll<HTMLElement>("[data-entry-key], [data-scroll-key], [data-block-key]")].find((element) => (element.dataset.scrollKey ?? element.dataset.entryKey) === anchor!.key)
        ?? [...scroller.querySelectorAll<HTMLElement>("[data-turn-id]")].find((element) => element.dataset.turnId === anchor!.turnID)
      if (element) scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset
    }
    save()
    captureAnchor()
  }
  const scheduleLayout = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(applyLayout)
  }
  const pause = () => { restoreTop = undefined; captureAnchor(); setFollowing(false); save() }
  const latest = () => {
    window.getSelection()?.removeAllRanges()
    anchor = undefined
    restoreTop = undefined
    setFollowing(true)
    save()
    scheduleLayout()
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
  onCleanup(() => { save(); disposed = true; if (frame !== undefined) cancelAnimationFrame(frame) })

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
          onInspect={pause} beforeLayout={() => captureAnchor(document.activeElement?.closest<HTMLElement>("[data-scroll-key], [data-entry-key]") ?? undefined)} afterLayout={scheduleLayout} />}</For>
        <Show when={runtime.syncError()}>
          <div class="connection-notice">同步回复失败：{runtime.syncError()} <button type="button" class="ghost-btn" onClick={() => void runtime.resync()}>重新同步回复</button></div>
        </Show>
      </div>
    </div>
    <Show when={!following()}><button type="button" class="jump-latest" onClick={latest}>回到最新 ↓</button></Show>
  </div>
}
