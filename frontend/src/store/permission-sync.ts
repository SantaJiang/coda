import { produce } from "solid-js/store"
import { isLocalDraft } from "../lib/draft-session"
import { autoReplyForMode, rulesetForProject, type PermissionMode } from "../lib/permissions"
import { isSessionBusy } from "../lib/session-status"
import { projectByPath } from "./lookup"
import { reportError, selectedProjectOf, selectedSessionOf, type StoreHandle } from "./handle"

export async function applySessionPermission(
  handle: StoreHandle,
  directory: string,
  sessionID: string,
  mode = handle.state.permissionMode,
) {
  const project = projectByPath(handle.state, directory) ?? selectedProjectOf(handle.state)
  await handle.client.updateSessionPermission(directory, sessionID, rulesetForProject(project, mode))
}

function sessionDirectory(handle: StoreHandle, sessionID: string) {
  for (const [path, sessions] of Object.entries(handle.state.sessionsByProject)) {
    const found = sessions.find((item) => item.id === sessionID)
    if (found) return found.directory || path
  }
  return selectedProjectOf(handle.state)?.path
}

export async function pushPermissionMode(handle: StoreHandle, mode: PermissionMode) {
  const targets = new Map<string, string>()
  const selected = selectedSessionOf(handle.state)
  const project = selectedProjectOf(handle.state)
  if (selected && project && !isLocalDraft(selected)) targets.set(selected.id, project.path)
  for (const [path, sessions] of Object.entries(handle.state.sessionsByProject)) {
    for (const session of sessions) {
      if (isLocalDraft(session) || targets.has(session.id)) continue
      const waiting = Object.values(handle.state.permissions).some((item) => item?.sessionID === session.id)
      if (!isSessionBusy(handle.state.status[session.id]) && !waiting) continue
      targets.set(session.id, session.directory || path)
    }
  }
  for (const [sessionID, directory] of targets) {
    await applySessionPermission(handle, directory, sessionID, mode)
  }
  await autoReplyPending(handle, mode)
}

export async function autoReplyPending(handle: StoreHandle, mode: PermissionMode, sessionID?: string) {
  const pending = Object.values(handle.state.permissions).filter(
    (item) => item && (!sessionID || item.sessionID === sessionID),
  )
  for (const item of pending) {
    const reply = autoReplyForMode(mode, item.permission)
    if (!reply) continue
    const directory = sessionDirectory(handle, item.sessionID)
    if (!directory) continue
    try {
      await handle.client.replyPermission(directory, item.id, reply)
      handle.setState(
        produce((draft) => {
          delete draft.permissions[item.id]
        }),
      )
    } catch (error) {
      reportError(handle, error, "自动授权失败")
    }
  }
}
