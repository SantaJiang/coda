import { describe, expect, it } from "vitest"
import { basename, samePath } from "./path"

describe("samePath", () => {
  it("treats trailing slashes as the same path", () => {
    expect(samePath("/Users/me/proj", "/Users/me/proj/")).toBe(true)
  })

  it("normalizes Windows slashes and drive letter case", () => {
    expect(samePath("C:\\Users\\me\\proj", "c:/Users/me/proj")).toBe(true)
  })

  it("keeps POSIX paths case-sensitive", () => {
    expect(samePath("/Users/Me/proj", "/Users/me/proj")).toBe(false)
  })
})

describe("basename", () => {
  it("returns the last segment", () => {
    expect(basename("/Users/me/coda")).toBe("coda")
    expect(basename("C:\\work\\app")).toBe("app")
  })
})
