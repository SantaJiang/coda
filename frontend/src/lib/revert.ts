import { typeLabel, type ComposerAttachment } from "./attachments"
import { basename } from "./path"
import type { FilePart, Message, Part, SessionRevertState, TextPart } from "./types"
import { uid } from "./uid"

export function cutAtRevert(messages: Message[], revert?: SessionRevertState | null): Message[] {
  if (!revert?.messageID) return messages
  const index = messages.findIndex((message) => message.id === revert.messageID)
  if (index === -1) return messages
  return messages.slice(0, index)
}

function filenameOf(part: FilePart) {
  if (part.filename) return part.filename
  const url = part.url ?? ""
  const plain = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[?#].*$/, "")
  return plain ? decodeURIComponent(basename(plain)) : "附件"
}

export function revertDraftFromParts(parts: Part[]): { text: string; attachments: ComposerAttachment[] } {
  const text = parts
    .filter((part): part is TextPart => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .join("\n\n")
  const attachments: ComposerAttachment[] = []
  for (const part of parts) {
    if (part.type !== "file" || !part.url) continue
    const kind = part.mime === "application/x-directory" ? "directory" : "file"
    const filename = filenameOf(part)
    const mime = part.mime || "text/plain"
    attachments.push({ id: uid("att"), filename, mime, kind, url: part.url, label: typeLabel(filename, kind, mime) })
  }
  return { text, attachments }
}
