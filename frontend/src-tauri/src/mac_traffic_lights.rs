//! Place macOS traffic lights in Coda's overlay chrome.
//!
//! Tauri's `trafficLightPosition.y` only grows the titlebar container; it
//! never moves the buttons themselves. This sets both x and y on the NSWindow
//! buttons so they sit like a native titlebar.
//!
//! The buttons must stay inside every ancestor's bounds. AppKit still draws a
//! view whose frame sticks out of its parent, but `hitTest:` ignores that
//! point, so the close button looks normal and does nothing when clicked.

use std::time::Duration;

use objc2::{msg_send, MainThreadMarker};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow, NSWindowButton};
use objc2_foundation::{NSPoint, NSRect, NSSize};
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
                | WindowEvent::Focused(_)
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

fn same_view(a: &NSView, b: &NSView) -> bool {
    std::ptr::eq(a, b)
}

unsafe fn layout(ns_window_ptr: *mut std::ffi::c_void) {
    let ns_window = &*ns_window_ptr.cast::<NSWindow>();
    let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)
    else {
        return;
    };
    let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

    let Some(content) = ns_window.contentView() else {
        return;
    };
    let Some(theme) = content.superview() else {
        return;
    };

    let close_rect = NSView::frame(&close);
    let measured = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
    let spacing = if measured > 1.0 { measured } else { 20.0 };

    // Ancestors from the button's parent up to the theme frame's direct child.
    let mut chain = Vec::new();
    let mut cursor = close.superview();
    while let Some(view) = cursor {
        if same_view(&view, &theme) {
            break;
        }
        let next = view.superview();
        chain.push(view);
        cursor = next;
        if chain.len() > 12 {
            break;
        }
    }
    let Some(container) = chain.last() else {
        return;
    };

    if container
        .superview()
        .is_some_and(|parent| same_view(&parent, &theme))
    {
        let theme_bounds = theme.bounds();
        container.setFrame(NSRect {
            origin: NSPoint {
                x: 0.0,
                y: (theme_bounds.size.height - CHROME_H).max(0.0),
            },
            size: NSSize {
                width: theme_bounds.size.width,
                height: CHROME_H,
            },
        });
        // Keep the titlebar above the webview. Otherwise the page receives the
        // click and the native close button never sees it.
        // NSWindowAbove = 1
        let container_view: &NSView = container;
        let _: () = msg_send![&*theme, addSubview: container_view, positioned: 1isize, relativeTo: std::ptr::null::<NSView>()];
    }

    // Stretch each intermediate view to its parent so the buttons are inside
    // a hittable ancestor, not merely drawn outside one.
    for view in chain.iter().rev().skip(1) {
        let Some(parent) = view.superview() else {
            continue;
        };
        let parent_size = parent.bounds().size;
        view.setFrame(NSRect {
            origin: NSPoint { x: 0.0, y: 0.0 },
            size: parent_size,
        });
    }

    let host_height = close
        .superview()
        .map(|host| host.bounds().size.height)
        .unwrap_or(CHROME_H);
    let origin_y = (host_height - close_rect.size.height - INSET_Y).max(0.0);

    let mut buttons = vec![close, miniaturize];
    if let Some(zoom) = zoom {
        buttons.push(zoom);
    }
    for (index, button) in buttons.into_iter().enumerate() {
        button.setAutoresizingMask(NSAutoresizingMaskOptions::ViewNotSizable);
        button.setFrameOrigin(NSPoint {
            x: INSET_X + index as f64 * spacing,
            y: origin_y,
        });
    }
}
