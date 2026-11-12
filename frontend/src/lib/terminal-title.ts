import type { MessageWithParts, Part, ToolPart } from "./types"

const SHELL_TOOLS = new Set(["bash", "shell", "shell_wait", "shell_status", "shell_cancel"])

function isShellTool(name: string) {
  return SHELL_TOOLS.has(name.toLowerCase())
}

function looksLikeRawShell(text: string) {
  const compact = text.replace(/\s+/g, " ").trim()
  if (/[|;&<>]|&&|\|\||\$\(|`/.test(compact)) return true
  if (/^\S+\s+-{1,2}\S/.test(compact)) return true
  return /^(?:sudo\s+)?(?:npm|pnpm|yarn|bunx?|deno|cargo|go|git|docker|podman|kubectl|helm|make|cmake|xcodebuild|pkill|killall|kill|chmod|curl|wget|ssh|scp|rsync|python\d*|node|ruby|perl|bash|sh|zsh)\b/i.test(compact)
}

function visibleText(part: Part) {
  if (part.type !== "text" || part.synthetic || part.ignored) return ""
  return part.text.trim()
}

function cleanHint(raw: string) {
  let text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return ""
  text = text.replace(/^[-+•]\s*/, "")
  // The sentence closest to the tool call is usually the reason it was run.
  const sentences = text.split(/(?<=[。！？])\s*|(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean)
  text = (sentences[sentences.length - 1] ?? text)
    .replace(/^(?:okay|ok|alright|now|next|then|so)[,，:：]?\s+/i, "")
    .replace(/^(?:let me|let's|i'll|i will|i'm going to|i am going to|we'll|we will|we're going to|we are going to)\s+/i, "")
    .replace(/[.。!！?？:：]+$/, "")
    .trim()
  if (!text || looksLikeRawShell(text)) return ""
  if (/^[a-z]/.test(text)) text = text[0].toUpperCase() + text.slice(1)
  return text.length > 72 ? `${text.slice(0, 71)}…` : text
}

function shellID(part: ToolPart) {
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata) {
    for (const key of ["shellID", "terminalID"] as const) {
      const value = metadata[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  return part.tool.toLowerCase() === "shell" && part.id.startsWith("sh_") ? part.id : ""
}

function isRealUserTurn(message: MessageWithParts) {
  return message.info.role === "user" && message.parts.some((part) => visibleText(part))
}

function hintBefore(messages: MessageWithParts[], messageIndex: number, partIndex: number) {
  const parts = messages[messageIndex].parts
  for (let index = partIndex - 1; index >= 0; index--) {
    const hint = cleanHint(visibleText(parts[index]))
    if (hint) return hint
  }
  // Shell tools can span several assistant steps. Walk back through synthetic
  // tool-result rows until the actual user instruction that started the turn.
  for (let index = messageIndex - 1; index >= 0; index--) {
    const message = messages[index]
    if (isRealUserTurn(message)) break
    for (let part = message.parts.length - 1; part >= 0; part--) {
      const hint = cleanHint(visibleText(message.parts[part]))
      if (hint) return hint
    }
  }
  return ""
}

/** Map shell IDs to the intent the assistant stated right before starting them. */
export function terminalGoalHints(messages: MessageWithParts[]) {
  const goals = new Map<string, string>()
  messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      if (part.type !== "tool" || !isShellTool(part.tool)) return
      const id = shellID(part)
      if (!id || goals.has(id)) return
      const input = part.state.input ?? {}
      const described = typeof input.description === "string" ? cleanHint(input.description) : ""
      const titled = "title" in part.state && part.state.title ? cleanHint(String(part.state.title)) : ""
      const command = cleanHint(String(input.command ?? ""))
      const hint = described || (titled && titled !== command ? titled : "") || hintBefore(messages, messageIndex, partIndex)
      if (hint) goals.set(id, hint)
    })
  })
  return goals
}

function commandPhrase(script: string) {
  const name = script.toLowerCase()
  if (/\b(test|tests|spec|vitest|jest|pytest|mocha|e2e)\b/.test(name)) return "运行测试并验证结果"
  if (/\b(lint|eslint|prettier|fmt|format)\b/.test(name)) return "检查代码风格"
  if (/\b(typecheck|tsc)\b/.test(name)) return "检查类型"
  if (/\b(build|compile|pack|bundle)\b/.test(name)) return "构建并打包项目"
  if (/\b(install|ci|deps|dependencies)\b/.test(name)) return "安装项目依赖"
  if (/\b(dev|serve|start)\b/.test(name)) return "启动开发服务"
  if (/\b(release|publish)\b/.test(name)) return "发布新版本"
  return `执行 ${script} 脚本`
}

/** A user-facing goal label, never a raw argv dump. */
export function terminalGoalTitle(command: string, hint?: string) {
  const stated = hint ? cleanHint(hint) : ""
  if (stated) return stated

  const compact = command.replace(/\s+/g, " ").trim()
  if (!compact) return "终端任务"

  if (/\b(pkill|killall|kill)\b/.test(compact)) return "停止残留的后台进程"
  if (/\bxcodebuild\b/i.test(compact)) return "构建 Xcode 项目"
  if (/\b(downloadComponent|metal)\b/i.test(compact)) return "下载构建组件"
  if (/\bchmod\b/.test(compact) && /\.sh\b/.test(compact)) return "准备脚本执行权限"
  if (/\b(tauri|vite|next|webpack)\b/i.test(compact) && /\bdev\b/i.test(compact)) return "启动开发版应用"
  if (/\b(curl|wget|git clone)\b/i.test(compact)) return "下载资源"
  if (/\b(git fetch|git pull|git rebase|git merge)\b/i.test(compact)) return "同步代码"
  if (/\b(git status|git diff|git log|git show)\b/i.test(compact)) return "检查代码状态"
  if (/\b(docker|podman)\b/i.test(compact)) return "管理容器"
  if (/\b(kubectl|helm)\b/i.test(compact)) return "管理集群"
  if (/\b(ssh|scp|rsync)\b/i.test(compact)) return "同步远程文件"
  if (/\b(make|cmake)\b/i.test(compact)) return "执行构建任务"
  if (/\b(grep|rg|awk|sed|tr|tail|head|cat|less|jq)\b/.test(compact)) return "检查日志与输出"
  if (/\bsleep\b/.test(compact)) return "等待后台任务"
  if (/\b(open|osascript)\b/.test(compact)) return "打开应用"

  const pkg = compact.match(/\b(npm|pnpm|yarn|bunx?|deno)\s+(?:run\s+)?([^\s;&|]+)/i)
  if (pkg) return commandPhrase(pkg[2] ?? "")
  const run = compact.match(/\b(cargo|go)\s+(test|build|run|check|install)\b/i)
  if (run) {
    if (run[2].toLowerCase() === "test") return "运行测试并验证结果"
    if (run[2].toLowerCase() === "build") return "构建项目"
    if (run[2].toLowerCase() === "run") return "启动应用"
    if (run[2].toLowerCase() === "install") return "安装项目依赖"
    return "检查项目"
  }
  const script = compact.match(/\b(?:python3?|node|ruby|perl|bash|sh|zsh)\s+(\S+)/i)
  if (script) {
    const file = script[1]!.split("/").pop() ?? script[1]!
    if (/test|spec/.test(file)) return "运行测试并验证结果"
    if (/build|pack|release/.test(file)) return "构建并打包项目"
    if (/install|setup|download/.test(file)) return "准备项目环境"
    if (/server|serve|dev/.test(file)) return "启动开发服务"
    return `执行 ${file}`
  }
  return "执行终端任务"
}
