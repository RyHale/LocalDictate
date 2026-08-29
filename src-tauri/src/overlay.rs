use crate::input;
use crate::settings;
use crate::settings::{OverlayPosition, OverlayStyle};
use crate::theme_packs::{OverlayWindowConfig, ThemeOverlayAnchor, ThemePointerMode};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize};

#[cfg(not(target_os = "macos"))]
use log::debug;

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

#[cfg(target_os = "linux")]
use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

#[cfg(target_os = "linux")]
use std::env;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(RecordingOverlayPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

// Native overlay window sizes (logical points). One window is reused for every
// state and resized in `show_overlay_state`; each size need only be at least as
// large as the card it hosts (the `--ov-*` vars in RecordingOverlay.css). The
// card is CSS-anchored flush to the screen edge, so window height doesn't move
// where the card sits — only OVERLAY_TOP_OFFSET / OVERLAY_BOTTOM_OFFSET do. Keep
// these in sync with the CSS card geometry.
//
// Compact overlay (Minimal / transcribing / processing): the 40h pill animates
// width from 172 (--ov-rest-w) to 216 (--ov-work-w) and expands from center, so
// the window must fit the widest state plus a little slack.
const OVERLAY_WIDTH: f64 = 256.0;
const OVERLAY_HEIGHT: f64 = 46.0;

// Idle native bounds hug the 52x28 ready card. Keeping the transparent hit area
// small matters because this window remains visible whenever LocalDictate is on.
const OVERLAY_IDLE_WIDTH: f64 = 72.0;
const OVERLAY_IDLE_HEIGHT: f64 = 36.0;

// Actual is 394x118, just a little extra
const OVERLAY_STREAM_WIDTH: f64 = 400.0;
const OVERLAY_STREAM_HEIGHT: f64 = 120.0;

fn classic_overlay_dimensions(state: &str) -> (f64, f64) {
    match state {
        "idle" => (OVERLAY_IDLE_WIDTH, OVERLAY_IDLE_HEIGHT),
        "streaming" => (OVERLAY_STREAM_WIDTH, OVERLAY_STREAM_HEIGHT),
        _ => (OVERLAY_WIDTH, OVERLAY_HEIGHT),
    }
}

/// Theme canvases retain one stable native size across lifecycle states. The
/// classic renderer keeps its compact/streaming state-specific geometry.
fn resolved_overlay_dimensions(theme: Option<OverlayWindowConfig>, state: &str) -> (f64, f64) {
    theme
        .map(|theme| (theme.width as f64, theme.height as f64))
        .unwrap_or_else(|| classic_overlay_dimensions(state))
}

fn overlay_dimensions(app_handle: &AppHandle, state: &str) -> (f64, f64) {
    resolved_overlay_dimensions(
        crate::theme_packs::active_overlay_window_config(app_handle),
        state,
    )
}

fn should_ignore_cursor(theme: Option<OverlayWindowConfig>, state: &str) -> bool {
    theme
        .map(|theme| theme.pointer_mode == ThemePointerMode::Passthrough)
        .unwrap_or(state == "idle")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RestingOverlayState {
    Hidden,
    Ready,
}

fn resting_overlay_state(style: OverlayStyle) -> RestingOverlayState {
    match style {
        OverlayStyle::None => RestingOverlayState::Hidden,
        OverlayStyle::Minimal | OverlayStyle::Live => RestingOverlayState::Ready,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum RequestedOverlayState {
    Hidden = 0,
    Idle = 1,
    Recording = 2,
    Streaming = 3,
    Transcribing = 4,
    Processing = 5,
}

impl RequestedOverlayState {
    fn from_state_name(state: &str) -> Option<Self> {
        match state {
            "idle" => Some(Self::Idle),
            "recording" => Some(Self::Recording),
            "streaming" => Some(Self::Streaming),
            "transcribing" => Some(Self::Transcribing),
            "processing" => Some(Self::Processing),
            _ => None,
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Idle,
            2 => Self::Recording,
            3 => Self::Streaming,
            4 => Self::Transcribing,
            5 => Self::Processing,
            _ => Self::Hidden,
        }
    }

    fn state_name(self) -> Option<&'static str> {
        match self {
            Self::Hidden => None,
            Self::Idle => Some("idle"),
            Self::Recording => Some("recording"),
            Self::Streaming => Some("streaming"),
            Self::Transcribing => Some("transcribing"),
            Self::Processing => Some("processing"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayVisibilityAction {
    WaitForFrontend,
    Hide,
    PrepareHidden(RequestedOverlayState),
    Show(RequestedOverlayState),
}

fn overlay_visibility_action(
    frontend_ready: bool,
    style: OverlayStyle,
    requested: RequestedOverlayState,
) -> OverlayVisibilityAction {
    if requested == RequestedOverlayState::Hidden {
        OverlayVisibilityAction::Hide
    } else if !frontend_ready {
        OverlayVisibilityAction::WaitForFrontend
    } else if style == OverlayStyle::None {
        OverlayVisibilityAction::PrepareHidden(requested)
    } else {
        OverlayVisibilityAction::Show(requested)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlaySyncAction {
    HideNativePreservingState,
    EstablishIdle,
    WaitForFrontend,
    Refresh(RequestedOverlayState),
}

fn overlay_sync_action(
    frontend_ready: bool,
    style: OverlayStyle,
    requested: RequestedOverlayState,
) -> OverlaySyncAction {
    if style == OverlayStyle::None {
        OverlaySyncAction::HideNativePreservingState
    } else if requested == RequestedOverlayState::Hidden {
        OverlaySyncAction::EstablishIdle
    } else if !frontend_ready {
        OverlaySyncAction::WaitForFrontend
    } else {
        OverlaySyncAction::Refresh(requested)
    }
}

static OVERLAY_FRONTEND_READY: AtomicBool = AtomicBool::new(false);
static OVERLAY_READY_LISTENER_INSTALLED: AtomicBool = AtomicBool::new(false);
static OVERLAY_CAPTURE_READY: AtomicBool = AtomicBool::new(false);
static REQUESTED_OVERLAY_STATE: AtomicU64 = AtomicU64::new(RequestedOverlayState::Hidden as u64);

static LAST_MIC_LEVEL_EMIT: AtomicU64 = AtomicU64::new(0);
const EMIT_THROTTLE_MS: u64 = 33; // ~30 FPS

#[cfg(target_os = "macos")]
const OVERLAY_TOP_OFFSET: f64 = 46.0;
#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_TOP_OFFSET: f64 = 4.0;

#[cfg(target_os = "macos")]
const OVERLAY_BOTTOM_OFFSET: f64 = 15.0;

#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_BOTTOM_OFFSET: f64 = 40.0;

const OVERLAY_HORIZONTAL_OFFSET: f64 = 12.0;

fn classic_overlay_anchor(position: OverlayPosition) -> ThemeOverlayAnchor {
    match position {
        OverlayPosition::Top => ThemeOverlayAnchor::TopCenter,
        OverlayPosition::Bottom => ThemeOverlayAnchor::BottomCenter,
    }
}

fn resolved_overlay_anchor(
    theme: Option<OverlayWindowConfig>,
    position: OverlayPosition,
) -> ThemeOverlayAnchor {
    let Some(theme) = theme else {
        return classic_overlay_anchor(position);
    };
    let theme_anchor = theme.anchor;
    let aligns_left = matches!(
        theme_anchor,
        ThemeOverlayAnchor::TopLeft
            | ThemeOverlayAnchor::CenterLeft
            | ThemeOverlayAnchor::BottomLeft
    );
    let aligns_right = matches!(
        theme_anchor,
        ThemeOverlayAnchor::TopRight
            | ThemeOverlayAnchor::CenterRight
            | ThemeOverlayAnchor::BottomRight
    );

    match (position, aligns_left, aligns_right) {
        (OverlayPosition::Top, true, _) => ThemeOverlayAnchor::TopLeft,
        (OverlayPosition::Top, _, true) => ThemeOverlayAnchor::TopRight,
        (OverlayPosition::Top, _, _) => ThemeOverlayAnchor::TopCenter,
        (OverlayPosition::Bottom, true, _) => ThemeOverlayAnchor::BottomLeft,
        (OverlayPosition::Bottom, _, true) => ThemeOverlayAnchor::BottomRight,
        (OverlayPosition::Bottom, _, _) => ThemeOverlayAnchor::BottomCenter,
    }
}

fn overlay_anchor(app_handle: &AppHandle) -> ThemeOverlayAnchor {
    let position = settings::get_settings(app_handle).overlay_position;
    resolved_overlay_anchor(
        crate::theme_packs::active_overlay_window_config(app_handle),
        position,
    )
}

/// Configures the edge and offset of a GTK layer surface. gtk-layer-shell
/// commits anchor and margin changes itself, including while the surface is
/// mapped, so changing position does not require a manual hide/show cycle.
#[cfg(target_os = "linux")]
fn configure_layer_shell_position(gtk_window: &gtk::ApplicationWindow, anchor: ThemeOverlayAnchor) {
    for edge in [Edge::Top, Edge::Right, Edge::Bottom, Edge::Left] {
        gtk_window.set_anchor(edge, false);
        gtk_window.set_layer_shell_margin(edge, 0);
    }

    match anchor {
        ThemeOverlayAnchor::TopLeft
        | ThemeOverlayAnchor::TopCenter
        | ThemeOverlayAnchor::TopRight => {
            gtk_window.set_anchor(Edge::Top, true);
            gtk_window.set_layer_shell_margin(Edge::Top, OVERLAY_TOP_OFFSET.round() as i32);
        }
        ThemeOverlayAnchor::BottomLeft
        | ThemeOverlayAnchor::BottomCenter
        | ThemeOverlayAnchor::BottomRight => {
            gtk_window.set_anchor(Edge::Bottom, true);
            gtk_window.set_layer_shell_margin(Edge::Bottom, OVERLAY_BOTTOM_OFFSET.round() as i32);
        }
        ThemeOverlayAnchor::CenterLeft
        | ThemeOverlayAnchor::Center
        | ThemeOverlayAnchor::CenterRight => {}
    }

    match anchor {
        ThemeOverlayAnchor::TopLeft
        | ThemeOverlayAnchor::CenterLeft
        | ThemeOverlayAnchor::BottomLeft => {
            gtk_window.set_anchor(Edge::Left, true);
            gtk_window.set_layer_shell_margin(Edge::Left, OVERLAY_HORIZONTAL_OFFSET.round() as i32);
        }
        ThemeOverlayAnchor::TopRight
        | ThemeOverlayAnchor::CenterRight
        | ThemeOverlayAnchor::BottomRight => {
            gtk_window.set_anchor(Edge::Right, true);
            gtk_window
                .set_layer_shell_margin(Edge::Right, OVERLAY_HORIZONTAL_OFFSET.round() as i32);
        }
        ThemeOverlayAnchor::TopCenter
        | ThemeOverlayAnchor::Center
        | ThemeOverlayAnchor::BottomCenter => {}
    }
}

/// Configures a GTK layer surface before it is shown.
///
/// Tauri's normal `set_size` path calls `gtk_window_resize`, but layer surfaces
/// derive their dimensions from GTK's size request. gtk-layer-shell documents
/// the `set_size_request` + `resize(1, 1)` sequence for forcing a new size.
#[cfg(target_os = "linux")]
fn configure_layer_shell_surface(
    gtk_window: &gtk::ApplicationWindow,
    anchor: ThemeOverlayAnchor,
    width: f64,
    height: f64,
) {
    use gtk::prelude::{GtkWindowExt, WidgetExt};

    configure_layer_shell_position(gtk_window, anchor);

    gtk_window.set_size_request(
        width.round().max(1.0) as i32,
        height.round().max(1.0) as i32,
    );
    gtk_window.resize(1, 1);
}

/// Returns true when the environment variable is set to a truthy value
/// (e.g. "1", "true", "yes", "on").
/// "0", "false", "no", "off" and empty string are treated as falsy (case-insensitive).
/// Returns false when the variable is not set.
#[cfg(target_os = "linux")]
fn env_flag_enabled(name: &str) -> bool {
    match env::var(name) {
        Ok(v) => !matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "" | "0" | "false" | "no" | "off"
        ),
        Err(_) => false,
    }
}

/// Initializes GTK layer shell for Linux overlay window
/// Returns true if layer shell was successfully initialized, false otherwise
#[cfg(target_os = "linux")]
fn init_gtk_layer_shell(overlay_window: &tauri::webview::WebviewWindow) -> bool {
    if env_flag_enabled("HANDY_NO_GTK_LAYER_SHELL") {
        debug!("Skipping GTK layer shell init (HANDY_NO_GTK_LAYER_SHELL is enabled)");
        return false;
    }

    if !gtk_layer_shell::is_supported() {
        return false;
    }

    // Try to get the GTK window from the Tauri webview
    if let Ok(gtk_window) = overlay_window.gtk_window() {
        gtk_window.init_layer_shell();
        gtk_window.set_layer(Layer::Overlay);
        gtk_window.set_keyboard_mode(KeyboardMode::None);
        gtk_window.set_exclusive_zone(0);

        let anchor = overlay_anchor(overlay_window.app_handle());
        let (width, height) = overlay_dimensions(overlay_window.app_handle(), "idle");
        configure_layer_shell_surface(&gtk_window, anchor, width, height);

        let initialized = gtk_window.is_layer_window();
        LAYER_SHELL_ACTIVE.store(initialized, Ordering::SeqCst);
        return initialized;
    }
    false
}

/// Forces a window to be topmost using Win32 API (Windows only)
/// This is more reliable than Tauri's set_always_on_top which can be overridden
#[cfg(target_os = "windows")]
fn force_overlay_topmost(overlay_window: &tauri::webview::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    // Clone because run_on_main_thread takes 'static
    let overlay_clone = overlay_window.clone();

    // Make sure the Win32 call happens on the UI thread
    let _ = overlay_clone.clone().run_on_main_thread(move || {
        if let Ok(hwnd) = overlay_clone.hwnd() {
            unsafe {
                // Force Z-order: make this window topmost without changing size/pos or stealing focus
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    });
}

fn get_monitor_with_cursor(app_handle: &AppHandle) -> Option<tauri::Monitor> {
    if let Some(mouse_location) = input::get_cursor_position(app_handle) {
        if let Ok(monitors) = app_handle.available_monitors() {
            for monitor in monitors {
                // On Windows both the cursor (enigo -> GetCursorPos) and the
                // monitor bounds are physical pixels, so compare them directly.
                #[cfg(target_os = "windows")]
                if is_mouse_within_monitor(mouse_location, monitor.position(), monitor.size()) {
                    return Some(monitor);
                }

                // macOS/Linux: enigo returns logical coords, so scale the bounds down.
                #[cfg(not(target_os = "windows"))]
                {
                    let scale = monitor.scale_factor();
                    let pos = PhysicalPosition::new(
                        (monitor.position().x as f64 / scale) as i32,
                        (monitor.position().y as f64 / scale) as i32,
                    );
                    let size = PhysicalSize::new(
                        (monitor.size().width as f64 / scale) as u32,
                        (monitor.size().height as f64 / scale) as u32,
                    );
                    if is_mouse_within_monitor(mouse_location, &pos, &size) {
                        return Some(monitor);
                    }
                }
            }
        }
    }

    app_handle.primary_monitor().ok().flatten()
}

fn is_mouse_within_monitor(
    mouse_pos: (i32, i32),
    monitor_pos: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> bool {
    let (mouse_x, mouse_y) = mouse_pos;
    let PhysicalPosition {
        x: monitor_x,
        y: monitor_y,
    } = *monitor_pos;
    let PhysicalSize {
        width: monitor_width,
        height: monitor_height,
    } = *monitor_size;

    mouse_x >= monitor_x
        && mouse_x < (monitor_x + monitor_width as i32)
        && mouse_y >= monitor_y
        && mouse_y < (monitor_y + monitor_height as i32)
}

/// Returns overlay position in logical coordinates (points on macOS).
///
/// The Bottom anchor uses the macOS work area (visibleFrame) so the overlay
/// tracks the Dock — above it when shown, at the screen edge when hidden.
/// This relies on tauri 2.11's work_area.position.y fix (#14655), the same
/// bug that led PR #969 to abandon work_area for full monitor bounds. Top and
/// the other platforms keep full monitor bounds plus the fixed offsets
/// (work_area is unreliable on Wayland; Windows' offset clears the taskbar).
///
/// We must use LogicalPosition (not PhysicalPosition) because Tauri/tao
/// converts PhysicalPosition using the scale factor of the monitor the window
/// is *currently* on, which is wrong when moving cross-monitor. Windows uses
/// `place_windows_overlay` instead (no single logical space across mixed DPI).
fn calculate_overlay_position(
    app_handle: &AppHandle,
    width: f64,
    height: f64,
) -> Option<(f64, f64)> {
    let monitor = get_monitor_with_cursor(app_handle)?;
    let scale = monitor.scale_factor();
    let monitor_x = monitor.position().x as f64 / scale;
    let monitor_y = monitor.position().y as f64 / scale;
    let monitor_width = monitor.size().width as f64 / scale;
    let monitor_height = monitor.size().height as f64 / scale;
    // work_area.position shares monitor.position's global coordinate space.
    #[cfg(target_os = "macos")]
    let bottom = {
        let work_area = monitor.work_area();
        (work_area.position.y as f64 + work_area.size.height as f64) / scale
    };
    #[cfg(not(target_os = "macos"))]
    let bottom = monitor_y + monitor_height;

    Some(logical_overlay_origin(
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        bottom,
        width,
        height,
        overlay_anchor(app_handle),
    ))
}

fn logical_overlay_origin(
    monitor_x: f64,
    monitor_y: f64,
    monitor_width: f64,
    monitor_height: f64,
    bottom: f64,
    width: f64,
    height: f64,
    anchor: ThemeOverlayAnchor,
) -> (f64, f64) {
    let x = match anchor {
        ThemeOverlayAnchor::TopLeft
        | ThemeOverlayAnchor::CenterLeft
        | ThemeOverlayAnchor::BottomLeft => monitor_x + OVERLAY_HORIZONTAL_OFFSET,
        ThemeOverlayAnchor::TopCenter
        | ThemeOverlayAnchor::Center
        | ThemeOverlayAnchor::BottomCenter => monitor_x + (monitor_width - width) / 2.0,
        ThemeOverlayAnchor::TopRight
        | ThemeOverlayAnchor::CenterRight
        | ThemeOverlayAnchor::BottomRight => {
            monitor_x + monitor_width - width - OVERLAY_HORIZONTAL_OFFSET
        }
    };
    let y = match anchor {
        ThemeOverlayAnchor::TopLeft
        | ThemeOverlayAnchor::TopCenter
        | ThemeOverlayAnchor::TopRight => monitor_y + OVERLAY_TOP_OFFSET,
        ThemeOverlayAnchor::CenterLeft
        | ThemeOverlayAnchor::Center
        | ThemeOverlayAnchor::CenterRight => monitor_y + (monitor_height - height) / 2.0,
        ThemeOverlayAnchor::BottomLeft
        | ThemeOverlayAnchor::BottomCenter
        | ThemeOverlayAnchor::BottomRight => bottom - height - OVERLAY_BOTTOM_OFFSET,
    };
    (x, y)
}

/// Current overlay window size in logical units (points), for repositioning
/// without assuming a fixed size (compact vs. streaming).
#[cfg(not(target_os = "windows"))]
fn current_overlay_logical_size(window: &tauri::webview::WebviewWindow) -> Option<(f64, f64)> {
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    Some((size.width as f64 / scale, size.height as f64 / scale))
}

#[cfg(target_os = "windows")]
static WINDOWS_OVERLAY_IS_STREAMING: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static WINDOWS_OVERLAY_IS_IDLE: AtomicBool = AtomicBool::new(true);

/// Overlay rectangle in the destination monitor's physical pixels, so nothing
/// is converted through the window's previous-monitor DPI.
#[cfg(target_os = "windows")]
fn windows_overlay_bounds(
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
    scale: f64,
    logical_width: f64,
    logical_height: f64,
    anchor: ThemeOverlayAnchor,
) -> (i32, i32, i32, i32) {
    let width = (logical_width * scale).round().max(1.0) as i32;
    let height = (logical_height * scale).round().max(1.0) as i32;
    let x = match anchor {
        ThemeOverlayAnchor::TopLeft
        | ThemeOverlayAnchor::CenterLeft
        | ThemeOverlayAnchor::BottomLeft => {
            (monitor_position.x as f64 + OVERLAY_HORIZONTAL_OFFSET * scale).round() as i32
        }
        ThemeOverlayAnchor::TopCenter
        | ThemeOverlayAnchor::Center
        | ThemeOverlayAnchor::BottomCenter => (monitor_position.x as f64
            + (monitor_size.width as f64 - width as f64) / 2.0)
            .round() as i32,
        ThemeOverlayAnchor::TopRight
        | ThemeOverlayAnchor::CenterRight
        | ThemeOverlayAnchor::BottomRight => (monitor_position.x as f64 + monitor_size.width as f64
            - width as f64
            - OVERLAY_HORIZONTAL_OFFSET * scale)
            .round() as i32,
    };
    let y = match anchor {
        ThemeOverlayAnchor::TopLeft
        | ThemeOverlayAnchor::TopCenter
        | ThemeOverlayAnchor::TopRight => {
            (monitor_position.y as f64 + OVERLAY_TOP_OFFSET * scale).round() as i32
        }
        ThemeOverlayAnchor::CenterLeft
        | ThemeOverlayAnchor::Center
        | ThemeOverlayAnchor::CenterRight => (monitor_position.y as f64
            + (monitor_size.height as f64 - height as f64) / 2.0)
            .round() as i32,
        ThemeOverlayAnchor::BottomLeft
        | ThemeOverlayAnchor::BottomCenter
        | ThemeOverlayAnchor::BottomRight => (monitor_position.y as f64
            + monitor_size.height as f64
            - height as f64
            - OVERLAY_BOTTOM_OFFSET * scale)
            .round() as i32,
    };

    (x, y, width, height)
}

/// Moves and sizes the overlay in one native SetWindowPos, bypassing tao's
/// current-DPI logical conversion that mislands cross-monitor moves.
#[cfg(target_os = "windows")]
fn place_windows_overlay(
    app_handle: &AppHandle,
    overlay_window: &tauri::webview::WebviewWindow,
    logical_width: f64,
    logical_height: f64,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

    let monitor = get_monitor_with_cursor(app_handle)
        .ok_or_else(|| "failed to determine the monitor containing the cursor".to_string())?;
    let (x, y, width, height) = windows_overlay_bounds(
        *monitor.position(),
        *monitor.size(),
        monitor.scale_factor(),
        logical_width,
        logical_height,
        overlay_anchor(app_handle),
    );
    let hwnd = overlay_window
        .hwnd()
        .map_err(|error| format!("failed to get overlay window handle: {error}"))?;

    unsafe {
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|error| format!("failed to set overlay bounds: {error}"))?;
    }

    log::debug!(
        "windows overlay bounds: x={} y={} width={} height={} scale={}",
        x,
        y,
        width,
        height,
        monitor.scale_factor()
    );
    Ok(())
}

/// Creates the recording overlay window. Enabled overlays settle into a small
/// ready indicator once the webview has loaded.
#[cfg(not(target_os = "macos"))]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    prepare_overlay_readiness(app_handle);
    let (initial_width, initial_height) = overlay_dimensions(app_handle, "idle");
    // On Linux (Wayland), monitor detection often fails, but we don't need exact coordinates
    // for Layer Shell as we use anchors. On other platforms, we require a monitor.
    #[cfg(not(target_os = "linux"))]
    {
        let position = calculate_overlay_position(app_handle, initial_width, initial_height);
        if position.is_none() {
            debug!("Failed to determine overlay position, not creating overlay window");
            return;
        }
    }

    // Position starts unset — update_overlay_position() sets the correct
    // LogicalPosition before the overlay is shown.
    let mut builder = WebviewWindowBuilder::new(
        app_handle,
        "recording_overlay",
        tauri::WebviewUrl::App("src/overlay/index.html".into()),
    )
    .title("Recording")
    .resizable(false)
    .inner_size(initial_width, initial_height)
    .shadow(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .accept_first_mouse(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focusable(false)
    .focused(false)
    .visible(false);

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    #[allow(unused_variables)]
    let created = match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "linux")]
            {
                // Try to initialize GTK layer shell, ignore errors if compositor doesn't support it
                if init_gtk_layer_shell(&window) {
                    debug!("GTK layer shell initialized for overlay window");
                } else {
                    debug!("GTK layer shell not available, falling back to regular window");
                }
            }

            debug!("Recording overlay window created successfully");
            true
        }
        Err(e) => {
            debug!("Failed to create recording overlay window: {}", e);
            false
        }
    };

    if created {
        sync_overlay_visibility(app_handle);
    }
}

/// Creates the recording overlay panel (macOS).
#[cfg(target_os = "macos")]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    prepare_overlay_readiness(app_handle);
    let (initial_width, initial_height) = overlay_dimensions(app_handle, "idle");
    if let Some((x, y)) = calculate_overlay_position(app_handle, initial_width, initial_height) {
        // PanelBuilder creates a Tauri window then converts it to NSPanel.
        // The window remains registered, so get_webview_window() still works.
        let created =
            match PanelBuilder::<_, RecordingOverlayPanel>::new(app_handle, "recording_overlay")
                .url(WebviewUrl::App("src/overlay/index.html".into()))
                .title("Recording")
                .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
                .level(PanelLevel::Status)
                .size(tauri::Size::Logical(tauri::LogicalSize {
                    width: initial_width,
                    height: initial_height,
                }))
                .has_shadow(false)
                .transparent(true)
                .no_activate(true)
                .corner_radius(0.0)
                .style_mask(StyleMask::empty().borderless().nonactivating_panel())
                .with_window(|w| w.decorations(false).transparent(true).focusable(false))
                .collection_behavior(
                    CollectionBehavior::new()
                        .can_join_all_spaces()
                        .full_screen_auxiliary(),
                )
                .build()
            {
                Ok(panel) => {
                    panel.hide();
                    true
                }
                Err(e) => {
                    log::error!("Failed to create recording overlay panel: {}", e);
                    false
                }
            };

        if created {
            sync_overlay_visibility(app_handle);
        }
    }
}

fn prepare_overlay_readiness(app_handle: &AppHandle) {
    OVERLAY_FRONTEND_READY.store(false, Ordering::SeqCst);

    if OVERLAY_READY_LISTENER_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    let handle = app_handle.clone();
    app_handle.listen("overlay-ready", move |_| {
        if OVERLAY_FRONTEND_READY.swap(true, Ordering::SeqCst) {
            return;
        }
        apply_requested_overlay_state(&handle);
        emit_cached_recording_ready(&handle);
    });
}

fn requested_overlay_state() -> RequestedOverlayState {
    RequestedOverlayState::from_u8(REQUESTED_OVERLAY_STATE.load(Ordering::SeqCst) as u8)
}

fn request_overlay_state(app_handle: &AppHandle, requested: RequestedOverlayState) {
    REQUESTED_OVERLAY_STATE.store(requested as u64, Ordering::SeqCst);
    apply_requested_overlay_state(app_handle);
}

fn apply_requested_overlay_state(app_handle: &AppHandle) {
    let style = settings::get_settings(app_handle).overlay_style;
    match overlay_visibility_action(
        OVERLAY_FRONTEND_READY.load(Ordering::SeqCst),
        style,
        requested_overlay_state(),
    ) {
        OverlayVisibilityAction::WaitForFrontend => {}
        OverlayVisibilityAction::Hide => hide_overlay_window(app_handle),
        OverlayVisibilityAction::PrepareHidden(requested) => {
            hide_native_overlay_preserving_frontend(app_handle);
            if let Some(state) = requested.state_name() {
                if let Err(error) = app_handle.emit_to("recording_overlay", "show-overlay", state) {
                    log::error!("Failed to prepare hidden overlay state '{state}': {error}");
                }
            }
            emit_cached_recording_ready(app_handle);
        }
        OverlayVisibilityAction::Show(requested) => {
            if let Some(state) = requested.state_name() {
                schedule_overlay_state(app_handle, state);
            }
        }
    }
}

fn show_overlay_state(app_handle: &AppHandle, state: &str) {
    let Some(requested) = RequestedOverlayState::from_state_name(state) else {
        log::error!("Ignoring unknown overlay state request: {state}");
        return;
    };
    if matches!(
        requested,
        RequestedOverlayState::Recording | RequestedOverlayState::Streaming
    ) {
        OVERLAY_CAPTURE_READY.store(false, Ordering::SeqCst);
    }
    request_overlay_state(app_handle, requested);
}

fn schedule_overlay_state(app_handle: &AppHandle, state: &str) {
    schedule_overlay_state_with_notification(app_handle, state, true);
}

fn refresh_overlay_state(app_handle: &AppHandle, state: &str) {
    schedule_overlay_state_with_notification(app_handle, state, false);
}

fn schedule_overlay_state_with_notification(
    app_handle: &AppHandle,
    state: &str,
    notify_frontend: bool,
) {
    // The rest queries monitors and the cursor and mutates window geometry. On
    // Linux the monitor/cursor lookups hit GDK/Xlib on the process's shared X11
    // connection, which is only safe from the GTK main thread — running them on
    // a background thread corrupts the connection and hard-crashes the app
    // (issue #227). Hop to the main thread on every platform to keep the
    // geometry path uniform (a no-op cost on Windows, and it also keeps macOS's
    // NSScreen access main-thread-correct). run_on_main_thread runs the closure
    // inline when already on the main thread, so this never deadlocks.
    let handle = app_handle.clone();
    let state = state.to_string();
    let _ = app_handle
        .run_on_main_thread(move || show_overlay_state_on_main(&handle, &state, notify_frontend));
}

fn show_overlay_state_on_main(app_handle: &AppHandle, state: &str, notify_frontend: bool) {
    let Some(expected) = RequestedOverlayState::from_state_name(state) else {
        return;
    };
    let current_style = settings::get_settings(app_handle).overlay_style;
    if overlay_visibility_action(
        OVERLAY_FRONTEND_READY.load(Ordering::SeqCst),
        current_style,
        requested_overlay_state(),
    ) != OverlayVisibilityAction::Show(expected)
    {
        return;
    }

    // Size the overlay for this state (compact vs. streaming), then position it.
    let theme_window = crate::theme_packs::active_overlay_window_config(app_handle);
    let (width, height) = resolved_overlay_dimensions(theme_window, state);
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Invalidate any delayed hide still in flight from a previous session
        // (see `hide_recording_overlay`).
        OVERLAY_SHOW_GENERATION.fetch_add(1, Ordering::SeqCst);

        // The always-on ready rectangle is informational and must never block
        // clicks in the application beneath it. Active states restore pointer
        // input for the cancel button.
        if let Err(error) =
            overlay_window.set_ignore_cursor_events(should_ignore_cursor(theme_window, state))
        {
            log::error!("Failed to update overlay pointer behavior for state '{state}': {error}");
            if state == "idle" {
                if let Err(hide_error) = overlay_window.hide() {
                    log::error!(
                        "Failed to hide idle overlay after pointer passthrough failed: {hide_error}"
                    );
                }
                return;
            }
        }

        #[cfg(target_os = "linux")]
        let shown_with_layer_shell = if LAYER_SHELL_ACTIVE.load(Ordering::SeqCst) {
            let anchor = overlay_anchor(app_handle);
            match overlay_window.gtk_window() {
                Ok(gtk_window) => configure_layer_shell_surface(&gtk_window, anchor, width, height),
                Err(error) => log::error!("Failed to access GTK overlay window: {error}"),
            }
            let _ = overlay_window.show();
            true
        } else {
            false
        };
        #[cfg(not(target_os = "linux"))]
        let shown_with_layer_shell = false;

        if !shown_with_layer_shell {
            let size_started = std::time::Instant::now();
            #[cfg(not(target_os = "windows"))]
            let _ =
                overlay_window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            #[cfg(target_os = "windows")]
            {
                WINDOWS_OVERLAY_IS_STREAMING.store(state == "streaming", Ordering::Relaxed);
                WINDOWS_OVERLAY_IS_IDLE.store(state == "idle", Ordering::Relaxed);
            }
            let size_elapsed = size_started.elapsed();

            let pos_started = std::time::Instant::now();
            #[cfg(not(target_os = "windows"))]
            let set_pos_elapsed =
                if let Some((x, y)) = calculate_overlay_position(app_handle, width, height) {
                    let set_pos_started = std::time::Instant::now();
                    let _ = overlay_window
                        .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
                    set_pos_started.elapsed()
                } else {
                    std::time::Duration::ZERO
                };
            #[cfg(target_os = "windows")]
            let set_pos_elapsed = {
                let set_pos_started = std::time::Instant::now();
                if let Err(error) =
                    place_windows_overlay(app_handle, &overlay_window, width, height)
                {
                    log::error!("Failed to place recording overlay: {error}");
                }
                set_pos_started.elapsed()
            };
            let pos_calc_elapsed = pos_started.elapsed() - set_pos_elapsed;

            let show_started = std::time::Instant::now();
            let _ = overlay_window.show();
            let show_elapsed = show_started.elapsed();

            // On Windows, aggressively re-assert "topmost" in the native Z-order after showing
            #[cfg(target_os = "windows")]
            force_overlay_topmost(&overlay_window);

            // Re-assert bounds after show(): the pre-show move crosses the DPI
            // boundary, and tao's WM_DPICHANGED reflow clobbers the first placement.
            #[cfg(target_os = "windows")]
            if let Err(error) = place_windows_overlay(app_handle, &overlay_window, width, height) {
                log::error!("Failed to re-assert recording overlay position: {error}");
            }

            log::debug!(
                "overlay '{}': set_size={:?} pos_calc={:?} set_pos={:?} show={:?}",
                state,
                size_elapsed,
                pos_calc_elapsed,
                set_pos_elapsed,
                show_elapsed
            );
        }

        if notify_frontend {
            let _ = overlay_window.emit("show-overlay", state);
        }
    }
}

/// Notify the visible recording overlay that the input stream has delivered its
/// first sample chunk. This targeted event is skipped when overlays are disabled.
pub fn emit_recording_ready(app_handle: &AppHandle) {
    OVERLAY_CAPTURE_READY.store(true, Ordering::SeqCst);
    emit_cached_recording_ready(app_handle);
}

fn emit_cached_recording_ready(app_handle: &AppHandle) {
    if !should_emit_recording_ready(
        OVERLAY_FRONTEND_READY.load(Ordering::SeqCst),
        OVERLAY_CAPTURE_READY.load(Ordering::SeqCst),
        requested_overlay_state(),
    ) {
        return;
    }

    // Showing the overlay is also queued onto the main thread. Queue readiness
    // there as well so a very fast always-on stream cannot overtake show-overlay
    // and then get reset back to the arming state by the frontend.
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        let _ = handle.emit_to("recording_overlay", "recording-ready", ());
    });
}

fn should_emit_recording_ready(
    frontend_ready: bool,
    capture_ready: bool,
    requested: RequestedOverlayState,
) -> bool {
    frontend_ready
        && capture_ready
        && matches!(
            requested,
            RequestedOverlayState::Recording | RequestedOverlayState::Streaming
        )
}

/// Shows the recording overlay window with fade-in animation
pub fn show_recording_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "recording");
}

/// Shows the larger streaming overlay that displays live transcription text
pub fn show_streaming_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "streaming");
}

