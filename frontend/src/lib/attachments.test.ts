import { describe, expect, it } from "vitest"
import { toFileUrl } from "./attachments"

describe("toFileUrl", () => {
  it("encodes a windows share as a host file url", () => {
    expect(toFileUrl("\\\\server\\share\\a.txt")).toBe("file://server/share/a.txt")
  })

  it("keeps a drive letter file url", () => {
    expect(toFileUrl("C:\\work\\a.txt")).toBe("file:///C:/work/a.txt")
  })
})
