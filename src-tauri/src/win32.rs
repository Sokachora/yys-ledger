use serde::Serialize;
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetSystemMetrics, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
    IsHungAppWindow, IsWindowVisible, SetForegroundWindow, SetWindowPos, ShowWindow,
    SystemParametersInfoW, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SPI_GETWORKAREA, SWP_NOZORDER, SWP_SHOWWINDOW,
    SW_RESTORE,
};

#[derive(Clone, Copy, Debug, Serialize)]
pub struct WinRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

pub fn find_window(pid: u32) -> Option<HWND> {
    struct Search {
        pid: u32,
        found: HWND,
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = unsafe { &mut *(lparam as *mut Search) };
        let mut window_pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut window_pid);
        }
        if window_pid == search.pid && unsafe { IsWindowVisible(hwnd) } != 0 {
            let mut buffer = [0u16; 256];
            let len = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
            let title = String::from_utf16_lossy(&buffer[..len.max(0) as usize]);
            if title.contains("阴阳师") {
                search.found = hwnd;
                return 0;
            }
        }
        1
    }

    let mut search = Search {
        pid,
        found: std::ptr::null_mut(),
    };
    unsafe {
        EnumWindows(Some(callback), &mut search as *mut Search as isize);
    }
    if !search.found.is_null() {
        Some(search.found)
    } else {
        None
    }
}

pub fn window_rect(hwnd: HWND) -> Option<WinRect> {
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetWindowRect(hwnd, &mut rect) };
    if ok != 0 {
        Some(WinRect {
            x: rect.left,
            y: rect.top,
            w: rect.right - rect.left,
            h: rect.bottom - rect.top,
        })
    } else {
        None
    }
}

pub fn is_hung(hwnd: HWND) -> bool {
    unsafe { IsHungAppWindow(hwnd) != 0 }
}

pub fn focus(hwnd: HWND) {
    unsafe {
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
    }
}

/// 找到标题包含指定文字的可见窗口（单实例保护时唤起已有窗口用）。
pub fn find_window_by_title(needle: &str) -> Option<HWND> {
    struct Search<'a> {
        needle: &'a str,
        found: HWND,
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = unsafe { &mut *(lparam as *mut Search) };
        let mut buffer = [0u16; 256];
        let len = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        if len <= 0 {
            return 1;
        }
        let title = String::from_utf16_lossy(&buffer[..len as usize]);
        if title.contains(search.needle) {
            search.found = hwnd;
            return 0;
        }
        1
    }

    let mut search = Search {
        needle,
        found: std::ptr::null_mut(),
    };
    unsafe {
        EnumWindows(Some(callback), &mut search as *mut Search as isize);
    }
    (!search.found.is_null()).then_some(search.found)
}

/// 窗口所在显示器的工作区；取不到时退回主屏。
pub fn monitor_work_area(hwnd: HWND) -> WinRect {
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if !monitor.is_null() {
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(monitor, &mut info) != 0 {
                return WinRect {
                    x: info.rcWork.left,
                    y: info.rcWork.top,
                    w: info.rcWork.right - info.rcWork.left,
                    h: info.rcWork.bottom - info.rcWork.top,
                };
            }
        }
    }
    work_area()
}

/// 把保存的窗口位置夹到虚拟桌面范围内，避免显示器拔掉后窗口跑出屏幕。
pub fn clamp_to_screens(x: i32, y: i32, w: u32, h: u32) -> (i32, i32) {
    unsafe {
        let left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let right = left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let bottom = top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
        let margin = 80i32;
        let max_x = right - margin;
        let max_y = bottom - margin;
        let clamped_x = x.clamp(left - w as i32 + margin, max_x);
        let clamped_y = y.clamp(top, max_y);
        let _ = h;
        (clamped_x, clamped_y)
    }
}

pub fn work_area() -> WinRect {
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            &mut rect as *mut RECT as *mut std::ffi::c_void,
            0,
        )
    };
    if ok != 0 {
        WinRect {
            x: rect.left,
            y: rect.top,
            w: rect.right - rect.left,
            h: rect.bottom - rect.top,
        }
    } else {
        WinRect {
            x: 0,
            y: 0,
            w: unsafe { GetSystemMetrics(SM_CXSCREEN) },
            h: unsafe { GetSystemMetrics(SM_CYSCREEN) },
        }
    }
}

/// 把窗口按网格平铺到显示器工作区：优先用第一个窗口所在那块屏。
pub fn tile(hwnds: &[HWND]) {
    if hwnds.is_empty() {
        return;
    }
    let area = monitor_work_area(hwnds[0]);
    let count = hwnds.len() as i32;
    let cols = (count as f64).sqrt().ceil() as i32;
    let rows = (count as f64 / cols as f64).ceil() as i32;

    // 游戏窗口强制 16:9，宽高比不对时会被游戏自己拉回去，导致窗口重叠。
    const ASPECT: f64 = 16.0 / 9.0;
    let mut cell_w = area.w / cols.max(1);
    let mut cell_h = area.h / rows.max(1);
    if (cell_w as f64) / (cell_h as f64) > ASPECT {
        cell_w = (cell_h as f64 * ASPECT) as i32;
    } else {
        cell_h = (cell_w as f64 / ASPECT) as i32;
    }

    let offset_x = area.x + (area.w - cols * cell_w) / 2;
    let offset_y = area.y + (area.h - rows * cell_h) / 2;

    for (index, hwnd) in hwnds.iter().enumerate() {
        let col = index as i32 % cols;
        let row = index as i32 / cols;
        unsafe {
            SetWindowPos(
                *hwnd,
                std::ptr::null_mut(),
                offset_x + col * cell_w,
                offset_y + row * cell_h,
                cell_w,
                cell_h,
                SWP_NOZORDER | SWP_SHOWWINDOW,
            );
        }
    }
}
