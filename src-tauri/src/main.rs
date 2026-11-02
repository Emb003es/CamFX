#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, LogicalSize, Manager, WebviewWindow, WindowEvent};

/// The layer lives on the monitor the panel is on.
fn fit_to_panel(overlay: &WebviewWindow) -> tauri::Result<()> {
    let Some(panel) = overlay.get_webview_window("panel") else { return Ok(()) };
    if let Some(m) = panel.current_monitor()?.or(overlay.primary_monitor()?) {
        overlay.set_position(*m.position())?;
        overlay.set_size(*m.size())?;
    }
    Ok(())
}

/// Normal mode: a click-through layer covering a whole monitor.
fn make_layer(w: &WebviewWindow) -> tauri::Result<()> {
    w.set_decorations(false)?;
    w.set_resizable(false)?;
    w.set_skip_taskbar(true)?;
    w.set_always_on_top(true)?;
    fit_to_panel(w)?;
    w.set_ignore_cursor_events(true)?;
    // Back above the layer, or the floating windows would cover the panel.
    if let Some(panel) = w.get_webview_window("panel") {
        panel.set_always_on_top(false)?;
        panel.set_always_on_top(true)?;
    }
    Ok(())
}

/// Windowed mode: an ordinary window, e.g. to capture it in OBS.
fn make_window(w: &WebviewWindow) -> tauri::Result<()> {
    w.set_ignore_cursor_events(false)?;
    w.set_always_on_top(false)?;
    w.set_skip_taskbar(false)?;
    w.set_resizable(true)?;
    w.set_decorations(true)?;
    w.set_size(LogicalSize::new(1280.0, 720.0))?;
    w.center()
}

fn follow_panel(app: &AppHandle) -> tauri::Result<()> {
    let (Some(overlay), Some(panel)) = (app.get_webview_window("overlay"), app.get_webview_window("panel")) else {
        return Ok(());
    };
    if overlay.is_decorated()? {
        return Ok(()); // windowed mode: the user places it
    }
    if let Some(m) = panel.current_monitor()? {
        if overlay.outer_position()? != *m.position() {
            fit_to_panel(&overlay)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn set_windowed(app: AppHandle, on: bool) -> Result<(), String> {
    let w = app.get_webview_window("overlay").ok_or("sin overlay")?;
    if on { make_window(&w) } else { make_layer(&w) }.map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_windowed])
        .setup(|app| {
            make_layer(&app.get_webview_window("overlay").unwrap())?;
            Ok(())
        })
        .on_window_event(|win, ev| match ev {
            WindowEvent::CloseRequested { .. } => win.app_handle().exit(0),
            WindowEvent::Moved(_) if win.label() == "panel" => {
                let _ = follow_panel(win.app_handle());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar CamFX");
}
