//! Native backdrop behind the navigation column.
//!
//! macOS gets Liquid Glass on 26+ and NSVisualEffectView's sidebar material on
//! older systems. Windows 11 gets DWM Mica. Only the nav column reveals the
//! material: the chat pane keeps its opaque CSS background on top of the same
//! window-level effect.
//!
//! Unsupported systems report `solid`; the frontend then keeps its normal
//! palette, so the webview never becomes transparent over an empty window.

use tauri::WebviewWindow;

/// The frontend keeps its own background and nothing is revealed.
pub const SOLID: &str = "solid";

/// Apply the backdrop for the resolved app theme and report what the CSS should
/// style against. `set_effects` dispatches to the main thread, so calling it
/// from an IPC handler is safe.
pub fn apply(window: &WebviewWindow, theme: &str) -> &'static str {
    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Color, Effect, EffectState, EffectsBuilder};

        // One Liquid Glass style plus one material: Tauri falls back to the
        // material on macOS 15 and older. Liquid Glass ignores `state`.
        let tint = if theme == "light" {
            Color(250, 250, 252, 72)
        } else {
            Color(18, 18, 20, 104)
        };
        let effects = EffectsBuilder::new()
            .effect(Effect::LiquidGlassRegular)
            .effect(Effect::Sidebar)
            .state(EffectState::FollowsWindowActiveState)
            .radius(0.0)
            .color(tint)
            .build();
        match window.set_effects(effects) {
            Ok(()) => "glass",
            Err(_) => SOLID,
        }
    }

    #[cfg(windows)]
    {
        use tauri::window::{Effect, EffectsBuilder};

        // Mica needs Windows 11 (build 22000+). Windows 10 has no safe native
        // backdrop here, so keep the solid palette instead of exposing a
        // transparent window over the desktop.
        if windows_version::OsVersion::current().build < 22_000 {
            return SOLID;
        }
        let effect = if theme == "light" {
            Effect::MicaLight
        } else {
            Effect::MicaDark
        };
        match window.set_effects(EffectsBuilder::new().effect(effect).build()) {
            Ok(()) => "mica",
            Err(_) => SOLID,
        }
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (window, theme);
        SOLID
    }
}

#[tauri::command]
pub fn window_material(window: WebviewWindow, theme: String) -> &'static str {
    apply(&window, &theme)
}
