import type { AppState } from "./state"

export type RequestKind = "permission" | "question"

export function resolveRequest(draft: AppState, kind: RequestKind, id: string, sessionID: string) {
  draft.resolvedRequests[`${kind}:${id}`] = sessionID
  if (kind === "permission") delete draft.permissions[id]
  else delete draft.questions[id]
}
