import { describe, expect, it } from "vitest"
import { basename, isWithinPath, samePath } from "./path"

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

describe("isWithinPath", () => {
  it("matches the same path and descendants", () => {
    expect(isWithinPath("/Users/me/proj", "/Users/me/proj")).toBe(true)
    expect(isWithinPath("/Users/me/proj/sub", "/Users/me/proj")).toBe(true)
  })

  it("rejects siblings that only share a prefix", () => {
    expect(isWithinPath("/Users/me/proj2", "/Users/me/proj")).toBe(false)
    expect(isWithinPath("/Volumes/Movie/AV", "/Volumes/Movie/JK")).toBe(false)
  })

  it("normalizes Windows separators and drive case", () => {
    expect(isWithinPath("C:\\work\\app\\src", "c:/work/app")).toBe(true)
    expect(isWithinPath("C:\\work\\app2", "c:/work/app")).toBe(false)
  })
})
