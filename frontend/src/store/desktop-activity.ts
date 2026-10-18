import { createEffect } from "solid-js"
import { reportDesktopActivity } from "../lib/desktop"
import type { AppState } from "./state"

type ActivityState = Pick<AppState, "status" | "sendingBySession" | "outgoing" | "messages" | "permissions" | "questions">

export function hasDesktopActivity(state: ActivityState) {
  return Object.values(state.status).some((status) => status.type !== "idle")
    || Object.values(state.sendingBySession).some(Boolean)
    // A lost acknowledgement may still be running; a definitively failed send is idle.
    || Object.values(state.outgoing).some((item) => (state.messages[item.sessionID] ?? []).some((message) => message.id === item.messageID && message.role === "user" && message.delivery === "uncertain"))
    || Object.keys(state.permissions).length > 0
    || Object.keys(state.questions).length > 0
}

export function trackDesktopActivity(state: ActivityState) {
  createEffect(() => { void reportDesktopActivity(hasDesktopActivity(state)) })
}
