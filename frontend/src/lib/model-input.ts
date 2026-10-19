export const INPUT_MEDIA = ["image", "pdf", "audio", "video"] as const
export type InputMedia = typeof INPUT_MEDIA[number]
export type ModelInput = Partial<Record<InputMedia | "text", boolean>>
export const INPUT_LABELS: Record<InputMedia, string> = { image: "图片", pdf: "PDF", audio: "音频", video: "视频" }

export function parseInputMedia(value: unknown): InputMedia[] | undefined {
  if (!Array.isArray(value)) return undefined
  return INPUT_MEDIA.filter((type) => value.includes(type))
}

export function mediaInput(mime: string): InputMedia | undefined {
  if (mime === "application/pdf") return "pdf"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
}

export function inputFromMedia(types: InputMedia[]): ModelInput {
  return { text: true, ...Object.fromEntries(INPUT_MEDIA.map((type) => [type, types.includes(type)])) }
}

export const COMPATIBLE_ADAPTER = "@ai-sdk/openai-compatible"

export function attachmentModelError(files: { filename: string; mime: string }[], input?: ModelInput, adapter = COMPATIBLE_ADAPTER) {
  if (adapter === COMPATIBLE_ADAPTER) {
    const rejected = files.filter((file) => file.mime.startsWith("video/") || (file.mime.startsWith("audio/") && !["audio/wav", "audio/mpeg", "audio/mp3"].includes(file.mime)))
    if (rejected.length) return `当前兼容接口无法发送这些媒体格式：${rejected.map((file) => file.filename).join("、")}。音频请使用 MP3 或 WAV；视频请先提取为图片或文本。`
  }
  const unsupported = files.filter((file) => { const type = mediaInput(file.mime); return type && !input?.[type] })
  if (!unsupported.length) return ""
  return `当前模型未启用 ${[...new Set(unsupported.map((file) => INPUT_LABELS[mediaInput(file.mime)!]))].join("、")} 输入：${unsupported.map((file) => file.filename).join("、")}。请切换支持的模型，或在模型设置中核对附件能力。`
}
