//! Keep native Acrylic drawn after the window loses focus.
//!
//! Tauri's `Effect::Acrylic` on Windows 11 sets `DWMWA_SYSTEMBACKDROP_TYPE` to
//! `DWMSBT_TRANSIENTWINDOW`. DWM stops painting that backdrop on inactive
//! windows, so the glass disappears on blur. `SetWindowCompositionAttribute`
//! acrylic stays drawn while unfocused.

#![cfg(windows)]

use std::ffi::c_void;
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{BOOL, HWND},
    Graphics::Dwm::{DwmExtendFrameIntoClientArea, DwmSetWindowAttribute},
    System::LibraryLoader::{GetProcAddress, LoadLibraryA},
    UI::Controls::MARGINS,
};

const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
const DWMSBT_NONE: u32 = 1;
const WCA_ACCENT_POLICY: u32 = 19;
const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;

#[repr(C)]
struct AccentPolicy {
    accent_state: u32,
    accent_flags: u32,
    gradient_color: u32,
    animation_id: u32,
}

#[repr(C)]
struct WindowCompositionAttribData {
    attrib: u32,
    pv_data: *mut c_void,
    cb_data: usize,
}

/// Re-arm Acrylic so an inactive window still samples the desktop.
pub fn apply(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    // SAFETY: `hwnd` is the native handle of a live Tauri window.
    unsafe { apply_hwnd(hwnd.0 as HWND) };
}

unsafe fn apply_hwnd(hwnd: HWND) {
    if hwnd.is_null() {
        return;
    }

    let margins = MARGINS {
        cxLeftWidth: -1,
        cxRightWidth: -1,
        cyTopHeight: -1,
        cyBottomHeight: -1,
    };
    let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);

    let backdrop = DWMSBT_NONE;
    let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_SYSTEMBACKDROP_TYPE,
        &backdrop as *const u32 as *const c_void,
        4,
    );

    type SetWindowCompositionAttribute =
        unsafe extern "system" fn(HWND, *mut WindowCompositionAttribData) -> BOOL;
    let module = LoadLibraryA(b"user32.dll\0".as_ptr());
    if module.is_null() {
        return;
    }
    let Some(symbol) = GetProcAddress(module, b"SetWindowCompositionAttribute\0".as_ptr()) else {
        return;
    };
    // SAFETY: user32 exported this exact symbol.
    let set_composition: SetWindowCompositionAttribute = std::mem::transmute(symbol);

    // Acrylic rejects a fully transparent gradient; keep a 1/255 tint.
    let mut policy = AccentPolicy {
        accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
        accent_flags: 0,
        gradient_color: 1 << 24,
        animation_id: 0,
    };
    let mut data = WindowCompositionAttribData {
        attrib: WCA_ACCENT_POLICY,
        pv_data: &mut policy as *mut AccentPolicy as *mut c_void,
        cb_data: std::mem::size_of::<AccentPolicy>(),
    };
    let _ = set_composition(hwnd, &mut data);
}
