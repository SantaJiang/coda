/** Detect printable output across chunks without counting PTY gate echoes or ANSI commands. */
export function createTerminalOutputProbe() {
  const decoder = new TextDecoder()
  let state: "text" | "escape" | "csi" | "string" | "stringEscape" = "text"
  return (data: string) => {
    const text = decoder.decode(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)), { stream: true })
    for (const char of text) {
      if (state === "stringEscape") { state = char === "\\" ? "text" : "string"; continue }
      if (state === "string") {
        if (char === "\x07") state = "text"
        else if (char === "\x1b") state = "stringEscape"
        continue
      }
      if (state === "csi") { if (char >= "@" && char <= "~") state = "text"; continue }
      if (state === "escape") {
        if (char === "[") state = "csi"
        else if ("]P^_X".includes(char)) state = "string"
        else if (char >= "0" && char <= "~") state = "text"
        continue
      }
      if (char === "\x1b") { state = "escape"; continue }
      if (char > " " && char !== "\x7f" && !/\s/.test(char)) return true
    }
    return false
  }
}
