import { describe, expect, it } from "vitest"
import {
  mergeConfiguredModels,
  parseModelConfigFile,
  replaceConfiguredModels,
  serializeModelConfig,
} from "./model-config-file"
import type { ConfiguredModel } from "./models"

function model(partial: Partial<ConfiguredModel> & Pick<ConfiguredModel, "id" | "modelID">): ConfiguredModel {
  return {
    name: partial.name ?? partial.modelID,
    providerID: partial.providerID ?? "openai",
    providerName: partial.providerName ?? "OpenAI",
    baseURL: partial.baseURL ?? "https://api.openai.com/v1",
    apiKey: partial.apiKey ?? "sk-local",
    ...partial,
  }
}

describe("serializeModelConfig", () => {
  it("writes plaintext url and key and omits local ids", () => {
    const json = serializeModelConfig([
      model({
        id: "mdl_keep_me",
        name: "GPT-4o",
        modelID: "gpt-4o",
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-secret",
      }),
    ])
    const parsed = JSON.parse(json) as { kind: string; models: Array<Record<string, unknown>> }
    expect(parsed.kind).toBe("coda-models")
    expect(parsed.models).toHaveLength(1)
    expect(parsed.models[0]).toEqual({
      name: "GPT-4o",
      providerID: "openai",
      providerName: "OpenAI",
      modelID: "gpt-4o",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-secret",
    })
    expect(parsed.models[0]).not.toHaveProperty("id")
    expect(json).toContain("sk-secret")
    expect(json).toContain("https://api.openai.com/v1")
  })
})

describe("parseModelConfigFile", () => {
  it("reads a Coda export and assigns new ids", () => {
    const imported = parseModelConfigFile(
      JSON.stringify({
        kind: "coda-models",
        version: 1,
        models: [
          {
            name: "GPT-4o",
            providerID: "openai",
            providerName: "OpenAI",
            modelID: "gpt-4o",
            baseURL: "https://api.openai.com/v1/",
            apiKey: "sk-imported",
          },
        ],
      }),
    )
    expect(imported).toHaveLength(1)
    expect(imported[0].id).toMatch(/^mdl_/)
    expect(imported[0].id).not.toBe("mdl_keep_me")
    expect(imported[0].apiKey).toBe("sk-imported")
    expect(imported[0].baseURL).toBe("https://api.openai.com/v1")
    expect(imported[0].modelID).toBe("gpt-4o")
  })

  it("reads a bare models array from settings.json", () => {
    const imported = parseModelConfigFile(
      JSON.stringify([
        {
          id: "mdl_1",
          name: "GLM-ypt",
          providerID: "namo_hw",
          providerName: "NAMO_HW",
          modelID: "glm",
          baseURL: "http://example.com/v1",
          apiKey: "k",
        },
      ]),
    )
    expect(imported[0].providerID).toBe("namo_hw")
    expect(imported[0].modelID).toBe("glm")
    expect(imported[0].apiKey).toBe("k")
    expect(imported[0].id).not.toBe("mdl_1")
  })

  it("reads an OpenCode provider fragment", () => {
    const imported = parseModelConfigFile(`
"namo_hw": {
  "name": "NAMO_HW",
  "npm": "@ai-sdk/openai-compatible",
  "options": {
    "baseURL": "http://example.com/v1/",
    "headers": {
      "Authorization": "Bearer test-token"
    }
  },
  "models": {
    "glm": { "name": "GLM-ypt" },
    "flash": { "name": "DeepSeek-Flash" }
  }
}
`)
    expect(imported).toHaveLength(2)
    expect(imported.map((item) => item.modelID).sort()).toEqual(["flash", "glm"])
    expect(imported[0].apiKey).toBe("test-token")
    expect(imported[0].providerID).toBe("namo_hw")
  })

  it("accepts a UTF-8 BOM", () => {
    const imported = parseModelConfigFile(
      `\uFEFF${JSON.stringify({
        kind: "coda-models",
        version: 1,
        models: [
          {
            name: "GPT-4o",
            providerID: "openai",
            providerName: "OpenAI",
            modelID: "gpt-4o",
            baseURL: "https://api.openai.com/v1",
            apiKey: "sk",
          },
        ],
      })}`,
    )
    expect(imported).toHaveLength(1)
    expect(imported[0].modelID).toBe("gpt-4o")
  })

  it("rejects invalid JSON", () => {
    expect(() => parseModelConfigFile("{ not json")).toThrow("不是合法 JSON")
  })

  it("rejects files without models", () => {
    expect(() => parseModelConfigFile(JSON.stringify({ kind: "coda-models", models: [] }))).toThrow(
      "JSON 里没有可用的接口地址和模型",
    )
  })
})

