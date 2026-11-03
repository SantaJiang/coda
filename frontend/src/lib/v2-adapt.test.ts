import { describe, expect, it } from "vitest"
import { translateWireEvent } from "./v2-events"
import { formToQuestion, shellOutputToLog, shellToTerminal, todosFromMessages, toTranscript, toV2Rules } from "./v2-map"

describe("v2 feature adapters", () => {
  it("reads the latest completed plan from the transcript", () => {
    expect(todosFromMessages([
      { type: "assistant", content: [{ type: "tool", name: "todowrite", state: { status: "completed", input: { todos: [{ content: "old", status: "pending" }] } } }] },
      { type: "assistant", content: [{ type: "tool", name: "todowrite", state: { status: "completed", input: { todos: [{ content: "build", status: "in_progress" }] } } }] },
    ])).toEqual([{ content: "build", status: "in_progress" }])
  })

  it("turns a question form into the dock request and a live event", () => {
    const form = {
      id: "frm_1",
      sessionID: "ses_1",
      metadata: { kind: "question" },
      fields: [{ key: "q0", type: "string", title: "方向", description: "选一个", custom: true, options: [{ label: "继续", description: "往下做" }] }],
    }
    expect(formToQuestion(form)?.questions[0]).toMatchObject({ header: "方向", question: "选一个", custom: true, options: [{ label: "继续" }] })
    const [event] = translateWireEvent({ type: "form.created", data: { form } })
    expect(event?.event.type).toBe("question.asked")
    expect(event?.event.properties).toMatchObject({ id: "frm_1", sessionID: "ses_1" })
  })

  it("keeps user files on the transcript and maps old permission names", () => {
    const transcript = toTranscript("ses_1", [{
      id: "msg_1",
      type: "user",
      text: "看这个",
      time: { created: 1 },
      files: [{ uri: "file:///tmp/a.png", name: "a.png", mime: "image/png" }],
    }])
    expect(transcript[0]?.parts.map((part) => part.type)).toEqual(["text", "file"])
    expect(toV2Rules([{ permission: "bash", pattern: "*", action: "ask" }])).toEqual([{ action: "shell", resource: "*", effect: "ask" }])
  })

  it("keeps a session shell visible with paged output", () => {
    const info = shellToTerminal({
      id: "sh_1",
      status: "running",
      command: "npm test",
      cwd: "/repo",
      metadata: { sessionID: "ses_1" },
      time: { started: 10 },
    }, "ses_1")
    expect(info).toMatchObject({ id: "sh_1", sessionID: "ses_1", command: "npm test", status: "running" })
    expect(shellToTerminal({ id: "sh_2", metadata: { sessionID: "other" }, time: { started: 1 } }, "ses_1")).toBeNull()
    const frame = shellOutputToLog({ output: "ok", cursor: 2, size: 2 }, 0, "completed")
    expect(frame.ended).toBe(true)
    expect(atob(frame.data)).toBe("ok")
  })
})
