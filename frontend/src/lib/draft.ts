export function draftKey(sessionId: string | null | undefined, projectId: string | null | undefined) {
  if (sessionId) return `session:${sessionId}`
  return `draft:${projectId ?? "_"}`
}
