//! File sessions retain the user-selected destination on the trusted Rust side.
use crate::file_policy;
use fs2::FileExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Copy)]
enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
}
#[derive(Clone)]
struct Session {
    path: PathBuf,
    fingerprint: String,
    encoding: Encoding,
    crlf: bool,
}
pub struct Documents {
    pub auth: String,
    sessions: Mutex<HashMap<String, Session>>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub name: String,
    pub content: String,
    pub session_id: String,
    pub path: String,
    pub fingerprint: String,
    pub encoding: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub name: String,
    pub path: String,
    pub session_id: String,
    pub fingerprint: String,
    pub backup_path: Option<String>,
}

fn fingerprint(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn encoding(bytes: &[u8]) -> Encoding {
    if bytes.starts_with(&[0xff, 0xfe]) {
        Encoding::Utf16Le
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        Encoding::Utf16Be
    } else if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        Encoding::Utf8Bom
    } else {
        Encoding::Utf8
    }
}
fn encoding_label(value: Encoding) -> &'static str {
    match value {
        Encoding::Utf8 => "UTF-8",
        Encoding::Utf8Bom => "UTF-8 BOM",
        Encoding::Utf16Le => "UTF-16 LE",
        Encoding::Utf16Be => "UTF-16 BE",
    }
}
fn encode(text: &str, kind: Encoding, crlf: bool) -> Vec<u8> {
    let _ = crlf; // Newlines are patched in place; mixed newline documents stay untouched.
    let text = text.to_owned();
    match kind {
        Encoding::Utf8 => text.into_bytes(),
        Encoding::Utf8Bom => [vec![0xef, 0xbb, 0xbf], text.into_bytes()].concat(),
        Encoding::Utf16Le => [
            vec![0xff, 0xfe],
            text.encode_utf16().flat_map(u16::to_le_bytes).collect(),
        ]
        .concat(),
        Encoding::Utf16Be => [
            vec![0xfe, 0xff],
            text.encode_utf16().flat_map(u16::to_be_bytes).collect(),
        ]
        .concat(),
    }
}
fn read_bounded(file: &mut File) -> Result<Vec<u8>, String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(file_policy::MAX_OPEN_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > file_policy::MAX_OPEN_BYTES {
        return Err("5 MB以下のファイルを選んでください。".into());
    }
    Ok(bytes)
}
pub fn parse_path(input: &str) -> Result<PathBuf, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("ファイルのパスを入力してください。".into());
    }
    let path = if input.to_ascii_lowercase().starts_with("file:") {
        url::Url::parse(input)
            .map_err(|_| "file:// URLを読み取れませんでした。")?
            .to_file_path()
            .map_err(|_| "このfile:// URLをWindowsのパスに変換できませんでした。")?
    } else {
        PathBuf::from(input.trim_matches('"'))
    };
    if !path.is_absolute() {
        return Err("共有フォルダを含むファイルのフルパスを指定してください。".into());
    }
    if file_policy::file_format(&path).is_none() {
        return Err("HTML・Markdown・テキストのファイルを選んでください。".into());
    }
    Ok(path)
}

