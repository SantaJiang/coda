import { createBackendBootstrap, createBackendConfigSync } from "./backend-config"
import { createEffect, onCleanup, onMount, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import * as api from "../lib/api"
import { installQuitShortcut, prepareNotifications } from "../lib/desktop"
import { subscribeEvents } from "../lib/events"
import {
  loadConfiguredModels,
  loadSelectedModelKey,
  menuDiscoveredModels,
  mergeSelectables,
  resolveSelectedKey,
} from "../lib/models"
import { onSharedChange, sharedWriteError, type SharedSettings } from "../lib/shared"
import { newestDraft } from "../lib/draft-session"
import {
  createLocalProject,
  ensureLocalProject,
  hydrateProjects,
  isLocalProject,
  loadDraftSessions,
  loadLastProject,
  loadProjects,
  pickSelectedProjectId,
  resolveHomeDir,
  samePath,
  saveLastProject,
  saveProjects,
  saveProjectSessions,
} from "../lib/persist"
import { applyClientEvent } from "./apply-event"
import { sessionLifetime } from "./gc"
import { resolveRequest } from "./requests"
import { trackDesktopActivity } from "./desktop-activity"
import { createChromeSlice } from "./chrome-slice"
import { StoreProviders } from "./ctx"
import { flushPendingDraftPersist, persistDraftSessions, rekeyDraftSessions } from "./draft-session-state"
import { reportError, type StoreHandle } from "./handle"
import { persistSelection, createModelSlice } from "./model-slice"
import { pushPermissionMode } from "./permission-sync"
import type { AppPorts } from "./ports"
import { createProjectSlice } from "./project-slice"
import { createRuntimeSlice } from "./runtime-slice"
import { initialState, type AppState, type QueuedMessage } from "./state"

export type { AppState, ConnectionState, QueuedMessage } from "./state"
export type { AppPorts } from "./ports"
export { useChrome, useModels, useProjects, useRuntime } from "./ctx"

const defaultPorts: AppPorts = {
  client: api,
  subscribe: subscribeEvents,
}

export function AppProvider(props: ParentProps<{ ports?: Partial<AppPorts> }>) {
  const client = props.ports?.client ?? defaultPorts.client
  const subscribe = props.ports?.subscribe ?? defaultPorts.subscribe
  const [state, setState] = createStore<AppState>(initialState)
  const handle: StoreHandle = { state, setState, client }
  const skipQueueFlush: Record<string, boolean> = {}
  const sendAfterIdle: Record<string, QueuedMessage | undefined> = {}

  const projects = createProjectSlice(handle)
  const config = createBackendConfigSync(handle, (message) =>
    setState("backendError", message ? `模型配置同步失败：${message}` : null),
  )
  const models = createModelSlice(handle, config)
  const runtime = createRuntimeSlice(handle, { skipQueueFlush, sendAfterIdle, flushing: {}, beforePrompt: config.sync })
  const chrome = createChromeSlice(handle)

  let lastSseConnected: boolean | null = null
  const resyncAfterReconnect = async () => {
    const project = projects.selectedProject()
    if (project) await projects.refreshProjectSessions(project).catch(() => undefined)
    const session = projects.selectedSession()
    if (session) await projects.resyncSession(session).catch(() => undefined)
    const pending = new Set<string>([
      ...Object.keys(state.queuedBySession),
      ...Object.keys(sendAfterIdle),
      ...Object.keys(state.settlingBySession),
      ...Object.keys(state.stoppingBySession),
      ...Object.entries(state.status)
        .filter(([, status]) => status.type !== "idle")
        .map(([id]) => id),
      ...Object.values(state.outgoing).map((item) => item.sessionID),
    ])
    if (session) pending.add(session.id)
    await Promise.allSettled([...pending].map((id) => runtime.settleSession(id)))
  }

  let backendProjectsRestored = false
  const bootstrap = createBackendBootstrap({
    healthcheck: () => client.healthcheck(),
    initialize: async () => {
      await config.sync()
      if (!backendProjectsRestored) {
        const backendProjects = await client.listProjects()
        if (backendProjects.length) await projects.restoreProjects(backendProjects)
        backendProjectsRestored = true
      }
      await models.refreshDiscovered()
      for (const project of state.projects) void projects.hydrateProjectPath(project)
    },
    onError: (error) => setState("backendError", error instanceof Error ? error.message : "后端初始化失败，将自动重试"),
    onReady: () => setState("backendError", null),
  })
  const applySseConnection = (ok: boolean) => {
    setState("connection", ok ? "connected" : "disconnected")
    if (!ok) {
      config.invalidate()
      bootstrap.invalidate()
    }
    if (ok && lastSseConnected === false) void resyncAfterReconnect()
    lastSseConnected = ok
    if (ok) void bootstrap.ensure()
  }

  onMount(() => {
    const stored = loadProjects()
    const last = loadLastProject()
    const initial = hydrateProjects(stored)
    const configured = loadConfiguredModels()
    const selectedId = pickSelectedProjectId(initial, last)
    setState("projects", initial)
    setState("selectedProjectId", selectedId)
    if (selectedId && selectedId !== last) saveLastProject(selectedId)
    setState("draft", true)
    setState("configuredModels", configured)
    persistSelection(handle, resolveSelectedKey(configured, mergeSelectables(configured, []), loadSelectedModelKey()))

    const hydratedDrafts = loadDraftSessions()
    setState("draftSessionsByProject", hydratedDrafts.draftSessionsByProject)
    setState("drafts", hydratedDrafts.drafts)
    setState("planModeBySession", hydratedDrafts.planModeBySession)
    const selectedProject = initial.find((project) => project.id === selectedId)
    const restoredDraft = selectedProject
      ? newestDraft(hydratedDrafts.draftSessionsByProject[selectedProject.path] ?? [])
      : undefined
    if (restoredDraft) setState({ selectedSessionId: restoredDraft.id, draft: true })

    for (const project of initial) {
      void projects.hydrateProjectPath(project)
    }

    void resolveHomeDir().then((home) => {
      if (!home) return
      let nextSelected: string | null = null
      let rekeyed = false
      setState(
        produce((draft) => {
          const previous = draft.projects.find(isLocalProject)
          const previousPath = previous?.path
          draft.projects = ensureLocalProject(draft.projects, home)
          if (previousPath && !samePath(previousPath, home)) {
            rekeyDraftSessions(draft, previousPath, home)
            rekeyed = true
          }
          if (!draft.selectedProjectId || !draft.projects.some((project) => project.id === draft.selectedProjectId)) {
            draft.selectedProjectId = pickSelectedProjectId(draft.projects, last)
          }
          nextSelected = draft.selectedProjectId
        }),
      )
      if (nextSelected) saveLastProject(nextSelected)
      if (rekeyed) persistDraftSessions(handle, true)
      void projects.refreshProjectSessions(createLocalProject(home))
    })

    // Retry initialization independently of reachability; a failed config write is not ready.
    const ping = window.setInterval(() => {
      void bootstrap.ensure().then((ready) => {
        if (ready) void config.sync().catch(() => undefined)
      })
    }, 8000)
    void bootstrap.ensure()

    // 其他实例（run.sh 开发版 / 安装版）改了共享设置时，跟随更新本地状态。
    // 只改 state，不再回写 shared，避免两个实例互相回环。
    const applySharedPatch = (patch: SharedSettings) => {
      if (patch.sendShortcut && patch.sendShortcut !== state.sendShortcut) {
        setState("sendShortcut", patch.sendShortcut)
      }
      if (patch.permissionMode && patch.permissionMode !== state.permissionMode) {
        setState("permissionMode", patch.permissionMode)
        void pushPermissionMode(handle, patch.permissionMode).catch((error) => {
          reportError(handle, error, "更新权限失败")
        })
      }
      if (patch.taskRecovery) setState("taskRecovery", patch.taskRecovery)
      if (patch.closeBehavior) setState("closeBehavior", patch.closeBehavior === "tray" ? "tray" : "quit")
      if (patch.stopBehavior) setState("stopBehavior", patch.stopBehavior)
      if (patch.models || "selectedModelKey" in patch) {
        const configured = loadConfiguredModels()
        const extras = menuDiscoveredModels(state.discoveredModels)
        const nextKey = resolveSelectedKey(configured, mergeSelectables(configured, extras), loadSelectedModelKey())
        setState({ configuredModels: configured, selectedModelKey: nextKey })
        void config.sync().catch(() => undefined)
        bootstrap.invalidate()
      }
    }
    const unsubscribeShared = onSharedChange(applySharedPatch)
    const settingsError = (event: Event) => {
      const message = (event as CustomEvent<string>).detail
      if (message) setState("error", `设置保存失败：${message}`)
      else if (state.error?.startsWith("设置保存失败：")) setState("error", null)
    }
    if (sharedWriteError()) setState("error", `设置保存失败：${sharedWriteError()}`)
    window.addEventListener("coda:settings-error", settingsError)

    void prepareNotifications()
    const stopQuitShortcut = installQuitShortcut()
    onCleanup(stopQuitShortcut)
    trackDesktopActivity(state)

    const stop = subscribe(
      (parsed) => {
        const autoReplies: ReturnType<typeof applyClientEvent>["autoReplies"] = []
        const idleSessions: string[] = []
        setState(
          produce((draft) => {
            const effects = applyClientEvent(draft, parsed)
            autoReplies.push(...effects.autoReplies)
            idleSessions.push(...effects.idleSessions)
          }),
        )
        for (const item of autoReplies) {
          const current = sessionLifetime(state, item.permission.sessionID)
          void client.replyPermission(item.directory, item.id, item.reply).then(() => {
            if (current()) setState(produce((draft) => resolveRequest(draft, "permission", item.id, item.permission.sessionID)))
          }).catch((error) => {
            if (!current() || state.resolvedRequests[`permission:${item.id}`] !== undefined) return
            setState(
              produce((draft) => {
                draft.permissions[item.id] = item.permission
              }),
            )
            reportError(handle, error, "自动授权失败")
          })
        }
        for (const sessionID of new Set(idleSessions)) {
          void runtime.settleSession(sessionID)
        }
      },
      (connected) => {
        applySseConnection(connected)
        if (!connected) return
        void models.refreshDiscovered()
      },
    )

    onCleanup(() => {
      flushPendingDraftPersist()
      stop()
      unsubscribeShared()
      window.removeEventListener("coda:settings-error", settingsError)
      window.clearInterval(ping)
      window.removeEventListener("pagehide", flushPendingDraftPersist)
      window.removeEventListener("beforeunload", flushPendingDraftPersist)
    })
    window.addEventListener("pagehide", flushPendingDraftPersist)
    window.addEventListener("beforeunload", flushPendingDraftPersist)
  })

  createEffect(() => {
    saveProjects(state.projects)
  })

  createEffect(() => {
    for (const project of state.projects) {
      if (isLocalProject(project)) continue
      const list = state.sessionsByProject[project.path]
      if (!list) continue
      saveProjectSessions(project.id, list)
    }
  })

  createEffect(() => {
    const selected = state.selectedVariant
    if (!selected) return
    if (!models.currentVariants().includes(selected)) setState("selectedVariant", null)
  })

  createEffect((prev?: string | null) => {
    const id = state.selectedSessionId
    if (prev !== undefined && id !== prev) setState("planPanelDismissed", false)
    return id
  })

  createEffect(() => {
    const project = projects.selectedProject()
    if (!project || isLocalProject(project) || project.missing) {
      setState("vcsBranch", "")
      return
    }
    let cancelled = false
    void client
      .getVcs(project.path)
      .then((info) => {
        if (!cancelled) setState("vcsBranch", info?.branch ?? "")
      })
      .catch(() => {
        if (!cancelled) setState("vcsBranch", "")
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  return (
    <StoreProviders
      terminals={props.ports?.terminals}
      projects={projects}
      models={models}
      runtime={runtime}
      chrome={chrome}
    >
      {props.children}
    </StoreProviders>
  )
}
