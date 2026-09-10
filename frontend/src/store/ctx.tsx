import { createContext, useContext, type ParentProps } from "solid-js"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "./contracts"

const ProjectContext = createContext<ProjectApi>()
const ModelContext = createContext<ModelApi>()
const RuntimeContext = createContext<RuntimeApi>()
const ChromeContext = createContext<ChromeApi>()

export function StoreProviders(
  props: ParentProps<{
    projects: ProjectApi
    models: ModelApi
    runtime: RuntimeApi
    chrome: ChromeApi
  }>,
) {
  return (
    <ProjectContext.Provider value={props.projects}>
      <ModelContext.Provider value={props.models}>
        <RuntimeContext.Provider value={props.runtime}>
          <ChromeContext.Provider value={props.chrome}>{props.children}</ChromeContext.Provider>
        </RuntimeContext.Provider>
      </ModelContext.Provider>
    </ProjectContext.Provider>
  )
}

export function useProjects() {
  const context = useContext(ProjectContext)
  if (!context) throw new Error("useProjects must be used within AppProvider")
  return context
}

export function useModels() {
  const context = useContext(ModelContext)
  if (!context) throw new Error("useModels must be used within AppProvider")
  return context
}

export function useRuntime() {
  const context = useContext(RuntimeContext)
  if (!context) throw new Error("useRuntime must be used within AppProvider")
  return context
}

export function useChrome() {
  const context = useContext(ChromeContext)
  if (!context) throw new Error("useChrome must be used within AppProvider")
  return context
}
