import { basename } from "./path"
import { uid } from "./uid"

export type ComposerAttachment = {
  id: string
  filename: string
  mime: string
  kind: "file" | "directory"
  url: string
  label: string
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
}

export function extensionOf(name: string) {
  const idx = name.lastIndexOf(".")
  if (idx === -1) return ""
  return name.slice(idx + 1).toLowerCase()
}

export function mimeFromName(name: string, fallback = "text/plain") {
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
  const mime = file.type || mimeFromName(file.name, "application/octet-stream")
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
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

