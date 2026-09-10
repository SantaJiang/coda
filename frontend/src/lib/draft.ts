export function draftKey(sessionId: string | null | undefined, projectId: string | null | undefined) {
  if (sessionId) return `session:${sessionId}`
  return `draft:${projectId ?? "_"}`
}

export type DraftBundle = {
  composer: string
  attachments: unknown[]
}

export function emptyDraft<T>(attachments: T[] = []): { composer: string; attachments: T[] } {
  return { composer: "", attachments }
}