/// Shows the transcribing overlay window
pub fn show_transcribing_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "transcribing");
}

/// Shows the processing overlay window
pub fn show_processing_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "processing");
}

/// Updates the overlay window position based on current settings
pub fn update_overlay_position(app_handle: &AppHandle) {
    // Positioning queries monitors/cursor (GDK/Xlib on Linux) and moves the
    // window, so it must run on the main thread — see show_overlay_state.
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || update_overlay_position_on_main(&handle));
}

fn update_overlay_position_on_main(app_handle: &AppHandle) {
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        #[cfg(target_os = "linux")]
        if LAYER_SHELL_ACTIVE.load(Ordering::SeqCst) {
            let anchor = overlay_anchor(app_handle);
            match overlay_window.gtk_window() {
                Ok(gtk_window) => configure_layer_shell_position(&gtk_window, anchor),
                Err(error) => log::error!("Failed to access GTK overlay window: {error}"),
            }
            return;
        }

        #[cfg(target_os = "windows")]
        {
            let state = if WINDOWS_OVERLAY_IS_STREAMING.load(Ordering::Relaxed) {
                "streaming"
            } else if WINDOWS_OVERLAY_IS_IDLE.load(Ordering::Relaxed) {
                "idle"
            } else {
                "recording"
            };
            let (width, height) = overlay_dimensions(app_handle, state);
            if let Err(error) = place_windows_overlay(app_handle, &overlay_window, width, height) {
                log::error!("Failed to update recording overlay position: {error}");
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            // Use the window's current size so centering stays correct whether the
            // overlay is in compact or streaming layout.
            let (width, height) = current_overlay_logical_size(&overlay_window)
                .unwrap_or((OVERLAY_WIDTH, OVERLAY_HEIGHT));
            if let Some((x, y)) = calculate_overlay_position(app_handle, width, height) {
                let _ = overlay_window
                    .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
            }
        }
    }
}

