import { AppProvider } from "./store/app"
import { Sidebar } from "./components/Sidebar"
import { SessionPage } from "./components/SessionPage"
import { ModelSettings } from "./components/ModelSettings"

export default function App() {
  return (
    <AppProvider>
      <div class="shell">
        <Sidebar />
        <SessionPage />
      </div>
      <ModelSettings />
    </AppProvider>
  )
}
