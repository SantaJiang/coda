import { uid } from "./uid"
import type { Session } from "./types"

export type DraftContent = {
  composer?: string
  attachments?: unknown[]
}

export function isLocalDraft(session?: Session | null): boolean {
  return Boolean(session?.localDraft)
}

export function isEmptyDraftContent(composer?: string, attachments?: unknown[]): boolean {
  return !(composer ?? "").trim() && !(attachments && attachments.length > 0)
}

export function draftContentOf(bundle?: DraftContent | null) {
  return {
    composer: bundle?.composer ?? "",
    attachments: bundle?.attachments ?? [],
  }
}

export function isEmptyDraft(bundle?: DraftContent | null): boolean {
  const content = draftContentOf(bundle)
  return isEmptyDraftContent(content.composer, content.attachments)
}

export function draftSidebarTitle(composer?: string | null): string {
  const first = (composer ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(Boolean)
  return first || "新会话"
}

export function createLocalDraftSession(directory: string, now = Date.now(), id = uid("draft")): Session {
  return {
    id,
    directory,
    title: "新会话",
    localDraft: true,
    time: { created: now, updated: now },
  }
}

export function findEmptyDraft<T extends Session>(
  sessions: T[],
  bundles: Record<string, DraftContent | undefined>,
): T | undefined {
  return sessions.find((session) => isEmptyDraft(bundles[`session:${session.id}`]))
}

export function extraEmptyDraftIds(
  sessions: Session[],
  bundles: Record<string, DraftContent | undefined>,
  keepId: string,
): string[] {
  return sessions
    .filter((session) => session.id !== keepId && isEmptyDraft(bundles[`session:${session.id}`]))
    .map((session) => session.id)
}

export function newestDraft<T extends Session>(sessions: T[]): T | undefined {
  return [...sessions].sort((left, right) => (right.time?.updated ?? 0) - (left.time?.updated ?? 0))[0]
}

export function mergeSessionLists(drafts: Session[], history: Session[]): Session[] {
  return [...drafts, ...history].sort((left, right) => (right.time?.updated ?? 0) - (left.time?.updated ?? 0))
}