impl Documents {
    pub fn new() -> Self {
        Self {
            auth: Uuid::new_v4().to_string(),
            sessions: Mutex::new(HashMap::new()),
        }
    }
    pub fn authorize(&self, auth: &str) -> Result<(), String> {
        if auth != self.auth {
            return Err("エディタの操作画面から実行してください。".into());
        }
        Ok(())
    }
    pub fn open(&self, path: PathBuf) -> Result<Opened, String> {
        if file_policy::file_format(&path).is_none() {
            return Err("対応していないファイル形式です。".into());
        }
        let path = fs::canonicalize(&path).map_err(|e| format!("ファイルの場所を確認できませんでした：{e}"))?;
        let mut file = File::open(&path).map_err(|e| format!("ファイルを開けませんでした：{e}"))?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("ファイルを選んでください。".into());
        }
        let bytes = read_bounded(&mut file)?;
        let content = file_policy::decode_text(&bytes)?;
        let kind = encoding(&bytes);
        let hash = fingerprint(&bytes);
        let id = Uuid::new_v4().to_string();
        let record = Session {
            path: path.clone(),
            fingerprint: hash.clone(),
            encoding: kind,
            crlf: content.contains("\r\n"),
        };
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "ファイル状態を確認できません。")?;
        if sessions.len() >= 16 {
            sessions.clear();
        }
        sessions.insert(id.clone(), record);
        Ok(Opened {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            content,
            session_id: id,
            path: path.to_string_lossy().into_owned(),
            fingerprint: hash,
            encoding: encoding_label(kind).into(),
        })
    }
    pub fn save(&self, id: &str, expected: &str, content: &str) -> Result<Saved, String> {
        if content.len() > file_policy::MAX_SAVE_BYTES {
            return Err("保存できる本文は20 MBまでです。".into());
        }
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "ファイル状態を確認できません。")?;
        let session = sessions
            .get_mut(id)
            .ok_or("元ファイルを開き直すか、名前を付けて保存してください。")?;
        if expected != session.fingerprint {
            return Err("CONFLICT:保存時の版が一致しません。内容を別名で保存してください。".into());
        }
        let bytes = encode(content, session.encoding, session.crlf);
        if bytes.len() as u64 > file_policy::MAX_OPEN_BYTES {
            return Err("保存後も開き直せるよう、ファイルは5 MBまでにしてください。".into());
        }
        let backup = replace_file(&session.path, &bytes, Some(&session.fingerprint))?;
        session.fingerprint = fingerprint(&bytes);
        Ok(Saved {
            name: session
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: session.path.to_string_lossy().into_owned(),
            session_id: id.into(),
            fingerprint: session.fingerprint.clone(),
            backup_path: backup.map(|p| p.to_string_lossy().into_owned()),
        })
    }
    pub fn save_as(&self, path: PathBuf, content: &str, source_id: Option<&str>) -> Result<Saved, String> {
        if content.len() > file_policy::MAX_SAVE_BYTES {
            return Err("保存できる本文は20 MBまでです。".into());
        }
        let path = if path.exists() { fs::canonicalize(path).map_err(|e| e.to_string())? } else { fs::canonicalize(path.parent().ok_or("保存先のフォルダを確認してください。")?).map_err(|e| e.to_string())?.join(path.file_name().ok_or("ファイル名を確認してください。")?) };
        let source_session = self
            .sessions
            .lock()
            .map_err(|_| "ファイル状態を確認できません。")?
            .get(source_id.unwrap_or(""))
            .cloned();
        if let Some(source) = &source_session {
            if source.path == path { return self.save(source_id.unwrap(), &source.fingerprint, content); }
        }
        let source_encoding = source_session.map(|s|s.encoding).unwrap_or(Encoding::Utf8);
        let bytes = encode(content, source_encoding, false);
        if bytes.len() as u64 > file_policy::MAX_OPEN_BYTES {
            return Err("保存できるファイルは5 MBまでです。".into());
        }
        let backup = replace_file(&path, &bytes, None)?;
        let opened = self.open(path)?;
        Ok(Saved {
            name: opened.name,
            path: opened.path,
            session_id: opened.session_id,
            fingerprint: opened.fingerprint,
            backup_path: backup.map(|p| p.to_string_lossy().into_owned()),
        })
    }
}

