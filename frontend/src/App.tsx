import { onCleanup, onMount } from "solid-js"
import { AppProvider } from "./store/app"
import { Sidebar } from "./components/Sidebar"
import { SessionPage } from "./components/SessionPage"
import { ModelSettings } from "./components/ModelSettings"
import { Settings } from "./components/Settings"

export default function App() {
  onMount(() => {
    const onContextMenu = (event: MouseEvent) => event.preventDefault()
    document.addEventListener("contextmenu", onContextMenu)
    onCleanup(() => document.removeEventListener("contextmenu", onContextMenu))
  })

  return (
    <AppProvider>
      <div class="shell">
        <Sidebar />
        <SessionPage />
      </div>
      <ModelSettings />
      <Settings />
    </AppProvider>
  )
}
