import { describe, expect, it } from "vitest"
import { agentConfigFrom, agentInfoFrom, agentParamsFrom, emptyAgentParams } from "./agent-params"

describe("agent params", () => {
  it("reads temperature, top_p and steps from the backend agent shape", () => {
    const info = agentInfoFrom({
      id: "build",
      name: "build",
      model: { providerID: "openai", id: "gpt-5", variant: "high" },
      request: { body: { temperature: 0.2, top_p: 0.9 } },
      steps: 12,
    })
    expect(info).toMatchObject({ id: "build", temperature: 0.2, topP: 0.9, steps: 12 })
    expect(agentParamsFrom(info)).toEqual({
      model: "openai/gpt-5#high",
      temperature: "0.2",
      topP: "0.9",
      steps: "12",
    })
  })

  it("writes the v1 agent config that the backend normalizes", () => {
    const params = { ...emptyAgentParams(), model: "openai/gpt-5#low", temperature: "0.3", topP: "0.8", steps: "5" }
    expect(agentConfigFrom(params)).toEqual({
      entry: { model: "openai/gpt-5#low", temperature: 0.3, top_p: 0.8, steps: 5 },
    })
  })

  it("omits blank fields and validates ranges", () => {
    expect(agentConfigFrom(emptyAgentParams())).toEqual({ entry: {} })
    expect(agentConfigFrom({ ...emptyAgentParams(), model: "bad-model" })).toHaveProperty("error")
    expect(agentConfigFrom({ ...emptyAgentParams(), steps: "0" })).toHaveProperty("error")
    expect(agentConfigFrom({ ...emptyAgentParams(), temperature: "abc" })).toHaveProperty("error")
  })
})
