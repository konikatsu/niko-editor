use crate::{document_files::Documents, file_policy};
use serde::Deserialize;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn open_work_document(window: WebviewWindow, auth: String, input_path: Option<String>) -> Result<Option<crate::document_files::Opened>, String> {
    window.state::<Documents>().authorize(&auth)?;
    if window.label() != "main" { return Err("エディタの操作画面から実行してください。".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = crate::DialogGuard::acquire()?;
        let path = if let Some(input) = input_path {
            crate::document_files::parse_path(&input)?
        } else {
            let chosen = window.dialog().file().set_parent(&window).set_title("HTMLファイルを開く").add_filter("HTML", &["html","htm"]).blocking_pick_file();
            let Some(chosen) = chosen else { return Ok(None); };
            chosen.into_path().map_err(|e| e.to_string())?
        };
        if file_policy::file_format(&path) != Some("html") { return Err("HTMLファイルを選んでください。".into()); }
        window.state::<Documents>().open(path).map(Some)
    }).await.map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorkRequest { name: String, content: String, session_id: Option<String>, fingerprint: Option<String>, #[serde(default)] save_as: bool }

#[tauri::command]
pub async fn save_work_document(window: WebviewWindow, auth: String, request: SaveWorkRequest) -> Result<Option<crate::document_files::Saved>, String> {
    window.state::<Documents>().authorize(&auth)?;
    if window.label() != "main" { return Err("エディタの操作画面から実行してください。".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = crate::DialogGuard::acquire()?;
        if !request.save_as {
            if let (Some(id),Some(fingerprint)) = (&request.session_id,&request.fingerprint) {
                return window.state::<Documents>().save(id,fingerprint,&request.content).map(Some);
            }
        }
        let name = file_policy::save_name(&request.name,"html",&request.content)?;
        let chosen = window.dialog().file().set_parent(&window).set_title("名前を付けて保存").set_file_name(&name).add_filter("HTML",&["html","htm"]).blocking_save_file();
        let Some(chosen) = chosen else { return Ok(None); };
        let mut path = chosen.into_path().map_err(|e| e.to_string())?;
        if path.extension().is_none() { path.set_extension("html"); }
        if file_policy::file_format(&path) != Some("html") { return Err(".html または .htm のファイル名で保存してください。".into()); }
        window.state::<Documents>().save_as(path,&request.content).map(Some)
    }).await.map_err(|e| e.to_string())?
}
