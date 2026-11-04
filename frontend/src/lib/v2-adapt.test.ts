import { describe, expect, it } from "vitest"
import { translateWireEvent } from "./v2-events"
import { conversationTurns } from "./conversation"
import { formToQuestion, sessionStatuses, shellOutputToLog, shellToTerminal, todosFromMessages, toTranscript, toV2Rules } from "./v2-map"

describe("v2 feature adapters", () => {
  it("treats finished outcomes as idle even when busy stamps are newer", () => {
    expect(sessionStatuses([{
      id: "ses_1",
      outcome: "interrupted",
      time: { created: 1, updated: 3, busy: 3, idle: 2 },
    }]).ses_1).toEqual({ type: "idle" })
    expect(sessionStatuses([{
      id: "ses_2",
      time: { created: 1, updated: 3, busy: 3, idle: 2 },
    }]).ses_2).toEqual({ type: "busy" })
  })

  it("keeps reasoning collapsed by giving it the v1 start and end times", () => {
    const started = translateWireEvent({ type: "session.reasoning.started", data: { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0 } })
    const part = (started[1]?.event.properties?.part ?? {}) as { type?: string; time?: { start?: number; end?: number } }
    expect(part.type).toBe("reasoning")
    expect(part.time?.start).toEqual(expect.any(Number))
    expect(part.time?.end).toBeUndefined()
    const [ended] = translateWireEvent({ type: "session.reasoning.ended", data: { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0, text: "先看结构" } })
    const done = (ended?.event.properties?.part ?? {}) as { type?: string; text?: string; time?: { end?: number } }
    expect(done).toMatchObject({ type: "reasoning", text: "先看结构" })
    expect(done.time?.end).toEqual(expect.any(Number))
  })

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

  it("keeps interrupt errors identifiable instead of an empty failure blob", () => {
    const [row] = toTranscript("ses_1", [{
      id: "msg_a",
      type: "assistant",
      finish: "error",
      error: { type: "aborted", message: "Step interrupted" },
      time: { created: 1, completed: 2 },
      content: [{ type: "text", text: "half" }],
    }])
    expect(row?.info).toMatchObject({
      role: "assistant",
      finish: "error",
      error: { name: "MessageAbortedError", data: { message: "Step interrupted" } },
    })
    expect(row?.parts[0]).toMatchObject({ type: "text", text: "half" })
  })

  it("keeps directory instructions on the original turn instead of a new question", () => {
    const transcript = toTranscript("ses_1", [
      { id: "u1", type: "user", text: "帮我看这个报错", time: { created: 1 } },
      { id: "a1", type: "assistant", finish: "tool-calls", time: { created: 2, completed: 3 }, content: [{ type: "tool", name: "read", state: { status: "completed", input: { filePath: "src/app.ts" } } }] },
      { id: "syn", type: "synthetic", text: "Instructions from: /repo/AGENTS.md\n# guide", description: "Loaded AGENTS.md", time: { created: 4 } },
      { id: "sys", type: "system", text: "Instructions updated body", description: "Instructions updated: AGENTS.md", time: { created: 5 } },
      { id: "a2", type: "assistant", finish: "stop", time: { created: 6, completed: 7 }, content: [{ type: "text", text: "原因在版本号" }] },
    ])
    expect(transcript.find((row) => row.info.id === "syn")?.parts[0]).toMatchObject({ type: "text", synthetic: true })
    expect(transcript.find((row) => row.info.id === "sys")?.parts[0]).toMatchObject({ type: "text", synthetic: true })
    expect(transcript.find((row) => row.info.id === "u1")?.parts[0]).toMatchObject({ type: "text", text: "帮我看这个报错" })
    expect(transcript.find((row) => row.info.id === "u1")?.parts[0]).not.toHaveProperty("synthetic")
    const parts = Object.fromEntries(transcript.map((row) => [row.info.id, row.parts]))
    const turns = conversationTurns(transcript.map((row) => row.info), parts, { status: { type: "idle" } })
    expect(turns).toHaveLength(1)
    expect(turns[0]?.id).toBe("u1")
    expect(turns[0]?.assistants.map((message) => message.id)).toEqual(["a1", "a2"])
    expect(turns[0]?.entries.some((entry) => entry.kind === "part" && entry.part.type === "text" && entry.part.text.includes("Instructions from"))).toBe(false)
    expect(turns[0]?.answer.map((entry) => entry.kind === "part" && entry.part.type === "text" ? entry.part.text : "")).toEqual(["原因在版本号"])
    expect(turns[0]?.phase).toBe("done")
    expect(turns[0]?.label).not.toBe("回复已中断")
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
