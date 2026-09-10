export function formatSessionTitle(title?: string | null) {
  const value = title?.trim() || "未命名会话"
  return value.replace(/^New session.*$/i, "新会话")
}
