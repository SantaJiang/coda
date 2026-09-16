import { describe, expect, it } from "vitest"
import { isNewlineHotkey, isSendHotkey } from "./settings"

function enterKey(init: Partial<KeyboardEvent> = {}) {
  return {
    key: "Enter",
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent
}

describe("isSendHotkey", () => {
  it("sends on enter and shift+enter when enter is the shortcut", () => {
    expect(isSendHotkey(enterKey(), "enter")).toBe(true)
    expect(isSendHotkey(enterKey({ shiftKey: true }), "enter")).toBe(true)
  })

  it("leaves mod+enter for the newline when enter is the shortcut", () => {
    expect(isSendHotkey(enterKey({ metaKey: true }), "enter")).toBe(false)
    expect(isSendHotkey(enterKey({ ctrlKey: true }), "enter")).toBe(false)
  })

  it("sends only on mod+enter when mod-enter is the shortcut", () => {
    expect(isSendHotkey(enterKey({ metaKey: true }), "mod-enter")).toBe(true)
    expect(isSendHotkey(enterKey({ ctrlKey: true }), "mod-enter")).toBe(true)
    expect(isSendHotkey(enterKey(), "mod-enter")).toBe(false)
    expect(isSendHotkey(enterKey({ shiftKey: true }), "mod-enter")).toBe(false)
  })

  it("ignores other keys, alt combos and composing input", () => {
    expect(isSendHotkey(enterKey({ key: "a" }), "enter")).toBe(false)
    expect(isSendHotkey(enterKey({ altKey: true }), "enter")).toBe(false)
    expect(isSendHotkey(enterKey({ isComposing: true }), "enter")).toBe(false)
    expect(isSendHotkey(enterKey({ metaKey: true, isComposing: true }), "mod-enter")).toBe(false)
  })
})

describe("isNewlineHotkey", () => {
  it("needs a manual newline only for mod+enter when enter is the shortcut", () => {
    expect(isNewlineHotkey(enterKey({ metaKey: true }), "enter")).toBe(true)
    expect(isNewlineHotkey(enterKey({ ctrlKey: true }), "enter")).toBe(true)
    expect(isNewlineHotkey(enterKey(), "enter")).toBe(false)
    expect(isNewlineHotkey(enterKey({ shiftKey: true }), "enter")).toBe(false)
  })

  it("lets the textarea handle newlines natively when mod-enter is the shortcut", () => {
    expect(isNewlineHotkey(enterKey(), "mod-enter")).toBe(false)
    expect(isNewlineHotkey(enterKey({ metaKey: true }), "mod-enter")).toBe(false)
  })
})