fn replace_file(
    path: &Path,
    bytes: &[u8],
    expected: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let mut existing = if path.exists() {
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| format!("共有先または書き込み権限を確認してください：{e}"))?;
        FileExt::try_lock_exclusive(&file)
            .map_err(|_| "他の処理がファイルを使用しています。少し待ってから保存してください。")?;
        let old = read_bounded(&mut file)?;
        if expected.is_some_and(|hash| hash != fingerprint(&old)) {
            return Err("CONFLICT:他のアプリまたは利用者が元ファイルを変更しました。本文を別名で保存して確認してください。".into());
        }
        if old == bytes {
            return Ok(None);
        }
        Some((file, old))
    } else {
        if expected.is_some() {
            return Err(
                "CONFLICT:元ファイルが移動または削除されています。名前を付けて保存してください。"
                    .into(),
            );
        }
        None
    };
    let parent = path
        .parent()
        .ok_or("保存先のフォルダを確認してください。")?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let unique = Uuid::new_v4().to_string();
    let backup = if let Some((_, old)) = &existing {
        let backup_root = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("NIKO Editor")
            .join("backups")
            .join(fingerprint(path.to_string_lossy().as_bytes()));
        fs::create_dir_all(&backup_root)
            .map_err(|e| format!("バックアップ先を作成できません：{e}"))?;
        let backup_path = backup_root.join(format!("{unique}.bak"));
        let mut backup_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup_path)
            .map_err(|e| format!("バックアップを作成できないため保存を中止しました：{e}"))?;
        backup_file
            .write_all(old)
            .and_then(|_| backup_file.sync_all())
            .map_err(|e| format!("バックアップを書き込めないため保存を中止しました：{e}"))?;
        Some(backup_path)
    } else {
        None
    };
    let temp = parent.join(format!(".{name}.niko-{unique}.tmp"));
    let outcome: Result<(), String> = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        // Recheck immediately before replacement as well as holding the file lock.
        if let Some((locked, old)) = &mut existing {
            let current = read_bounded(locked)?;
            if fingerprint(&current) != fingerprint(old) {
                return Err(
                    "CONFLICT:保存直前に元ファイルが変更されました。別名で保存してください。"
                        .into(),
                );
            }
            let at_path = fs::metadata(path).map_err(|e| e.to_string())?;
            let held = locked.metadata().map_err(|e| e.to_string())?;
            if at_path.len() != held.len() || at_path.modified().ok() != held.modified().ok() {
                return Err("CONFLICT:保存直前に元ファイルが置き換えられました。".into());
            }
            // ReplaceFile opens another handle internally. Keeping a byte-range
            // lock here can block its stream/metadata merge on Windows/SMB.
            FileExt::unlock(locked).map_err(|e| e.to_string())?;
            let mut current_path = File::open(path).map_err(|e| e.to_string())?;
            if fingerprint(&read_bounded(&mut current_path)?) != fingerprint(old) {
                return Err("CONFLICT:元ファイルが保存直前に変更されました。".into());
            }
        } else if path.exists() {
            return Err(
                "CONFLICT:同名のファイルが新しく作成されました。保存先を選び直してください。"
                    .into(),
            );
        }
        let was_existing = existing.is_some();
        drop(existing.take());
        replace_existing(&temp, path, was_existing).map_err(|e| {
            format!("元ファイルを置き換えられませんでした。編集内容は残っています：{e}")
        })?;
        Ok(())
    })();
    if let Err(error) = outcome {
        return Err(format!("{error}\n復旧用の編集ファイル: {}\nバックアップ: {}",temp.display(),backup.as_ref().map(|p|p.display().to_string()).unwrap_or_default()));
    }
    drop(existing);
    if fs::read(path).map_err(|e| e.to_string())? != bytes {
        return Err("保存後の内容を確認できませんでした。本文を別名で保存してください。".into());
    }
    Ok(backup)
}