/// Generation counter bumped every time the overlay is shown. The delayed
/// `hide()` below only unmaps the window if no show happened after it was
/// scheduled, so a hide left over from a finished transcription can never
/// take down the overlay of a session that started in the meantime — e.g. a
/// press the coordinator remembered while the pipeline was busy and started
/// the instant it drained, well inside the 300 ms hide delay.
static OVERLAY_SHOW_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Returns the overlay to its small ready indicator. If overlays are disabled,
/// the native window is hidden instead.
pub fn hide_recording_overlay(app_handle: &AppHandle) {
    OVERLAY_CAPTURE_READY.store(false, Ordering::SeqCst);
    match resting_overlay_state(settings::get_settings(app_handle).overlay_style) {
        RestingOverlayState::Ready => show_overlay_state(app_handle, "idle"),
        RestingOverlayState::Hidden => {
            request_overlay_state(app_handle, RequestedOverlayState::Hidden)
        }
    }
}

/// Applies the current overlay preference immediately. Used at startup and
/// whenever the user changes the overlay style.
pub fn sync_overlay_visibility(app_handle: &AppHandle) {
    let style = settings::get_settings(app_handle).overlay_style;
    let current = requested_overlay_state();
    match overlay_sync_action(
        OVERLAY_FRONTEND_READY.load(Ordering::SeqCst),
        style,
        current,
    ) {
        OverlaySyncAction::HideNativePreservingState => {
            hide_native_overlay_preserving_frontend(app_handle)
        }
        OverlaySyncAction::EstablishIdle => {
            request_overlay_state(app_handle, RequestedOverlayState::Idle)
        }
        OverlaySyncAction::WaitForFrontend => {}
        OverlaySyncAction::Refresh(requested) => {
            if let Some(state) = requested.state_name() {
                refresh_overlay_state(app_handle, state);
            }
        }
    }
}

