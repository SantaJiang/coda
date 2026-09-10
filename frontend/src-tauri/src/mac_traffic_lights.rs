//! Place macOS traffic lights in Coda's overlay chrome.
//!
//! Tauri's `trafficLightPosition.y` only grows the titlebar container; it
//! never moves the buttons themselves. This sets both x and y on the NSWindow
//! buttons so they sit like a native / Cursor titlebar.

use std::time::Duration;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
use objc2_foundation::NSPoint;
use tauri::{Manager, WebviewWindow, WindowEvent};

/// Must match `--chrome-h` in the frontend CSS.
const CHROME_H: f64 = 36.0;
const INSET_X: f64 = 14.0;
/// Distance from the top of the titlebar to the top of the buttons.
const INSET_Y: f64 = 10.0;

pub fn install_main(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    apply(&window);
    let for_events = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. }
                | WindowEvent::ThemeChanged(_)
        ) {
            apply(&for_events);
        }
    });
    for delay_ms in [50_u64, 250] {
        let delayed = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay_ms));
            let again = delayed.clone();
            let _ = delayed.run_on_main_thread(move || apply(&again));
        });
    }
}

fn apply(window: &WebviewWindow) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    if ptr.is_null() {
        return;
    }
    let Some(_mtm) = MainThreadMarker::new() else {
        return;
    };
    unsafe {
        layout(ptr);
    }
}

unsafe fn layout(ns_window_ptr: *mut std::ffi::c_void) {
    let ns_window = &*ns_window_ptr.cast::<NSWindow>();
    let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

    let Some(close_parent) = close.superview() else {
        return;
    };
    let Some(titlebar) = close_parent.superview() else {
        return;
    };

    let close_rect = NSView::frame(&close);
    let mut titlebar_rect = NSView::frame(&titlebar);
    titlebar_rect.size.height = CHROME_H;
    titlebar_rect.origin.y = ns_window.frame().size.height - CHROME_H;
    titlebar.setFrame(titlebar_rect);

    let spacing = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
    let origin_y = (CHROME_H - close_rect.size.height - INSET_Y).max(0.0);

    let mut buttons = vec![close, miniaturize];
    if let Some(zoom) = zoom {
        buttons.push(zoom);
    }
    for (index, button) in buttons.into_iter().enumerate() {
        button.setFrameOrigin(NSPoint {
            x: INSET_X + index as f64 * spacing,
            y: origin_y,
        });
    }
}
