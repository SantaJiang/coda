import { For, Show, createMemo } from "solid-js"
import {
  childSessionStub,
  isSubagentTool,
  runningSubagentActivities,
  type SubagentActivity,
} from "../lib/subagent"
import type { Message, MessageWithParts, Part, ToolPart } from "../lib/types"
import { useProjects, useRuntime } from "../store/app"
import { Icon } from "./Icon"

function withParts(messages: Message[], partsByMessage: Record<string, Part[]>): MessageWithParts[] {
  return messages.map((info) => ({ info, parts: partsByMessage[info.id] ?? [] }))
}

/** Cursor Agents Tray / OpenCode activity-chips: child tasks on the parent session. */
export function SubagentDock() {
  const projects = useProjects()
  const runtime = useRuntime()
  const session = () => projects.selectedSession()
  const activities = createMemo(() => {
    const current = session()
    if (!current || current.parentID) return [] as SubagentActivity[]
    const messages = runtime.messages?.() ?? []
    const parts = runtime.partsByMessage?.() ?? {}
    // Dock is a live wait tray — completed/failed chips disappear; open children from the timeline Task row.
    return runningSubagentActivities(withParts(messages, parts))
  })
  const partFor = (activity: SubagentActivity): ToolPart | undefined => {
    const parts = runtime.partsByMessage?.() ?? {}
    for (const message of runtime.messages?.() ?? []) {
      for (const part of parts[message.id] ?? []) {
        if (part.id === activity.key && isSubagentTool(part)) return part
      }
    }
    return undefined
  }
  const resolveChildID = (activity: SubagentActivity) => {
    if (activity.sessionID) return activity.sessionID
    const current = session()
    if (!current) return undefined
    return projects.sessionsFor(current.directory).find(
      (item) => item.parentID === current.id && (!activity.label || item.title === activity.label),
    )?.id
  }
  const openChild = (activity: SubagentActivity, part: ToolPart, sessionID: string) => {
    const current = session()
    if (!current) return
    const existing = projects.sessionsFor(current.directory).find((item) => item.id === sessionID)
    const agent = typeof part.state.input?.agent === "string" ? part.state.input.agent : activity.agent
    void projects.selectSession(
      existing ??
        childSessionStub({
          id: sessionID,
          directory: current.directory,
          title: activity.label || "Subagent",
          parentID: current.id,
          agent,
        }),
    )
  }
  return <Show when={activities().length > 0}>
    <div class="subagent-dock" role="region" aria-label="子代理任务">
      <div class="subagent-dock-label">子代理</div>
      <div class="subagent-dock-list">
        <For each={activities()}>{(activity) => {
          const part = () => partFor(activity)
          const childID = () => resolveChildID(activity)
          return <button
            type="button"
            class="subagent-chip running"
            disabled={!childID()}
            onClick={() => {
              const tool = part()
              const id = childID()
              if (tool && id) openChild(activity, tool, id)
            }}
            title={childID() ? "打开子代理会话" : "等待子代理会话…"}
          >
            <span class="subagent-chip-spinner" aria-hidden="true" />
            <span class="subagent-chip-text">
              <span class="subagent-chip-state">Working on</span>
              {" "}
              <span class="subagent-chip-title">{activity.label}</span>
            </span>
            <Show when={childID()}><Icon name="chevron-right" class="subagent-chip-open" /></Show>
          </button>
        }}</For>
      </div>
    </div>
  </Show>
}

/** Breadcrumb back to parent — Cursor child-agent chrome. */
export function ChildSessionBar() {
  const projects = useProjects()
  const session = () => projects.selectedSession()
  const parent = createMemo(() => {
    const current = session()
    const parentID = current?.parentID
    if (!current || !parentID) return undefined
    return projects.sessionsFor(current.directory).find((item) => item.id === parentID)
  })
  return <Show when={session()?.parentID}>
    <div class="child-session-bar">
      <button
        type="button"
        class="child-session-back"
        disabled={!parent()}
        onClick={() => {
          const target = parent()
          if (target) void projects.selectSession(target)
        }}
      >
        <Icon name="chevron-left" class="child-session-back-icon" />
        返回父会话
      </button>
      <span class="child-session-kind">
        {session()?.agent ? `${session()!.agent} 子代理` : "子代理会话"}
      </span>
    </div>
  </Show>
}
