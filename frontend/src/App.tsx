import { onCleanup, onMount } from "solid-js"
import { AppProvider } from "./store/app"
import { ThemeProvider } from "./store/theme"
import { Sidebar } from "./components/Sidebar"
import { SessionPage } from "./components/SessionPage"
import { ModelSettings } from "./components/ModelSettings"
import { Settings } from "./components/Settings"

export default function App() {
  onMount(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const node = selection.getRangeAt(0).commonAncestorContainer
      const element = node instanceof Element ? node : node.parentElement
      if (element?.closest(".timeline, input, textarea")) return
      selection.removeAllRanges()
    }
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 2) event.preventDefault()
    }
    document.addEventListener("contextmenu", onContextMenu)
    document.addEventListener("mousedown", onMouseDown)
    onCleanup(() => {
      document.removeEventListener("contextmenu", onContextMenu)
      document.removeEventListener("mousedown", onMouseDown)
    })
  })

  return (
    <ThemeProvider>
      <AppProvider>
        <div class="shell">
          <Sidebar />
          <SessionPage />
        </div>
        <ModelSettings />
        <Settings />
      </AppProvider>
    </ThemeProvider>
  )
}
