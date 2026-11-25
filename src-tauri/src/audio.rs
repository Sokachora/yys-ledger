//! 按进程设置 Windows 音频会话的音量与静音。
//!
//! 走 Core Audio：默认播放设备 → IAudioSessionManager2 → 会话 PID → ISimpleAudioVolume。
//! 游戏可能把音频放在子进程里，调用方传入进程树 PID 集合。

use std::collections::HashSet;

use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// 把给定 PID 集合的所有音频会话设为指定音量与静音状态。
/// 返回实际改动的会话数；没有匹配会话时返回 0。
pub fn set_volume(pids: &HashSet<u32>, volume: f32, muted: bool) -> Result<usize, String> {
    if pids.is_empty() {
        return Ok(0);
    }

    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        let initialized = hr.is_ok();
        let result = (|| -> Result<usize, String> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| format!("音频设备枚举失败：{error}"))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|error| format!("获取默认播放设备失败：{error}"))?;
            let manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| format!("音频会话管理器不可用：{error}"))?;
            let sessions = manager
                .GetSessionEnumerator()
                .map_err(|error| format!("枚举音频会话失败：{error}"))?;
            let count = sessions.GetCount().map_err(|error| error.to_string())?;
            let level = volume.clamp(0.0, 1.0);
            let mut changed = 0;

            for index in 0..count {
                let Ok(control) = sessions.GetSession(index) else {
                    continue;
                };
                let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let Ok(pid) = control2.GetProcessId() else {
                    continue;
                };
                if !pids.contains(&pid) {
                    continue;
                }
                let Ok(simple) = control.cast::<ISimpleAudioVolume>() else {
                    continue;
                };
                if simple.SetMasterVolume(level, std::ptr::null()).is_ok()
                    && simple.SetMute(muted, std::ptr::null()).is_ok()
                {
                    changed += 1;
                }
            }
            Ok(changed)
        })();

        if initialized {
            CoUninitialize();
        }
        result
    }
}
