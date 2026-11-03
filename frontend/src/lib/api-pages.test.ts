import { afterEach, expect, it, vi } from "vitest"
import { listMessages, listSessions } from "./api"

afterEach(() => vi.unstubAllGlobals())

it("follows session and message cursors instead of keeping only the first page", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(String(input))
    if (url.pathname === "/api/session") {
      const cursor = url.searchParams.get("cursor")
      const data = cursor ? [{ id: "ses_old", title: "更早", time: { created: 1, updated: 1 }, location: { directory: "/repo" } }] : [{ id: "ses_new", title: "最新", time: { created: 2, updated: 2 }, location: { directory: "/repo" } }]
      return new Response(JSON.stringify({ data, cursor: cursor ? {} : { next: "page-2" } }))
    }
    const cursor = url.searchParams.get("cursor")
    const data = cursor
      ? [{ id: "msg_1", type: "user", text: "前一句", time: { created: 1 } }]
      : [{ id: "msg_2", type: "user", text: "后一句", time: { created: 2 } }]
    return new Response(JSON.stringify({ data, cursor: cursor ? {} : { next: "msg-2" } }))
  }))
  expect((await listSessions("/repo")).map((session) => session.id)).toEqual(["ses_new", "ses_old"])
  expect((await listMessages("/repo", "ses_new")).map((message) => message.info.id)).toEqual(["msg_1", "msg_2"])
})
