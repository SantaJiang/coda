import { describe, expect, it } from "vitest"
import { cutAtRevert, revertDraftFromParts } from "./revert"
import type { Message, Part } from "./types"

function userMessage(id: string): Message {
  return { id, sessionID: "ses_1", role: "user", time: { created: 1 } }
}

function assistantMessage(id: string): Message {
  return { id, sessionID: "ses_1", role: "assistant", time: { created: 1 } }
}

describe("cutAtRevert", () => {
  const messages = [userMessage("msg_1"), assistantMessage("msg_2"), userMessage("msg_3"), assistantMessage("msg_4")]

  it("keeps everything without a revert state", () => {
    expect(cutAtRevert(messages, undefined)).toEqual(messages)
    expect(cutAtRevert(messages, null)).toEqual(messages)
  })

  it("hides the revert boundary message and everything after it", () => {
    expect(cutAtRevert(messages, { messageID: "msg_3" }).map((item) => item.id)).toEqual(["msg_1", "msg_2"])
  })

  it("keeps everything when the boundary message is unknown", () => {
    expect(cutAtRevert(messages, { messageID: "msg_missing" })).toEqual(messages)
  })
})

describe("revertDraftFromParts", () => {
  it("joins visible text parts and skips synthetic or ignored ones", () => {
    const parts: Part[] = [
      { id: "p1", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "修复登录" },
      { id: "p2", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "系统注入", synthetic: true },
      { id: "p3", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "被忽略", ignored: true },
      { id: "p4", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "并补测试" },
    ]
    expect(revertDraftFromParts(parts).text).toBe("修复登录\n\n并补测试")
    expect(revertDraftFromParts(parts).attachments).toEqual([])
  })

  it("restores file parts as composer attachments", () => {
    const parts: Part[] = [
      { id: "p1", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "看看这些文件" },
      {
        id: "p2",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "file",
        mime: "text/plain",
        filename: "notes.md",
        url: "file:///tmp/notes.md",
      },
      {
        id: "p3",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "file",
        mime: "application/x-directory",
        url: "file:///tmp/assets",
      },
      { id: "p4", sessionID: "ses_1", messageID: "msg_1", type: "file" },
    ]
    const draft = revertDraftFromParts(parts)
    expect(draft.text).toBe("看看这些文件")
    expect(draft.attachments).toHaveLength(2)
    expect(draft.attachments[0]).toMatchObject({
      filename: "notes.md",
      mime: "text/plain",
      kind: "file",
      url: "file:///tmp/notes.md",
      label: "Markdown",
    })
    expect(draft.attachments[1]).toMatchObject({
      filename: "assets",
      kind: "directory",
      label: "文件夹",
    })
  })
})
