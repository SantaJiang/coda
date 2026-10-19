import { afterEach, describe, expect, it, vi } from "vitest"
import { attachmentFromBrowserFile, attachmentMime, MAX_ATTACHMENT_BYTES, preparePathAttachment, toFileUrl } from "./attachments"
import { attachmentModelError, inputFromMedia } from "./model-input"

const native = vi.hoisted(() => ({ active: false, invoke: vi.fn() }))
vi.mock("./platform-detect", () => ({ isTauri: () => native.active }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
afterEach(() => { native.active = false; native.invoke.mockReset() })
const bytes = (text: string) => new TextEncoder().encode(text)

describe("toFileUrl", () => {
  it("encodes a windows share as a host file url", () => {
    expect(toFileUrl("\\\\server\\share\\a.txt")).toBe("file://server/share/a.txt")
  })
  it("keeps a drive letter file url", () => {
    expect(toFileUrl("C:\\work\\a.txt")).toBe("file:///C:/work/a.txt")
  })
})

describe("attachment ingestion", () => {
  it("normalizes code, structured documents and unknown readable files into text", () => {
    for (const [name, mime] of [["data.json", "application/json"], ["index.ts", ""], ["settings.yaml", ""], ["icon.svg", "image/svg+xml"], ["LICENSE", "application/octet-stream"]]) {
      expect(attachmentMime(name, mime, bytes("中文 content"))).toBe("text/plain")
    }
    const endingMidCharacter = bytes("中文").subarray(0, 5)
    expect(attachmentMime("README", "", endingMidCharacter)).toBe("text/plain")
  })
  it("keeps supported media types and rejects opaque binary documents", () => {
    expect(attachmentMime("report.pdf", "", bytes("%PDF"))).toBe("application/pdf")
    expect(attachmentMime("capture.png", "", new Uint8Array([137, 80, 78, 71]))).toBe("image/png")
    expect(attachmentMime("voice.wav", "audio/x-wav", bytes("RIFF"))).toBe("audio/wav")
    expect(() => attachmentMime("archive.zip", "application/zip", new Uint8Array([80, 75, 3, 4, 0]))).toThrow("暂不支持")
    expect(() => attachmentMime("document.docx", "", new Uint8Array([80, 75, 3, 4, 0]))).toThrow()
    expect(() => attachmentMime("binary", "", new Uint8Array([255, 254]))).toThrow("UTF-8")
  })
  it("uses normalized MIME in browser payloads and rejects oversized input before reading", async () => {
    const file = { name: "data.json", type: "application/json", size: 2, arrayBuffer: async () => bytes("{}").buffer } as File
    const attachment = await attachmentFromBrowserFile(file)
    expect(attachment).toMatchObject({ mime: "text/plain", filename: "data.json", url: "data:text/plain;base64,e30=" })
    const read = vi.fn()
    await expect(attachmentFromBrowserFile({ ...file, size: MAX_ATTACHMENT_BYTES + 1, arrayBuffer: read })).rejects.toThrow("25 MiB")
    expect(read).not.toHaveBeenCalled()
  })
  it("saves pasted bytes natively and retains a supplied MIME when a filename has no extension", async () => {
    native.active = true
    native.invoke.mockImplementation(async (command) => command === "attachment_save" ? "/tmp/import/capture" : { directory: false, size: 4, sample: [137, 80, 78, 71] })
    const result = await attachmentFromBrowserFile({ name: "capture", type: "image/png", size: 4, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer } as File)
    expect(result).toMatchObject({ mime: "image/png", url: "file:///tmp/import/capture" })
    expect(native.invoke).toHaveBeenCalledWith("attachment_save", { filename: "capture", data: [137, 80, 78, 71] })
  })
  it("converts TIFF paths to a persistent PNG before the model sees them", async () => {
    native.invoke.mockImplementation(async (command) => command === "attachment_convert_image" ? "/tmp/import/scan.png" : { directory: false, size: 8, sample: [], preview: "data:image/png;base64,preview" })
    const result = await preparePathAttachment("/tmp/scan.tiff")
    expect(result).toMatchObject({ filename: "scan.png", mime: "image/png", url: "file:///tmp/import/scan.png", preview: "data:image/png;base64,preview" })
    expect(native.invoke).toHaveBeenCalledWith("attachment_convert_image", { path: "/tmp/scan.tiff" })
  })
})

describe("model input validation", () => {
  it("allows text for text models and requires declared media input", () => {
    expect(attachmentModelError([{ filename: "code.ts", mime: "text/plain" }])).toBe("")
    expect(attachmentModelError([{ filename: "scan.png", mime: "image/png" }])).toContain("图片")
    expect(attachmentModelError([{ filename: "scan.png", mime: "image/png" }, { filename: "book.pdf", mime: "application/pdf" }], inputFromMedia(["image", "pdf"]))).toBe("")
  })
  it("checks the actual adapter limits as well as model capabilities", () => {
    const input = inputFromMedia(["audio", "video"])
    expect(attachmentModelError([{ filename: "voice.mp3", mime: "audio/mpeg" }], input)).toBe("")
    expect(attachmentModelError([{ filename: "voice.flac", mime: "audio/flac" }], input)).toContain("MP3 或 WAV")
    expect(attachmentModelError([{ filename: "video.mp4", mime: "video/mp4" }], input)).toContain("无法发送")
    expect(attachmentModelError([{ filename: "video.mp4", mime: "video/mp4" }], input, "@ai-sdk/google")).toBe("")
  })
})
