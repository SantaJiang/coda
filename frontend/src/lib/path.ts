function pathParts(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean)
}

export function basename(path: string) {
  const parts = pathParts(path)
  return parts[parts.length - 1] || path
}

function normalizeSlashes(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "")
}

function isWindowsPath(path: string) {
  return /^[A-Za-z]:/.test(path) || path.startsWith("//")
}

function canonWindows(path: string) {
  return path.replace(/^([A-Za-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`).toLowerCase()
}

export function samePath(left: string, right: string) {
  const a = normalizeSlashes(left)
  const b = normalizeSlashes(right)
  if (isWindowsPath(a) || isWindowsPath(b)) return canonWindows(a) === canonWindows(b)
  return a === b
}

export function isWithinPath(child: string, parent: string) {
  if (samePath(child, parent)) return true
  const a = normalizeSlashes(child)
  const b = normalizeSlashes(parent)
  if (isWindowsPath(a) || isWindowsPath(b)) return canonWindows(a).startsWith(`${canonWindows(b)}/`)
  return a.startsWith(`${b}/`)
}

export function parentSegments(path: string, depth: number) {
  const parts = pathParts(path)
  if (parts.length <= 1) return ""
  const start = Math.max(0, parts.length - 1 - depth)
  return parts.slice(start, -1).join("/")
}