fn hide_native_overlay_preserving_frontend(app_handle: &AppHandle) {
    OVERLAY_SHOW_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        if let Err(error) = overlay_window.hide() {
            log::error!("Failed to hide disabled overlay window: {error}");
        }
    }
}

/// Hides the native overlay window with a fade-out animation.
fn hide_overlay_window(app_handle: &AppHandle) {
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Snapshot before doing anything observable, so any show that lands
        // after this point invalidates the delayed hide below.
        let scheduled_at = OVERLAY_SHOW_GENERATION.load(Ordering::SeqCst);
        // Emit event to trigger fade-out animation
        let _ = overlay_window.emit("hide-overlay", ());
        // Hide the window after a short delay to allow animation to complete,
        // unless a newer session has shown the overlay again by then.
        let window_clone = overlay_window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            if OVERLAY_SHOW_GENERATION.load(Ordering::SeqCst) != scheduled_at {
                log::debug!("Skipping stale overlay hide: a newer session is showing the overlay");
                return;
            }
            let _ = window_clone.hide();
        });
    }
}

// Cached "overlay is enabled" flag, kept in sync with overlay_style. Avoids
// reading the Tauri store on every audio callback (~24 Hz during recording).
// Defaults to false so the audio path doesn't emit until lib.rs::setup
// populates the cache from initial settings.
static OVERLAY_ENABLED: AtomicBool = AtomicBool::new(false);

