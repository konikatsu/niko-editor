#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod file_policy;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

static DIALOG_OPEN: AtomicBool = AtomicBool::new(false);
struct DialogGuard;
impl DialogGuard {
    fn acquire() -> Result<Self, String> {
        DIALOG_OPEN
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Self)
            .map_err(|_| "先に開いているファイル選択画面を閉じてください。".into())
    }
}
impl Drop for DialogGuard {
    fn drop(&mut self) {
        DIALOG_OPEN.store(false, Ordering::SeqCst);
    }
}
#[derive(Serialize)]
struct OpenedDocument {
    name: String,
    content: String,
}
#[derive(Deserialize)]
struct SaveRequest {
    name: String,
    format: String,
    content: String,
}
#[derive(Serialize)]
struct SavedDocument {
    name: String,
}

#[tauri::command]
async fn open_document(window: WebviewWindow) -> Result<Option<OpenedDocument>, String> {
    if window.label() != "main" {
        return Err("エディタから操作してください。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DialogGuard::acquire()?;
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("ドキュメントを開く")
            .add_filter(
                "対応するドキュメント",
                &["md", "markdown", "html", "htm", "txt"],
            )
            .blocking_pick_file();
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|error| error.to_string())?;
        let content = file_policy::read_document(&path)?;
        let name = path
            .file_name()
            .ok_or("ファイル名を読み取れませんでした。")?
            .to_string_lossy()
            .into_owned();
        Ok(Some(OpenedDocument { name, content }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_document(
    window: WebviewWindow,
    request: SaveRequest,
) -> Result<Option<SavedDocument>, String> {
    if window.label() != "main" {
        return Err("エディタから操作してください。".into());
    }
    let name = file_policy::save_name(&request.name, &request.format, &request.content)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DialogGuard::acquire()?;
        let extensions: &[&str] = match request.format.as_str() {
            "md" => &["md"],
            "html" => &["html"],
            _ => &["txt"],
        };
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("名前を付けて保存")
            .set_file_name(&name)
            .add_filter("ドキュメント", extensions)
            .blocking_save_file();
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let mut path = chosen.into_path().map_err(|error| error.to_string())?;
        if path.extension().is_none() {
            path.set_extension(&request.format);
        }
        std::fs::write(&path, request.content.as_bytes())
            .map_err(|error| format!("保存できませんでした：{error}"))?;
        let name = path
            .file_name()
            .ok_or("ファイル名を読み取れませんでした。")?
            .to_string_lossy()
            .into_owned();
        Ok(Some(SavedDocument { name }))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_document, save_document])
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("NIKO Editor")
            .inner_size(1280.0, 900.0)
            .min_inner_size(780.0, 620.0)
            .on_navigation(|url| {
                url.scheme() == "tauri"
                    || url.scheme() == "about" && url.path() == "srcdoc"
                    || url.host_str() == Some("tauri.localhost")
                    || cfg!(debug_assertions)
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(5173)
            })
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("NIKO Editor could not start");
}
