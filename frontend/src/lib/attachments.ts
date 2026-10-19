import { basename } from "./path"
import { uid } from "./uid"
import { isTauri } from "./platform-detect"

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const TEXT_TYPES = new Set(["application/json", "application/ld+json", "application/xml", "application/yaml", "application/x-yaml", "application/toml", "application/x-toml", "image/svg+xml"])

export type ComposerAttachment = {
  id: string
  filename: string
  mime: string
  kind: "file" | "directory"
  url: string
  label: string
  preview?: string
}

const EXT_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  md: "Markdown",
  css: "CSS",
  html: "HTML",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  rb: "Ruby",
  php: "PHP",
  sh: "Shell",
  zsh: "Shell",
  bash: "Shell",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  xml: "XML",
  txt: "Text",
  csv: "CSV",
  svg: "SVG",
  png: "PNG",
  jpg: "JPEG",
  jpeg: "JPEG",
  gif: "GIF",
  webp: "WEBP",
  pdf: "PDF",
  zip: "ZIP",
}

const EXT_MIME: Record<string, string> = {
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  json: "application/json",
  md: "text/plain",
  css: "text/plain",
  html: "text/html",
  py: "text/plain",
  rs: "text/plain",
  go: "text/plain",
  txt: "text/plain",
  csv: "text/plain",
  yml: "text/plain",
  yaml: "text/plain",
  toml: "text/plain",
  xml: "text/plain",
  sh: "text/plain",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
  mjs: "text/plain", cjs: "text/plain", zsh: "text/plain", bash: "text/plain",
  java: "text/plain", kt: "text/plain", swift: "text/plain", rb: "text/plain", php: "text/plain",
  log: "text/plain", ini: "text/plain", conf: "text/plain", sql: "text/plain", c: "text/plain", cpp: "text/plain", h: "text/plain",
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", aac: "audio/aac", m4a: "audio/mp4", opus: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mpeg: "video/mpeg",
}

export function extensionOf(name: string) {
  const idx = name.lastIndexOf(".")
  if (idx === -1) return ""
  return name.slice(idx + 1).toLowerCase()
}

export function mimeFromName(name: string, fallback = "application/octet-stream") {
  return EXT_MIME[extensionOf(name)] || fallback
}

export function typeLabel(name: string, kind: "file" | "directory", mime?: string) {
  if (kind === "directory") return "文件夹"
  const ext = extensionOf(name)
  if (ext && EXT_LABELS[ext]) return EXT_LABELS[ext]
  if (mime?.startsWith("image/")) return mime.slice(6).toUpperCase()
  if (mime && mime !== "application/octet-stream" && mime !== "text/plain") return mime
  if (ext) return ext.toUpperCase()
  return "文件"
}

export function toFileUrl(path: string) {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.startsWith("//")) {
    const encoded = normalized
      .slice(2)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")
    return `file://${encoded}`
  }
  const abs = /^[A-Za-z]:/.test(normalized)
    ? `/${normalized}`
    : normalized.startsWith("/")
      ? normalized
      : `/${normalized}`
  const encoded = abs
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ":"))
    .join("/")
  return `file://${encoded}`
}

export function attachmentFromPath(path: string, kind: "file" | "directory"): ComposerAttachment {
  const filename = basename(path)
  const mime = kind === "directory" ? "application/x-directory" : mimeFromName(filename)
  return {
    id: uid("att"),
    filename,
    mime,
    kind,
    url: toFileUrl(path),
    label: typeLabel(filename, kind, mime),
  }
}

export async function attachmentFromBrowserFile(file: File): Promise<ComposerAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} 超过单个附件 25 MiB 的上限`)
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const mime = attachmentMime(file.name, file.type, bytes.subarray(0, 4096))
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core")
    const path = await invoke<string>("attachment_save", { filename: file.name, data: Array.from(bytes) })
    return preparePathAttachment(path, "file", mime)
  }
  if (["image/tiff", "image/bmp"].includes(mime)) throw new Error("此图片格式需要在桌面客户端中转换为 PNG")
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return {
    id: uid("att"),
    filename: file.name,
    mime,
    kind: "file",
    url: `data:${mime};base64,${btoa(binary)}`,
    label: typeLabel(file.name, "file", mime),
  }
}

/** Match upstream: PDF/media retain their MIME; readable source and text become text/plain. */
export function attachmentMime(name: string, type: string, sample: Uint8Array) {
  const mime = type.split(";", 1)[0].trim().toLowerCase()
  const inferred = mimeFromName(name)
  const candidate = (!mime || mime === "application/octet-stream") ? inferred : mime
  if (["image/png", "image/jpeg", "image/gif", "image/webp", "image/tiff", "image/bmp", "application/pdf"].includes(candidate)) return candidate
  if (candidate === "audio/x-wav") return "audio/wav"
  if (candidate.startsWith("audio/") || candidate.startsWith("video/")) return candidate
  if (candidate.startsWith("text/") || TEXT_TYPES.has(candidate) || candidate.endsWith("+json") || candidate.endsWith("+xml")) return "text/plain"
  // Inspect unknown files instead of passing compressed/Office/binary bytes off as text.
  let control = 0
  for (const byte of sample) {
    if (byte === 0) throw new Error(`暂不支持直接读取 ${name}，请转换为文本、PDF 或模型支持的媒体格式`)
    if (byte < 9 || (byte > 13 && byte < 32)) control++
  }
  if (sample.length && control / sample.length > 0.3) throw new Error(`暂不支持直接读取 ${name}，请转换为文本或 PDF`)
  // A sample may end halfway through a UTF-8 sequence.
  try { new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true }) }
  catch { throw new Error(`${name} 不是支持的 UTF-8 文本或媒体文件`) }
  return "text/plain"
}

export async function preparePathAttachment(path: string, kind: "file" | "directory" = "file", mimeHint = ""): Promise<ComposerAttachment> {
  const { invoke } = await import("@tauri-apps/api/core")
  const info = await invoke<{ directory: boolean; size: number; sample: number[]; preview?: string }>("attachment_inspect", { path })
  if (kind === "directory" || info.directory) return attachmentFromPath(path, "directory")
  if (info.size > MAX_ATTACHMENT_BYTES) throw new Error(`${basename(path)} 超过单个附件 25 MiB 的上限`)
  const mime = attachmentMime(basename(path), mimeHint, new Uint8Array(info.sample))
  if (["image/tiff", "image/bmp"].includes(mime)) {
    const converted = await invoke<string>("attachment_convert_image", { path })
    return preparePathAttachment(converted)
  }
  return { ...attachmentFromPath(path, "file"), mime, label: typeLabel(basename(path), "file", mime), preview: info.preview }
}

export async function clipboardAttachments(includeImage: boolean) {
  if (!isTauri()) return []
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<string[]>("attachment_clipboard", { includeImage })
}