/// Tracks whether gtk-layer-shell was successfully initialized (Linux only).
/// Used to skip layer-shell calls when the window is a regular fallback.
#[cfg(target_os = "linux")]
static LAYER_SHELL_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Update the cached overlay-enabled flag. Called from `lib.rs` at
/// startup after settings load, and from `change_overlay_style_setting`
/// whenever the user changes whether the overlay is shown.
pub fn update_overlay_enabled_cache(enabled: bool) {
    OVERLAY_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn emit_levels(app_handle: &AppHandle, levels: &[f32]) {
    // Skip emission when the overlay is disabled. The recording_overlay
    // window is created at boot regardless of overlay_style, so without this
    // guard a hidden overlay's WebKit subprocess still
    // processes every event. Each event drives some kind of WebKit
    // C++ allocation that accumulates without bound (mechanism not
    // directly characterized; see issue #1279 for the investigation).
    // For users with `overlay_style: none` (the Linux default) this skip
    // eliminates the upstream driver of that accumulation.
    if !OVERLAY_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    // Throttle to ~30 FPS. Even with the overlay enabled, the raw audio
    // callback fires far faster than the UI needs; capping emission rate
    // cuts the per-frame `eval_script`/IPC volume that drives the wry
    // memory growth in issue #1279 (upstream tauri-apps/wry#1489).
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let last = LAST_MIC_LEVEL_EMIT.load(Ordering::Relaxed);
    if now.saturating_sub(last) < EMIT_THROTTLE_MS {
        return;
    }
    LAST_MIC_LEVEL_EMIT.store(now, Ordering::Relaxed);

    // Target only the overlay window. In Tauri 2 both `AppHandle::emit`
    // and `WebviewWindow::emit` broadcast to all webviews; Tauri's
    // listener filter then skips webviews with no registered listener
    // for the event, so the settings webview never received `mic-level`.
    // But the previous dual-call pattern still produced two `eval_script`
    // calls to the overlay per audio callback (one from each .emit()).
    // `emit_to` with the overlay's window label produces a single
    // eval_script call per callback, cutting the per-callback WebKit
    // dispatch work in half.
    let _ = app_handle.emit_to("recording_overlay", "mic-level", levels);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_overlay_settles_into_ready_indicator() {
        assert_eq!(
            resting_overlay_state(OverlayStyle::Live),
            RestingOverlayState::Ready
        );
        assert_eq!(
            resting_overlay_state(OverlayStyle::Minimal),
            RestingOverlayState::Ready
        );
        assert_eq!(
            resting_overlay_state(OverlayStyle::None),
            RestingOverlayState::Hidden
        );
        assert_eq!(
            classic_overlay_dimensions("idle"),
            (OVERLAY_IDLE_WIDTH, OVERLAY_IDLE_HEIGHT)
        );
    }

    #[test]
    fn native_overlay_waits_for_frontend_before_showing_requested_state() {
        assert_eq!(
            overlay_visibility_action(false, OverlayStyle::Live, RequestedOverlayState::Recording,),
            OverlayVisibilityAction::WaitForFrontend
        );
        assert_eq!(
            overlay_visibility_action(true, OverlayStyle::Live, RequestedOverlayState::Recording,),
            OverlayVisibilityAction::Show(RequestedOverlayState::Recording)
        );
    }

    #[test]
    fn disabled_or_explicitly_hidden_overlay_never_shows() {
        assert_eq!(
            overlay_visibility_action(true, OverlayStyle::None, RequestedOverlayState::Streaming,),
            OverlayVisibilityAction::PrepareHidden(RequestedOverlayState::Streaming)
        );
        assert_eq!(
            overlay_visibility_action(false, OverlayStyle::None, RequestedOverlayState::Streaming,),
            OverlayVisibilityAction::WaitForFrontend
        );
        assert_eq!(
            overlay_visibility_action(true, OverlayStyle::Minimal, RequestedOverlayState::Hidden,),
            OverlayVisibilityAction::Hide
        );
    }

    #[test]
    fn visibility_sync_preserves_active_work_and_only_establishes_idle_from_hidden() {
        assert_eq!(
            overlay_sync_action(true, OverlayStyle::Live, RequestedOverlayState::Recording),
            OverlaySyncAction::Refresh(RequestedOverlayState::Recording)
        );
        assert_eq!(
            overlay_sync_action(
                true,
                OverlayStyle::Minimal,
                RequestedOverlayState::Processing
            ),
            OverlaySyncAction::Refresh(RequestedOverlayState::Processing)
        );
        assert_eq!(
            overlay_sync_action(true, OverlayStyle::Live, RequestedOverlayState::Hidden),
            OverlaySyncAction::EstablishIdle
        );
        assert_eq!(
            overlay_sync_action(true, OverlayStyle::None, RequestedOverlayState::Streaming),
            OverlaySyncAction::HideNativePreservingState
        );
        assert_eq!(
            overlay_sync_action(
                false,
                OverlayStyle::Live,
                RequestedOverlayState::Transcribing
            ),
            OverlaySyncAction::WaitForFrontend
        );
    }

    #[test]
    fn cached_microphone_readiness_replays_only_for_active_capture() {
        assert!(should_emit_recording_ready(
            true,
            true,
            RequestedOverlayState::Recording
        ));
        assert!(should_emit_recording_ready(
            true,
            true,
            RequestedOverlayState::Streaming
        ));
        assert!(!should_emit_recording_ready(
            false,
            true,
            RequestedOverlayState::Recording
        ));
        assert!(!should_emit_recording_ready(
            true,
            false,
            RequestedOverlayState::Recording
        ));
        assert!(!should_emit_recording_ready(
            true,
            true,
            RequestedOverlayState::Processing
        ));
    }

    #[test]
    fn theme_canvas_size_and_pointer_mode_apply_to_every_state() {
        let theme = OverlayWindowConfig {
            width: 384,
            height: 256,
            anchor: ThemeOverlayAnchor::BottomCenter,
            pointer_mode: ThemePointerMode::Passthrough,
        };
        assert_eq!(
            resolved_overlay_dimensions(Some(theme), "idle"),
            (384.0, 256.0)
        );
        assert_eq!(
            resolved_overlay_dimensions(Some(theme), "streaming"),
            (384.0, 256.0)
        );
        assert!(should_ignore_cursor(Some(theme), "recording"));
        assert!(should_ignore_cursor(None, "idle"));
        assert!(!should_ignore_cursor(None, "recording"));
    }

    #[test]
    fn user_vertical_position_overrides_theme_anchor_and_keeps_horizontal_alignment() {
        let cases = [
            (
                ThemeOverlayAnchor::TopLeft,
                ThemeOverlayAnchor::TopLeft,
                ThemeOverlayAnchor::BottomLeft,
            ),
            (
                ThemeOverlayAnchor::CenterLeft,
                ThemeOverlayAnchor::TopLeft,
                ThemeOverlayAnchor::BottomLeft,
            ),
            (
                ThemeOverlayAnchor::BottomLeft,
                ThemeOverlayAnchor::TopLeft,
                ThemeOverlayAnchor::BottomLeft,
            ),
            (
                ThemeOverlayAnchor::TopCenter,
                ThemeOverlayAnchor::TopCenter,
                ThemeOverlayAnchor::BottomCenter,
            ),
            (
                ThemeOverlayAnchor::Center,
                ThemeOverlayAnchor::TopCenter,
                ThemeOverlayAnchor::BottomCenter,
            ),
            (
                ThemeOverlayAnchor::BottomCenter,
                ThemeOverlayAnchor::TopCenter,
                ThemeOverlayAnchor::BottomCenter,
            ),
            (
                ThemeOverlayAnchor::TopRight,
                ThemeOverlayAnchor::TopRight,
                ThemeOverlayAnchor::BottomRight,
            ),
            (
                ThemeOverlayAnchor::CenterRight,
                ThemeOverlayAnchor::TopRight,
                ThemeOverlayAnchor::BottomRight,
            ),
            (
                ThemeOverlayAnchor::BottomRight,
                ThemeOverlayAnchor::TopRight,
                ThemeOverlayAnchor::BottomRight,
            ),
        ];

        for (theme_anchor, expected_top, expected_bottom) in cases {
            let theme = OverlayWindowConfig {
                width: 384,
                height: 256,
                anchor: theme_anchor,
                pointer_mode: ThemePointerMode::Interactive,
            };
            assert_eq!(
                resolved_overlay_anchor(Some(theme), OverlayPosition::Top),
                expected_top
            );
            assert_eq!(
                resolved_overlay_anchor(Some(theme), OverlayPosition::Bottom),
                expected_bottom
            );
        }

        assert_eq!(
            resolved_overlay_anchor(None, OverlayPosition::Top),
            ThemeOverlayAnchor::TopCenter
        );
        assert_eq!(
            resolved_overlay_anchor(None, OverlayPosition::Bottom),
            ThemeOverlayAnchor::BottomCenter
        );
    }

    #[test]
    fn custom_anchor_controls_both_axes() {
        let origin = |anchor| {
            logical_overlay_origin(100.0, 50.0, 1000.0, 800.0, 850.0, 200.0, 100.0, anchor)
        };
        assert_eq!(origin(ThemeOverlayAnchor::TopLeft), (112.0, 54.0));
        assert_eq!(origin(ThemeOverlayAnchor::TopCenter), (500.0, 54.0));
        assert_eq!(origin(ThemeOverlayAnchor::TopRight), (888.0, 54.0));
        assert_eq!(origin(ThemeOverlayAnchor::CenterLeft), (112.0, 400.0));
        assert_eq!(origin(ThemeOverlayAnchor::Center), (500.0, 400.0));
        assert_eq!(origin(ThemeOverlayAnchor::CenterRight), (888.0, 400.0));
        assert_eq!(origin(ThemeOverlayAnchor::BottomLeft), (112.0, 710.0));
        assert_eq!(origin(ThemeOverlayAnchor::BottomCenter), (500.0, 710.0));
        assert_eq!(origin(ThemeOverlayAnchor::BottomRight), (888.0, 710.0));
    }

    #[test]
    fn monitor_hit_test_uses_half_open_physical_bounds() {
        let position = PhysicalPosition::new(-2560, -200);
        let size = PhysicalSize::new(2560, 1440);

        assert!(is_mouse_within_monitor((-2560, -200), &position, &size));
        assert!(is_mouse_within_monitor((-1, 1239), &position, &size));
        assert!(!is_mouse_within_monitor((0, 0), &position, &size));
        assert!(!is_mouse_within_monitor((-1, 1240), &position, &size));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_cursor_hit_test_does_not_scale_physical_monitor_bounds() {
        let position = PhysicalPosition::new(1920, 0);
        let size = PhysicalSize::new(3840, 2160);
        let cursor = (5000, 1000);

        assert!(is_mouse_within_monitor(cursor, &position, &size));

        // This is the old mixed-coordinate comparison. It excludes a cursor
        // that is visibly inside a secondary display running at 150%.
        let scale = 1.5;
        let logical_position = PhysicalPosition::new(
            (position.x as f64 / scale) as i32,
            (position.y as f64 / scale) as i32,
        );
        let logical_size = PhysicalSize::new(
            (size.width as f64 / scale) as u32,
            (size.height as f64 / scale) as u32,
        );
        assert!(!is_mouse_within_monitor(
            cursor,
            &logical_position,
            &logical_size
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_overlay_bounds_use_destination_monitor_scale() {
        let monitor_position = PhysicalPosition::new(1920, 0);
        let monitor_size = PhysicalSize::new(3840, 2160);

        assert_eq!(
            windows_overlay_bounds(
                monitor_position,
                monitor_size,
                1.5,
                OVERLAY_WIDTH,
                OVERLAY_HEIGHT,
                ThemeOverlayAnchor::BottomCenter,
            ),
            (3648, 2031, 384, 69)
        );
        assert_eq!(
            windows_overlay_bounds(
                monitor_position,
                monitor_size,
                1.5,
                OVERLAY_WIDTH,
                OVERLAY_HEIGHT,
                ThemeOverlayAnchor::TopCenter,
            ),
            (3648, 6, 384, 69)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_overlay_bounds_support_negative_monitor_origins() {
        assert_eq!(
            windows_overlay_bounds(
                PhysicalPosition::new(-2560, -200),
                PhysicalSize::new(2560, 1440),
                1.25,
                OVERLAY_STREAM_WIDTH,
                OVERLAY_STREAM_HEIGHT,
                ThemeOverlayAnchor::BottomCenter,
            ),
            (-1530, 1040, 500, 150)
        );
    }
}
