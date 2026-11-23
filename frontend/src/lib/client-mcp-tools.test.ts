import { expect, it } from "vitest"
import { noteTools, readNotes, writeNotes } from "./client-mcp-tools"

it("stores and recalls notes per project directory", async () => {
  const values = new Map<string, string>()
  const read = (key: string) => values.get(key) ?? null
  const write = (key: string, value: string) => { values.set(key, value) }
  const [remember, recall] = noteTools("/tmp/project", { read, write })

  expect(await remember.run({ key: "preference", text: "用中文回答" })).toContain("preference")
  expect(readNotes("/tmp/project", read)).toEqual({ preference: "用中文回答" })
  expect(await recall.run({ key: "preference" })).toBe("用中文回答")
  expect(await recall.run({})).toContain("## preference")
  expect(await recall.run({ key: "missing" })).toContain("没有")

  writeNotes("/tmp/project", { a: "1", b: "2" }, write)
  expect(Object.keys(readNotes("/tmp/project", read)).sort()).toEqual(["a", "b"])
})
