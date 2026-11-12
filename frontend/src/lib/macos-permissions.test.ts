import { afterEach, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import {
  macPermissionStatus,
  openMacPermissionSettings,
  requestMacScreenRecording,
  restartCoda,
} from "./macos-permissions"

const { available } = vi.hoisted(() => ({ available: { value: true } }))

vi.mock("./platform", () => ({
  isTauri: () => available.value,
  isMacPlatform: () => available.value,
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
afterEach(() => {
  available.value = true
  vi.clearAllMocks()
})

it("reports unsupported outside the macOS desktop app without invoking native code", async () => {
  available.value = false
  expect(await macPermissionStatus()).toEqual({
    supported: false,
    fullDiskAccess: false,
    screenRecording: false,
  })
  expect(await openMacPermissionSettings("fullDiskAccess")).toBe(false)
  expect(await requestMacScreenRecording()).toBe(false)
  await restartCoda()
  expect(invoke).not.toHaveBeenCalled()
})

it("maps the native permission status", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    supported: true,
    fullDiskAccess: true,
    screenRecording: false,
  })
  expect(await macPermissionStatus()).toEqual({
    supported: true,
    fullDiskAccess: true,
    screenRecording: false,
  })
  expect(invoke).toHaveBeenCalledWith("macos_permission_status", undefined)
})

it("falls back to unsupported when the native status check fails", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"))
  expect((await macPermissionStatus()).supported).toBe(false)
})

it("opens the requested privacy pane", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(undefined)
  expect(await openMacPermissionSettings("screenRecording")).toBe(true)
  expect(invoke).toHaveBeenCalledWith("macos_open_permission_settings", { pane: "screenRecording" })
})

it("requests screen recording access and reports the result", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(true)
  expect(await requestMacScreenRecording()).toBe(true)
  expect(invoke).toHaveBeenCalledWith("macos_request_screen_recording", undefined)
})

it("restarts through the native command", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(undefined)
  await restartCoda()
  expect(invoke).toHaveBeenCalledWith("macos_restart", undefined)
})