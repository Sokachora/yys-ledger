//! 极简本地日志：%APPDATA%\yys-ledger\logs\app.log，超过 2MB 轮转到 app.1.log。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config;

pub fn dir() -> PathBuf {
    config::data_dir().join("logs")
}

pub fn write(level: &str, message: &str) {
    let dir = dir();
    let _ = fs::create_dir_all(&dir);
    let file = dir.join("app.log");
    if fs::metadata(&file).map(|meta| meta.len() > 2 * 1024 * 1024).unwrap_or(false) {
        let _ = fs::rename(&file, dir.join("app.1.log"));
    }
    let stamp = timestamp();
    if let Ok(mut handle) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = writeln!(handle, "{stamp} [{level}] {message}");
    }
}

pub fn info(message: &str) {
    write("INFO", message);
}

pub fn warn(message: &str) {
    write("WARN", message);
}

pub fn error(message: &str) {
    write("ERROR", message);
}

fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

/// Howard Hinnant 的 civil_from_days，避免为时间戳引入日期库。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}