describe("mergeConfiguredModels", () => {
  it("keeps one endpoint when url and key match and unions model IDs", () => {
    const local = [
      model({ id: "mdl_local", name: "我的 GPT", modelID: "gpt-4o", apiKey: "sk-same" }),
    ]
    const incoming = [
      model({
        id: "mdl_in_1",
        name: "GPT-4o",
        modelID: "gpt-4o",
        apiKey: "sk-same",
        providerID: "other",
        providerName: "Other",
      }),
      model({ id: "mdl_in_2", name: "o3", modelID: "o3", apiKey: "sk-same", providerID: "other", providerName: "Other" }),
    ]
    const merged = mergeConfiguredModels(local, incoming)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ id: "mdl_local", name: "我的 GPT", modelID: "gpt-4o", providerID: "openai" })
    expect(merged[1]).toMatchObject({
      modelID: "o3",
      name: "o3",
      providerID: "openai",
      providerName: "OpenAI",
      apiKey: "sk-same",
    })
  })

  it("keeps both sides when the key or url differs", () => {
    const local = [model({ id: "mdl_a", modelID: "gpt-4o", apiKey: "sk-a" })]
    const incoming = [
      model({ id: "mdl_b", modelID: "gpt-4o", apiKey: "sk-b" }),
      model({
        id: "mdl_c",
        modelID: "gpt-4o",
        apiKey: "sk-a",
        baseURL: "https://proxy.example.com/v1",
        providerID: "proxy",
        providerName: "Proxy",
      }),
    ]
    const merged = mergeConfiguredModels(local, incoming)
    expect(merged).toHaveLength(3)
    expect(merged.map((item) => item.id).sort()).toEqual(["mdl_a", "mdl_b", "mdl_c"])
    expect(new Set(merged.map((item) => `${item.providerID}/${item.modelID}`)).size).toBe(3)
  })

  it("renames colliding provider IDs so different endpoints stay selectable", () => {
    const local = [model({ id: "mdl_a", modelID: "gpt-4o", apiKey: "sk-a" })]
    const incoming = [
      model({
        id: "mdl_b",
        modelID: "gpt-4o",
        apiKey: "sk-b",
        baseURL: "https://proxy.example.com/v1",
      }),
    ]
    const merged = mergeConfiguredModels(local, incoming)
    expect(merged[0].providerID).toBe("openai")
    expect(merged[1].providerID).toBe("openai-2")
    expect(merged[1].providerName).toBe("OpenAI (proxy-example-com)")
  })

  it("treats trailing slashes as the same endpoint", () => {
    const local = [model({ id: "mdl_local", modelID: "gpt-4o", baseURL: "https://api.openai.com/v1/" })]
    const incoming = [model({ id: "mdl_in", modelID: "o3", baseURL: "https://api.openai.com/v1" })]
    const merged = mergeConfiguredModels(local, incoming)
    expect(merged).toHaveLength(2)
    expect(merged.map((item) => item.providerID)).toEqual(["openai", "openai"])
  })

  it("dedupes repeated url+key+modelID inside the incoming file", () => {
    const incoming = [
      model({ id: "mdl_1", modelID: "gpt-4o", apiKey: "sk-1", name: "first" }),
      model({ id: "mdl_2", modelID: "gpt-4o", apiKey: "sk-1", name: "second" }),
    ]
    expect(replaceConfiguredModels(incoming)).toEqual([incoming[0]])
  })
})

describe("replaceConfiguredModels", () => {
  it("replaces with the imported list after dedupe", () => {
    const local = [model({ id: "mdl_local", modelID: "gpt-4o" })]
    const incoming = [model({ id: "mdl_new", modelID: "o3", apiKey: "sk-new" })]
    expect(replaceConfiguredModels(incoming)).toEqual(incoming)
    expect(replaceConfiguredModels(incoming)).not.toEqual(local)
  })

  it("uniquifies provider IDs inside a replaced list", () => {
    const incoming = [
      model({ id: "1", modelID: "gpt-4o", apiKey: "a" }),
      model({ id: "2", modelID: "gpt-4o", apiKey: "b", baseURL: "https://other.example.com/v1" }),
    ]
    const replaced = replaceConfiguredModels(incoming)
    expect(replaced[0].providerID).toBe("openai")
    expect(replaced[1].providerID).toBe("openai-2")
  })
})