#[cfg(windows)]
fn replace_existing(temp: &Path, path: &Path, exists: bool) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileW(existing: *const u16, new: *const u16) -> i32;
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }
    let destination = if exists {fs::canonicalize(path)?} else {fs::canonicalize(path.parent().ok_or_else(|| std::io::Error::other("Missing parent"))?)?.join(path.file_name().ok_or_else(|| std::io::Error::other("Missing filename"))?)};
    let replaced: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement: Vec<u16> = fs::canonicalize(temp)?.as_os_str().encode_wide().chain(Some(0)).collect();
    let rollback_path = destination.parent().unwrap().join(format!(".niko-rollback-{}.tmp",Uuid::new_v4()));
    let rollback: Vec<u16> = rollback_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = if !exists { unsafe { MoveFileW(replacement.as_ptr(),replaced.as_ptr()) } } else { unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            rollback.as_ptr(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } };
    if ok == 0 {
        let error=std::io::Error::last_os_error();
        if !path.exists() && rollback_path.exists() {
            // No replace flag: never overwrite a concurrently created file.
            unsafe { MoveFileW(rollback.as_ptr(),replaced.as_ptr()); }
        }
        Err(std::io::Error::other(format!("{error}; 復旧用の元ファイル: {}",rollback_path.display())))
    } else {
        if rollback_path.exists() { let _=fs::remove_file(&rollback_path); }
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace_existing(temp: &Path, path: &Path, _exists: bool) -> std::io::Result<()> {
    fs::rename(temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn folder() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("niko-files-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        dir
    }
    #[test]
    fn overwrite_has_backup_and_rejects_external_changes() {
        let dir = folder();
        let path = dir.join("note.html");
        fs::write(&path, b"old").unwrap();
        let documents = Documents::new();
        let opened = documents.open(path.clone()).unwrap();
        let saved = documents
            .save(&opened.session_id, &opened.fingerprint, "new")
            .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(
            fs::read_to_string(saved.backup_path.unwrap()).unwrap(),
            "old"
        );
        fs::write(&path, b"external").unwrap();
        assert!(documents
            .save(&opened.session_id, &saved.fingerprint, "must not overwrite")
            .unwrap_err()
            .starts_with("CONFLICT:"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    }
    #[test]
    fn unchanged_utf16_and_bom_bytes_are_preserved() {
        let dir = folder();
        let path = dir.join("unicode.txt");
        let bytes = encode("日本語\r\n🌱", Encoding::Utf16Le, true);
        fs::write(&path, &bytes).unwrap();
        let documents = Documents::new();
        let opened = documents.open(path.clone()).unwrap();
        let saved = documents
            .save(&opened.session_id, &opened.fingerprint, &opened.content)
            .unwrap();
        assert!(saved.backup_path.is_none());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    #[test]
    fn unauthorized_and_expired_sessions_do_not_write() {
        let documents = Documents::new();
        assert!(documents.authorize("wrong").is_err());
        assert!(documents.save("unknown", "", "x").is_err());
        assert!(parse_path("https://example.com/file.html").is_err());
    }
    #[test]
    fn all_encodings_and_mixed_newlines_survive_save_as_and_noop() {
        for kind in [Encoding::Utf8, Encoding::Utf8Bom, Encoding::Utf16Le, Encoding::Utf16Be] {
            let dir=folder();let original=dir.join("original.html");let copy=dir.join("copy.html");
            let bytes=encode("<p>日本語🌱</p>\r\nline\nlast\r",kind,false);
            fs::write(&original,&bytes).unwrap();let documents=Documents::new();let opened=documents.open(original.clone()).unwrap();
            let saved=documents.save(&opened.session_id,&opened.fingerprint,&opened.content).unwrap();assert!(saved.backup_path.is_none());assert_eq!(fs::read(&original).unwrap(),bytes);
            documents.save_as(copy.clone(),&opened.content,Some(&opened.session_id)).unwrap();assert_eq!(fs::read(copy).unwrap(),bytes);
        }
    }
    #[cfg(windows)]
    #[test]
    fn replacement_denied_by_another_handle_keeps_both_files() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir=folder();let path=dir.join("original.html");let temp=dir.join("edit.tmp");fs::write(&path,b"old").unwrap();fs::write(&temp,b"new").unwrap();
        let _held=OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
        assert!(replace_existing(&temp,&path,true).is_err());assert_eq!(fs::read(&path).unwrap(),b"old");assert_eq!(fs::read(&temp).unwrap(),b"new");
    }
    #[cfg(windows)]
    #[test]
    fn file_urls_and_unc_paths_resolve_percent_encoded_japanese() {
        assert_eq!(parse_path("file://server/Share/%E6%97%A5%E6%9C%AC%E8%AA%9E/index.html").unwrap(),PathBuf::from("\\\\server\\Share\\日本語\\index.html"));
        assert_eq!(parse_path("file:///C:/docs/note.html").unwrap(),PathBuf::from("C:\\docs\\note.html"));
        assert!(parse_path("note.html").is_err());
    }
}
