export type AgentInfo = {
  id: string
  name: string
  model?: { providerID: string; id: string; variant?: string }
  temperature?: number
  topP?: number
  steps?: number
}

export type AgentParams = {
  /** v1 selection syntax: providerID/modelID#variant. */
  model: string
  temperature: string
  topP: string
  steps: string
}

export const emptyAgentParams = (): AgentParams => ({ model: "", temperature: "", topP: "", steps: "" })

/** Backend v1 agent config is what Config.Patch writes; normalization migrates it on read. */
export type AgentConfigEntry = Partial<{
  model: string
  temperature: number
  top_p: number
  steps: number
}>

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function agentInfoFrom(row: Record<string, unknown>): AgentInfo {
  const model = row.model && typeof row.model === "object" ? (row.model as Record<string, unknown>) : undefined
  const request = row.request && typeof row.request === "object" ? (row.request as Record<string, unknown>) : undefined
  const body = request?.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : undefined
  return {
    id: typeof row.id === "string" ? row.id : "",
    name: typeof row.name === "string" ? row.name : typeof row.id === "string" ? row.id : "",
    ...(model && typeof model.providerID === "string" && typeof model.id === "string"
      ? {
          model: {
            providerID: model.providerID,
            id: model.id,
            ...(typeof model.variant === "string" ? { variant: model.variant } : {}),
          },
        }
      : {}),
    ...(finite(body?.temperature) !== undefined ? { temperature: finite(body?.temperature) } : {}),
    ...(finite(body?.top_p) !== undefined ? { topP: finite(body?.top_p) } : {}),
    ...(finite(row.steps) !== undefined ? { steps: finite(row.steps) } : {}),
  }
}

export function agentParamsFrom(info: AgentInfo): AgentParams {
  const variant = info.model?.variant ? `#${info.model.variant}` : ""
  return {
    model: info.model ? `${info.model.providerID}/${info.model.id}${variant}` : "",
    temperature: info.temperature === undefined ? "" : String(info.temperature),
    topP: info.topP === undefined ? "" : String(info.topP),
    steps: info.steps === undefined ? "" : String(info.steps),
  }
}

/** Empty strings clear the value only when the user explicitly asked to reset; save omits them. */
export function agentConfigFrom(params: AgentParams): { entry: AgentConfigEntry } | { error: string } {
  const entry: AgentConfigEntry = {}
  const model = params.model.trim()
  if (model) {
    if (!/^[^/#]+\/[^/#]+(?:#[^#]+)?$/.test(model)) return { error: "模型需要写成 providerID/modelID 或 providerID/modelID#variant" }
    entry.model = model
  }
  for (const [key, label, max] of [["temperature", "temperature", 2], ["topP", "top_p", 1], ["steps", "steps", 0]] as const) {
    const raw = params[key].trim()
    if (!raw) continue
    const value = Number(raw)
    if (!Number.isFinite(value)) return { error: `${label} 必须是数字` }
    if (key === "steps" && (!Number.isInteger(value) || value < 1)) return { error: "steps 必须是正整数" }
    if (key !== "steps" && (value < 0 || value > max)) return { error: `${label} 需要在 0 到 ${max} 之间` }
    if (key === "temperature") entry.temperature = value
    else if (key === "topP") entry.top_p = value
    else entry.steps = value
  }
  return { entry }
}
