import { describe, expect, it } from "vitest"
import {
  clearRetiredModelStorage,
  createConfiguredModel,
  emptyModelForm,
  menuDiscoveredModels,
  mergeSelectables,
  resolveProviderID,
  resolveSelectedKey,
  toBackendPatch,
  validateFetchForm,
  validateProviderForm,
  type SelectableModel,
} from "./models"

function discovered(providerID: string, modelID: string, name = modelID): SelectableModel {
  return {
    key: `${providerID}/${modelID}`,
    providerID,
    modelID,
    name,
    source: "discovered",
    variants: [],
  }
}

describe("toBackendPatch", () => {
  it("marks configured models as attachment-capable and does not invent token limits", () => {
    const patch = toBackendPatch(
      [
        {
          id: "1",
          name: "gpt",
          providerID: "openai",
          providerName: "OpenAI",
          modelID: "gpt-4",
          baseURL: "https://api.openai.com/v1",
          apiKey: "sk-test",
        },
      ],
      "openai/gpt-4",
    )
    expect(patch?.provider?.openai?.models?.["gpt-4"]?.attachment).toBe(true)
    expect(patch?.provider?.openai?.models?.["gpt-4"]?.limit).toBeUndefined()
  })
})

describe("resolveProviderID", () => {
  it("keeps an existing provider id", () => {
    expect(
      resolveProviderID({
        providerID: "openai",
        providerName: "OpenAI",
        name: "OpenAI",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toBe("openai")
  })

  it("slugs an english interface name", () => {
    expect(
      resolveProviderID({
        providerID: "",
        providerName: "My Proxy",
        name: "My Proxy",
        baseURL: "https://proxy.example.com/v1",
      }),
    ).toBe("my-proxy")
  })

  it("falls back to the hostname when the name has no latin slug", () => {
    expect(
      resolveProviderID({
        providerID: "",
        providerName: "公司网关",
        name: "公司网关",
        baseURL: "https://api.example.com/v1",
      }),
    ).toBe("api-example-com")
  })
})

describe("createConfiguredModel", () => {
  it("stores the interface name and a hostname slug for chinese custom providers", () => {
    const model = createConfiguredModel({
      ...emptyModelForm(),
      name: "公司网关",
      providerName: "公司网关",
      modelID: "gpt-4",
      baseURL: "https://api.example.com/v1/",
      apiKey: "sk-test",
    })
    expect(model.providerName).toBe("公司网关")
    expect(model.providerID).toBe("api-example-com")
    expect(model.baseURL).toBe("https://api.example.com/v1")
  })
})

describe("validateProviderForm", () => {
  it("asks for an interface name instead of a provider id", () => {
    expect(
      validateProviderForm({
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
        providerID: "",
        providerName: "",
        name: "",
      }),
    ).toBe("请填写接口名称")
  })

  it("lets fetching the model list only require the endpoint and key", () => {
    expect(validateFetchForm({ baseURL: "https://api.example.com/v1", apiKey: "sk-test" })).toBeNull()
    expect(validateFetchForm({ baseURL: "", apiKey: "sk-test" })).toBe("请填写接口地址")
    expect(validateFetchForm({ baseURL: "https://api.example.com/v1", apiKey: "" })).toBe("请填写 API Key")
  })
})

describe("menuDiscoveredModels", () => {
  it("only keeps OpenCode discovered models for the input menu", () => {
    const kept = menuDiscoveredModels([
      discovered("opencode", "big-pickle", "Big Pickle"),
      discovered("openai", "gpt-4"),
    ])
    expect(kept.map((item) => item.key)).toEqual(["opencode/big-pickle"])
  })
})

describe("mergeSelectables and resolveSelectedKey", () => {
  it("puts OpenCode free models into the menu and can select them without configured providers", () => {
    const extras = menuDiscoveredModels([discovered("opencode", "big-pickle", "Big Pickle")])
    const selectables = mergeSelectables([], extras)
    expect(selectables).toEqual([
      {
        key: "opencode/big-pickle",
        providerID: "opencode",
        modelID: "big-pickle",
        name: "Big Pickle",
        source: "discovered",
        variants: [],
      },
    ])
    expect(resolveSelectedKey([], selectables, null)).toBe("opencode/big-pickle")
  })
})

describe("clearRetiredModelStorage", () => {
  it("drops the pinned-models key left behind by older versions", () => {
    localStorage.setItem("coda.pinnedModels", JSON.stringify(["opencode/big-pickle"]))
    localStorage.setItem("coda.models", "[]")
    clearRetiredModelStorage()
    expect(localStorage.getItem("coda.pinnedModels")).toBeNull()
    expect(localStorage.getItem("coda.models")).toBe("[]")
  })
})
