use std::fs::File;
use std::io::Read;
use std::path::Path;

pub const MAX_OPEN_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_SAVE_BYTES: usize = 20 * 1024 * 1024;

pub fn file_format(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "md" | "markdown" => Some("md"),
        "html" | "htm" => Some("html"),
        "txt" => Some("txt"),
        _ => None,
    }
}

pub fn read_document(path: &Path) -> Result<String, String> {
    if file_format(path).is_none() {
        return Err("Markdown・HTML・テキストのファイルを選んでください。".into());
    }
    let file = File::open(path).map_err(|error| format!("ファイルを開けませんでした：{error}"))?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_OPEN_BYTES {
        return Err("5 MB以下のファイルを選んでください。".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_OPEN_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_OPEN_BYTES {
        return Err("5 MB以下のファイルを選んでください。".into());
    }
    decode_text(&bytes)
}

pub fn decode_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if bytes.len() % 2 != 0 {
            return Err("UTF-16ファイルが壊れているようです。".into());
        }
        let little = bytes[0] == 0xff;
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| {
                if little {
                    u16::from_le_bytes([chunk[0], chunk[1]])
                } else {
                    u16::from_be_bytes([chunk[0], chunk[1]])
                }
            })
            .collect();
        return String::from_utf16(&units)
            .map_err(|_| "UTF-16ファイルが壊れているようです。".into());
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        "文字コードを読み取れませんでした。UTF-8で保存したファイルを選んでください。".into()
    })
}

pub fn save_name(name: &str, format: &str, content: &str) -> Result<String, String> {
    if !["md", "html", "txt"].contains(&format) || content.len() > MAX_SAVE_BYTES {
        return Err("保存形式またはファイルサイズが正しくありません（20 MBまで）。".into());
    }
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let mut clean: String = base
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"|?*".contains(*c))
        .take(150)
        .collect();
    if let Some(index) = clean.rfind('.') {
        if ["md", "markdown", "html", "htm", "txt"]
            .contains(&clean[index + 1..].to_ascii_lowercase().as_str())
        {
            clean.truncate(index);
        }
    }
    clean = clean.trim().trim_end_matches('.').trim().to_string();
    if clean.is_empty() {
        clean = "無題のノート".into();
    }
    let stem = clean.split('.').next().unwrap_or("").to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&stem.as_str())
    {
        clean.insert(0, '_');
    }
    Ok(format!("{clean}.{format}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formats_and_save_names_are_bounded() {
        assert_eq!(file_format(Path::new("ノート.TXT")), Some("txt"));
        assert_eq!(file_format(Path::new("unknown.exe")), None);
        assert_eq!(
            save_name("../../ノート.md", "txt", "本文").unwrap(),
            "ノート.txt"
        );
        assert_eq!(save_name("CON.txt", "html", "").unwrap(), "_CON.html");
        assert!(save_name("note", "exe", "").is_err());
        assert!(save_name("note", "txt", &"x".repeat(MAX_SAVE_BYTES + 1)).is_err());
    }
    #[test]
    fn utf8_and_windows_unicode_text_are_decoded_without_loss() {
        assert_eq!(decode_text("日本語🌱".as_bytes()).unwrap(), "日本語🌱");
        assert_eq!(decode_text(b"\xef\xbb\xbfnote").unwrap(), "note");
        let text = "日本語🌱\r\nline";
        let mut le = vec![0xff, 0xfe];
        let mut be = vec![0xfe, 0xff];
        for unit in text.encode_utf16() {
            le.extend_from_slice(&unit.to_le_bytes());
            be.extend_from_slice(&unit.to_be_bytes());
        }
        assert_eq!(decode_text(&le).unwrap(), text);
        assert_eq!(decode_text(&be).unwrap(), text);
        assert!(decode_text(&[0xff, 0xfe, 0x00]).is_err());
        assert!(decode_text(&[0x80]).is_err());
    }
    #[test]
    fn missing_files_return_a_readable_error() {
        assert!(read_document(Path::new("missing-test-file.txt"))
            .unwrap_err()
            .contains("ファイルを開けません"));
    }
}
