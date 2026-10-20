import { expect, it } from "vitest"
import { createTerminalOutputProbe } from "./terminal-output"

it("ignores whitespace, gate echoes, and split ANSI control sequences until real output arrives", () => {
  const read = createTerminalOutputProbe()
  expect(read(btoa('\r\n \t\x07'))).toBe(false)
  expect(read(btoa('\x1b[?25'))).toBe(false)
  expect(read(btoa('l\x1b[31m\x1b[0m'))).toBe(false)
  expect(read(btoa('\x1b]0;hidden window title'))).toBe(false)
  expect(read(btoa('\x1b'))).toBe(false)
  expect(read(btoa('\\\r\n'))).toBe(false)
  expect(read(btoa('download 10%'))).toBe(true)
})
it("detects unicode progress split across UTF-8 frames", () => {
  const read = createTerminalOutputProbe()
  const bytes = new TextEncoder().encode('进度')
  expect(read(btoa(String.fromCharCode(bytes[0])))).toBe(false)
  expect(read(btoa(String.fromCharCode(...bytes.slice(1))))).toBe(true)
})
