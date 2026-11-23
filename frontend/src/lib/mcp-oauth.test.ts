import { expect, it } from "vitest"
import { integrationFrom, interactiveOAuthMethod, oauthAttemptFrom, oauthStatusFrom } from "./mcp-oauth"

it("finds the no-form OAuth method registered for a remote MCP server", () => {
  const integration = integrationFrom({
    id: "mcp_abc",
    name: "docs",
    methods: [
      { id: "key", type: "key", label: "Key" },
      { id: "oauth1", type: "oauth", label: "docs", form: [{ key: "client_id" }] },
      { id: "oauth2", type: "oauth", label: "docs" },
    ],
  })
  expect(interactiveOAuthMethod(integration)?.id).toBe("oauth2")
})

it("maps an OAuth attempt and its terminal status", () => {
  const attempt = oauthAttemptFrom({
    attemptID: "con_1",
    url: "https://auth.example/authorize",
    mode: "auto",
    paste: true,
    time: { created: 100, expires: 101_200 },
  })
  expect(attempt).toMatchObject({ attemptID: "con_1", paste: true, lifetime: 101_100 })
  expect(oauthStatusFrom({ status: "pending" })).toEqual({ status: "pending" })
  expect(oauthStatusFrom({ status: "failed", message: "denied" })).toEqual({ status: "failed", message: "denied" })
  expect(oauthStatusFrom({ status: "expired" })).toEqual({ status: "expired" })
  expect(oauthStatusFrom({ status: "complete" })).toEqual({ status: "complete" })
})
