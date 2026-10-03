import { describe, expect, it } from "vitest"
import { extractApiKey, parseImportedProviders } from "./provider-import"

describe("parseImportedProviders", () => {
  it("accepts an OpenCode provider fragment and reads Bearer tokens", () => {
    const imported = parseImportedProviders(`
"namo_hw": {
  "name": "NAMO_HW",
  "npm": "@ai-sdk/openai-compatible",
  "options": {
    "baseURL": "http://117.132.188.43:38099/namo-hw/model_gateway/v1/",
    "headers": {
      "Authorization": "Bearer test-token"
    }
  },
  "models": {
    "78ec4f29-afe3-4524-9b95-9f5986c5d6e7": { "name": "GLM-ypt" },
    "4cd13ffc-9756-425f-94ca-8ea1a41063d6": { "name": "DeepSeek-V4-Flash-ypt" }
  }
}
`)
    expect(imported).toHaveLength(1)
    expect(imported[0].form.providerID).toBe("namo_hw")
    expect(imported[0].form.providerName).toBe("NAMO_HW")
    expect(imported[0].form.baseURL).toBe("http://117.132.188.43:38099/namo-hw/model_gateway/v1/")
    expect(imported[0].form.apiKey).toBe("test-token")
    expect(imported[0].models).toEqual([
      { id: "78ec4f29-afe3-4524-9b95-9f5986c5d6e7", name: "GLM-ypt" },
      { id: "4cd13ffc-9756-425f-94ca-8ea1a41063d6", name: "DeepSeek-V4-Flash-ypt" },
    ])
  })

  it("reads a Coda settings models array", () => {
    const imported = parseImportedProviders(
      JSON.stringify({
        models: [
          {
            id: "mdl_1",
            name: "GLM-ypt",
            providerID: "namo_hw",
            providerName: "NAMO_HW",
            modelID: "glm",
            baseURL: "http://example.com/v1",
            apiKey: "k",
          },
        ],
      }),
    )
    expect(imported[0].form.providerID).toBe("namo_hw")
    expect(imported[0].models).toEqual([{ id: "glm", name: "GLM-ypt" }])
  })
})

describe("extractApiKey", () => {
  it("prefers options.apiKey over Authorization", () => {
    expect(extractApiKey({ apiKey: "sk-1", headers: { Authorization: "Bearer other" } })).toBe("sk-1")
  })

  it("reads x-api-key when Authorization is absent", () => {
    expect(extractApiKey({ headers: { "x-api-key": "sk-header" } })).toBe("sk-header")
  })
})

describe("parseImportedProviders grouping", () => {
  it("keeps models that share an id but use different endpoints apart", () => {
    const imported = parseImportedProviders(
      JSON.stringify([
        {
          providerID: "proxy",
          providerName: "Proxy",
          modelID: "a",
          name: "A",
          baseURL: "https://a.example/v1",
          apiKey: "k1",
        },
        {
          providerID: "proxy",
          providerName: "Proxy",
          modelID: "b",
          name: "B",
          baseURL: "https://b.example/v1",
          apiKey: "k2",
        },
      ]),
    )
    expect(imported).toHaveLength(2)
    expect(imported.map((item) => item.form.baseURL).sort()).toEqual(["https://a.example/v1", "https://b.example/v1"])
    expect(new Set(imported.map((item) => item.form.providerID)).size).toBe(2)
  })
})
