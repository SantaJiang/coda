import { produce } from "solid-js/store"
import { autoReplyForMode, rulesetForProject, type PermissionMode } from "../lib/permissions"
import { projectByPath } from "./lookup"
import { reportError, selectedProjectOf, type StoreHandle } from "./handle"

export async function applySessionPermission(
  handle: StoreHandle,
  directory: string,
  sessionID: string,
  mode = handle.state.permissionMode,
) {
  const project = projectByPath(handle.state, directory) ?? selectedProjectOf(handle.state)
  await handle.client.updateSessionPermission(directory, sessionID, rulesetForProject(project, mode))
}

export async function autoReplyPending(handle: StoreHandle, mode: PermissionMode, sessionID?: string) {
  const project = selectedProjectOf(handle.state)
  if (!project) return
  const pending = Object.values(handle.state.permissions).filter(
    (item) => item && (!sessionID || item.sessionID === sessionID),
  )
  for (const item of pending) {
    const reply = autoReplyForMode(mode, item.permission)
    if (!reply) continue
    try {
      await handle.client.replyPermission(project.path, item.id, reply)
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
