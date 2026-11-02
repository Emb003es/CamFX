#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    ffi::OsStr,
    fs::{self, File},
    io::Write,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, LogicalSize, Manager, State, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

/// The layer lives on the monitor the panel is on.
fn fit_to_panel(overlay: &WebviewWindow) -> tauri::Result<()> {
    let Some(panel) = overlay.get_webview_window("panel") else { return Ok(()) };
    if let Some(m) = panel.current_monitor()?.or(overlay.primary_monitor()?) {
        overlay.set_position(*m.position())?;
        overlay.set_size(*m.size())?;
    }
    Ok(())
}

/// A click-through layer covering a whole monitor.
fn make_layer(w: &WebviewWindow) -> tauri::Result<()> {
    fit_to_panel(w)?;
    w.set_ignore_cursor_events(true)?;
    // Back above the layer, or the floating windows would cover the panel.
    if let Some(panel) = w.get_webview_window("panel") {
        panel.set_always_on_top(false)?;
        panel.set_always_on_top(true)?;
    }
    Ok(())
}

fn follow_panel(app: &AppHandle) -> tauri::Result<()> {
    let (Some(overlay), Some(panel)) = (app.get_webview_window("overlay"), app.get_webview_window("panel")) else {
        return Ok(());
    };
    // A minimized window "moves" off every monitor: the layer stays where it is.
    if panel.is_minimized()? {
        return Ok(());
    }
    if let Some(m) = panel.current_monitor()? {
        if overlay.outer_position()? != *m.position() {
            fit_to_panel(&overlay)?;
        }
    }
    Ok(())
}

fn desktop_mode(app: &AppHandle, on: bool) -> tauri::Result<()> {
    let panel = app.get_webview_window("panel").expect("sin panel");
    panel.set_always_on_top(on)?;
    // Over the desktop the panel shrinks to its controls, so it hides as little as possible.
    panel.set_size(if on { LogicalSize::new(340.0, 740.0) } else { LogicalSize::new(1180.0, 740.0) })?;
    match (on, app.get_webview_window("overlay")) {
        (true, None) => {
            let config = app.config().app.windows.iter().find(|w| w.label == "overlay").expect("sin overlay");
            make_layer(&WebviewWindowBuilder::from_config(app, config)?.build()?)?;
        }
        (false, Some(overlay)) => overlay.destroy()?,
        _ => {}
    }
    Ok(())
}

// async: on Windows, creating a webview from a sync command deadlocks.
#[tauri::command(async)]
fn set_desktop(app: AppHandle, on: bool) -> Result<(), String> {
    desktop_mode(&app, on).map_err(|e| e.to_string())
}

/// While recording the screen, so the panel does not show up in the video.
#[tauri::command]
fn protect_panel(app: AppHandle, on: bool) -> Result<(), String> {
    let panel = app.get_webview_window("panel").ok_or("sin panel")?;
    panel.set_content_protected(on).map_err(|e| e.to_string())
}

/// The file being recorded, and the path of the last one.
#[derive(Default)]
struct Recording(Mutex<(Option<File>, PathBuf)>);

#[tauri::command]
fn start_recording(app: AppHandle, state: State<Recording>, name: String) -> Result<String, String> {
    // The name comes from the page: it must stay a bare file name inside the folder.
    if Path::new(&name).file_name() != Some(OsStr::new(&name)) {
        return Err("nombre de archivo no válido".into());
    }
    let dir = app.path().video_dir().map_err(|e| e.to_string())?.join("CamFX");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    let file = File::create_new(&path).map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = (Some(file), path.clone());
    Ok(path.display().to_string())
}

#[tauri::command]
fn append_recording(state: State<Recording>, request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("sin datos".into()) };
    let mut rec = state.0.lock().unwrap();
    let file = rec.0.as_mut().ok_or("no se está grabando")?;
    file.write_all(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn finish_recording(state: State<Recording>) {
    state.0.lock().unwrap().0 = None;
}

#[tauri::command]
fn reveal_recording(state: State<Recording>) -> Result<(), String> {
    let path = state.0.lock().unwrap().1.clone();
    Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.display())).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Recording::default())
        .invoke_handler(tauri::generate_handler![
            set_desktop,
            protect_panel,
            start_recording,
            append_recording,
            finish_recording,
            reveal_recording
        ])
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
