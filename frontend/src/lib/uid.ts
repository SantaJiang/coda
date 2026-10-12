export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

let lastTime = 0
let sequence = 0
/** Matches the backend's sortable message/part IDs so optimistic IDs survive acknowledgement. */
export function ascendingID(prefix: "msg" | "prt") {
  const now = Math.max(Date.now(), lastTime)
  sequence = now === lastTime ? sequence + 1 : 1
  lastTime = now
  if (sequence >= 4096) { lastTime++; sequence = 1 }
  const encoded = (BigInt(lastTime) * 4096n + BigInt(sequence)).toString(16).padStart(12, "0")
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  return `${prefix}_${encoded}${Array.from(bytes, (byte) => chars[byte % chars.length]).join("")}`
}
