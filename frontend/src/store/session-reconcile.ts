import { produce } from "solid-js/store"
import { applySessionSnapshot, captureSessionSnapshot, readSessionSnapshot } from "./session-snapshot"
import type { StoreHandle } from "./handle"

/** Reconcile the idle boundary before allowing final grouping or queue advancement. */
export async function reconcileSession(handle: StoreHandle, sessionID: string, directory: string) {
  const { state, setState, client } = handle
  if (state.removedSessions[sessionID]) return
  const before = captureSessionSnapshot(state, sessionID)
  const snapshot = await readSessionSnapshot(client, directory, sessionID, true)
  if (state.removedSessions[sessionID]) return
  const todoListUnchanged = state.todos[sessionID] === before.todoListBefore
  setState(produce((draft) => applySessionSnapshot(draft, sessionID, before, snapshot, { mode: "idle", todoListUnchanged })))
}
