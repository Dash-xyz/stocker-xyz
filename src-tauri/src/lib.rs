use encoding_rs::GBK;
use pinyin::ToPinyin;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    image::Image, AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, Window,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

const DEFAULT_GLOBAL_SHORTCUT: &str = "Ctrl+Space";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Quote {
    symbol: String,
    name: String,
    pinyin: String,
    price: f64,
    previous_close: Option<f64>,
    open: Option<f64>,
    high: Option<f64>,
    low: Option<f64>,
    amount: Option<f64>,
    change: f64,
    percent: f64,
    updated_at: Option<String>,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuoteResponse {
    quotes: Vec<Quote>,
    fetched_at: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetSearchResult {
    symbol: String,
    code: String,
    name: String,
    market: String,
    asset_type: String,
}

#[derive(Deserialize, Serialize)]
struct SavedWindowGeometry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

struct TrayBehavior {
    minimize_to_tray: AtomicBool,
    alert_active: AtomicBool,
    alert_acknowledged: AtomicBool,
    alert_phase: AtomicBool,
    suppress_focus_minimize_until: Mutex<Option<Instant>>,
    last_window_motion: Mutex<Instant>,
}

#[derive(Default)]
struct WatchAlertDedup {
    active: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
struct GlobalShortcutConfig {
    current: Mutex<Option<String>>,
}

impl Default for TrayBehavior {
    fn default() -> Self {
        Self {
            minimize_to_tray: AtomicBool::new(true),
            alert_active: AtomicBool::new(false),
            alert_acknowledged: AtomicBool::new(false),
            alert_phase: AtomicBool::new(false),
            suppress_focus_minimize_until: Mutex::new(None),
            last_window_motion: Mutex::new(Instant::now()),
        }
    }
}

fn window_geometry_path(app: &AppHandle) -> Option<PathBuf> {
    let directory = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&directory).ok()?;
    Some(directory.join("window-geometry.json"))
}

fn save_window_geometry(window: &Window) {
    let (Ok(size), Ok(position), Some(path)) = (
        window.outer_size(),
        window.outer_position(),
        window_geometry_path(window.app_handle()),
    ) else {
        return;
    };
    let geometry = SavedWindowGeometry {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
    };
    if let Ok(contents) = serde_json::to_vec(&geometry) {
        let _ = fs::write(path, contents);
    }
}

fn load_window_geometry(app: &AppHandle) -> Option<SavedWindowGeometry> {
    let path = window_geometry_path(app)?;
    let contents = fs::read(path).ok()?;
    serde_json::from_slice(&contents).ok()
}

fn restore_window_geometry(window: &WebviewWindow) {
    let Some(geometry) = load_window_geometry(window.app_handle()) else {
        return;
    };
    if geometry.width >= 380 && geometry.height >= 500 {
        let _ = window.set_size(PhysicalSize::new(geometry.width, geometry.height));
        let _ = window.set_position(PhysicalPosition::new(geometry.x, geometry.y));
    }
}

fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        acknowledge_tray_alert(app);
    }
}

fn suppress_focus_minimize(app: &AppHandle) {
    let state = app.state::<TrayBehavior>();
    if let Ok(mut deadline) = state.suppress_focus_minimize_until.lock() {
        *deadline = Some(Instant::now() + Duration::from_millis(750));
    };
}

fn consumes_focus_minimize_suppression(app: &AppHandle) -> bool {
    let state = app.state::<TrayBehavior>();
    let Ok(mut deadline) = state.suppress_focus_minimize_until.lock() else {
        return false;
    };
    let Some(value) = *deadline else {
        return false;
    };
    *deadline = None;
    Instant::now() <= value
}

fn note_window_motion(app: &AppHandle) {
    let state = app.state::<TrayBehavior>();
    if let Ok(mut last_motion) = state.last_window_motion.lock() {
        *last_motion = Instant::now();
    };
}

fn should_minimize_after_focus_loss(app: &AppHandle) -> bool {
    let state = app.state::<TrayBehavior>();
    let Ok(last_motion) = state.last_window_motion.lock() else {
        return false;
    };
    if last_motion.elapsed() < Duration::from_millis(300) {
        return false;
    }
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && !window.is_focused().unwrap_or(true)
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if visible && !minimized {
        let _ = window.hide();
    } else {
        suppress_focus_minimize(app);
        reveal_main_window(app);
    }
}

fn minimize_main_window_or_hide(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    if app
        .state::<TrayBehavior>()
        .minimize_to_tray
        .load(Ordering::Relaxed)
    {
        window.hide().map_err(|error| error.to_string())
    } else {
        window.minimize().map_err(|error| error.to_string())
    }
}

fn toggle_global_shortcut_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // Focus can still be reported as false immediately after the app's first window is shown.
    // Visibility is the stable source of truth for the global show/hide toggle.
    let is_open = main_window_is_open(
        window.is_visible().unwrap_or(false),
        window.is_minimized().unwrap_or(false),
    );
    if is_open {
        let _ = minimize_main_window_or_hide(app);
    } else {
        suppress_focus_minimize(app);
        reveal_main_window(app);
    }
}

fn main_window_is_open(visible: bool, minimized: bool) -> bool {
    visible && !minimized
}

fn open_settings(app: &AppHandle) {
    suppress_focus_minimize(app);
    reveal_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.dispatchEvent(new CustomEvent('stocker:open-settings'))");
    }
}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings = tauri::menu::MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = tauri::menu::Menu::with_items(app, &[&settings, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("Stocker tray icon is configured");
    let tray = tauri::tray::TrayIconBuilder::with_id("stocker-tray")
        .icon(icon)
        .tooltip("Stocker")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => open_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(tray);
    Ok(())
}

fn tray_alert_icon() -> Image<'static> {
    const SIZE: usize = 32;
    let mut rgba = vec![0; SIZE * SIZE * 4];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let distance_x = x as i32 - 15;
            let distance_y = y as i32 - 15;
            if distance_x * distance_x + distance_y * distance_y > 13 * 13 {
                continue;
            }
            let offset = (y * SIZE + x) * 4;
            rgba[offset..offset + 4].copy_from_slice(&[156, 67, 62, 255]);
        }
    }
    for y in 8..20 {
        for x in 14..18 {
            let offset = (y * SIZE + x) * 4;
            rgba[offset..offset + 4].copy_from_slice(&[250, 244, 239, 255]);
        }
    }
    for y in 23..26 {
        for x in 14..18 {
            let offset = (y * SIZE + x) * 4;
            rgba[offset..offset + 4].copy_from_slice(&[250, 244, 239, 255]);
        }
    }
    Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

fn update_tray_alert_icon(app: &AppHandle, alert_phase: bool) {
    let Some(tray) = app.tray_by_id("stocker-tray") else {
        return;
    };
    if alert_phase {
        let _ = tray.set_icon(Some(tray_alert_icon()));
        let _ = tray.set_tooltip(Some("Stocker - 盯盘提醒"));
    } else if let Some(icon) = app.default_window_icon().cloned() {
        let _ = tray.set_icon(Some(icon));
        let _ = tray.set_tooltip(Some("Stocker"));
    }
}

fn start_tray_alert_blinker(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(600));
        let state = app.state::<TrayBehavior>();
        if state.alert_active.load(Ordering::Relaxed)
            && !state.alert_acknowledged.load(Ordering::Relaxed)
        {
            let alert_phase = !state.alert_phase.fetch_xor(true, Ordering::Relaxed);
            update_tray_alert_icon(&app, alert_phase);
        } else if state.alert_phase.swap(false, Ordering::Relaxed) {
            update_tray_alert_icon(&app, false);
        }
    });
}

#[tauri::command]
fn set_minimize_to_tray(enabled: bool, state: tauri::State<TrayBehavior>) {
    state.minimize_to_tray.store(enabled, Ordering::Relaxed);
}

fn acknowledge_tray_alert(app: &AppHandle) {
    let state = app.state::<TrayBehavior>();
    state.alert_acknowledged.store(true, Ordering::Relaxed);
    state.alert_phase.store(false, Ordering::Relaxed);
    update_tray_alert_icon(app, false);
}

#[tauri::command]
fn set_tray_alert_active(app: AppHandle, active: bool, new_alert: bool) {
    let state = app.state::<TrayBehavior>();
    state.alert_active.store(active, Ordering::Relaxed);
    if !active {
        state.alert_acknowledged.store(false, Ordering::Relaxed);
        state.alert_phase.store(false, Ordering::Relaxed);
        update_tray_alert_icon(&app, false);
    } else if new_alert {
        state.alert_acknowledged.store(false, Ordering::Relaxed);
        state.alert_phase.store(true, Ordering::Relaxed);
        update_tray_alert_icon(&app, true);
    }
}

fn update_watch_alert_breach(
    active: &mut HashMap<String, String>,
    symbol: &str,
    threshold_key: &str,
    is_breached: bool,
    already_alerted: bool,
) -> bool {
    if !is_breached {
        active.remove(symbol);
        return false;
    }
    if active
        .get(symbol)
        .is_some_and(|stored| stored == threshold_key)
    {
        return false;
    }
    active.insert(symbol.to_string(), threshold_key.to_string());
    !already_alerted
}

#[tauri::command]
fn evaluate_watch_alert_breach(
    symbol: String,
    threshold_key: String,
    is_breached: bool,
    already_alerted: bool,
    state: tauri::State<WatchAlertDedup>,
) -> Result<bool, String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "watch alert state unavailable".to_string())?;
    Ok(update_watch_alert_breach(
        &mut active,
        &symbol,
        &threshold_key,
        is_breached,
        already_alerted,
    ))
}

#[tauri::command]
fn clear_watch_alert_breach(
    symbol: String,
    state: tauri::State<WatchAlertDedup>,
) -> Result<(), String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "watch alert state unavailable".to_string())?;
    active.remove(&symbol);
    Ok(())
}

#[tauri::command]
fn set_auto_start(app: AppHandle, enabled: bool) -> Result<(), String> {
    let auto_launch = app.autolaunch();
    if enabled {
        auto_launch.enable()
    } else {
        auto_launch.disable()
    }
    .map_err(|error| error.to_string())
}

fn update_global_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Err("快捷键不能为空".to_string());
    }
    let config = app.state::<GlobalShortcutConfig>();
    let mut current = config
        .current
        .lock()
        .map_err(|_| "快捷键状态不可用".to_string())?;
    if current
        .as_deref()
        .is_some_and(|registered| registered.eq_ignore_ascii_case(shortcut))
    {
        return Ok(());
    }

    let global_shortcut = app.global_shortcut();
    global_shortcut
        .register(shortcut)
        .map_err(|error| format!("无法注册快捷键 {shortcut}：{error}"))?;
    let previous = current.clone();
    if let Some(previous) = previous {
        if let Err(error) = global_shortcut.unregister(previous.as_str()) {
            let _ = global_shortcut.unregister(shortcut);
            return Err(format!("无法移除旧快捷键 {previous}：{error}"));
        }
    }
    *current = Some(shortcut.to_string());
    Ok(())
}

#[tauri::command]
fn set_global_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    update_global_shortcut(&app, &shortcut)
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不可用".to_string())
}

#[tauri::command]
fn set_window_decorations(app: AppHandle, decorations: bool) -> Result<(), String> {
    main_window(&app)?
        .set_decorations(decorations)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize_main_window(app: AppHandle) -> Result<(), String> {
    minimize_main_window_or_hide(&app)
}

#[tauri::command]
fn toggle_maximize_main_window(app: AppHandle) -> Result<bool, String> {
    let window = main_window(&app)?;
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|error| error.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn close_main_window(app: AppHandle) -> Result<(), String> {
    main_window(&app)?
        .close()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn show_watch_alert(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

fn parse_number(value: Option<&str>) -> Option<f64> {
    value
        .and_then(|item| item.parse::<f64>().ok())
        .filter(|item| item.is_finite())
}

fn romanize_name(name: &str) -> String {
    if name.is_ascii() {
        return name.to_owned();
    }
    let mut words = Vec::new();
    for (index, fragment) in name.split("银行").enumerate() {
        if !fragment.is_empty() {
            words.extend(romanize_fragment(fragment));
        }
        if index < name.matches("银行").count() {
            words.push("yin hang".to_string());
        }
    }
    words.join(" ")
}

fn romanize_fragment(fragment: &str) -> Vec<String> {
    fragment
        .chars()
        .zip(fragment.to_pinyin())
        .map(|(character, pronunciation)| {
            pronunciation
                .map(|pinyin| pinyin.plain().to_owned())
                .unwrap_or_else(|| character.to_string())
        })
        .collect()
}

fn parse_quote(payload: &str, symbol: &str) -> Option<Quote> {
    let marker = format!("v_{symbol}=\"");
    let start = payload.find(&marker)? + marker.len();
    let end = payload[start..].find('"')? + start;
    let values: Vec<&str> = payload[start..end].split('~').collect();
    let name = values.get(1)?.to_string();
    let price = parse_number(values.get(3).copied())?;
    let previous_close = parse_number(values.get(4).copied());
    let open = parse_number(values.get(5).copied());
    let high = parse_number(values.get(33).copied());
    let low = parse_number(values.get(34).copied());
    let amount = values
        .get(35)
        .and_then(|item| item.split('/').nth(2))
        .and_then(|item| item.parse::<f64>().ok())
        .filter(|item| item.is_finite());
    let change = parse_number(values.get(31).copied())
        .unwrap_or_else(|| price - previous_close.unwrap_or(price));
    let percent = parse_number(values.get(32).copied()).unwrap_or_else(|| {
        previous_close
            .map(|close| (price - close) / close * 100.0)
            .unwrap_or(0.0)
    });
    Some(Quote {
        symbol: symbol.to_string(),
        pinyin: romanize_name(&name),
        name,
        price,
        previous_close,
        open,
        high,
        low,
        amount,
        change,
        percent,
        updated_at: values
            .get(30)
            .map(|item| item.to_string())
            .filter(|item| !item.is_empty()),
        status: if values.first() == Some(&"1") {
            "open".into()
        } else {
            "closed".into()
        },
    })
}

#[tauri::command]
async fn fetch_quotes(symbols: Vec<String>) -> Result<QuoteResponse, String> {
    let mut unique = HashSet::new();
    let safe_symbols: Vec<String> = symbols
        .into_iter()
        .filter(|symbol| {
            symbol.len() >= 2
                && symbol.len() <= 20
                && symbol
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
        })
        .filter(|symbol| unique.insert(symbol.clone()))
        .collect();
    if safe_symbols.is_empty() {
        return Ok(QuoteResponse {
            quotes: Vec::new(),
            fetched_at: now(),
        });
    }
    let url = format!("https://qt.gtimg.cn/q={}", safe_symbols.join(","));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(7))
        .build()
        .map_err(|error| error.to_string())?;
    let body = client
        .get(url)
        .header("Referer", "https://gu.qq.com/")
        .header("User-Agent", "Stocker/0.1")
        .send()
        .await
        .map_err(|error| format!("行情请求失败: {error}"))?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .await
        .map_err(|error| error.to_string())?;
    let (payload, _, _) = GBK.decode(&body);
    Ok(QuoteResponse {
        quotes: safe_symbols
            .iter()
            .filter_map(|symbol| parse_quote(&payload, symbol))
            .collect(),
        fetched_at: now(),
    })
}

fn parse_search_result(entry: &str) -> Option<AssetSearchResult> {
    let fields: Vec<&str> = entry.split('~').collect();
    let exchange = *fields.first()?;
    let code = *fields.get(1)?;
    let name = *fields.get(2)?;
    let asset_type = fields.get(4).copied().unwrap_or_default();
    let supported_asset_type =
        asset_type.starts_with("GP") || matches!(asset_type, "ETF" | "LOF" | "FUND");
    if !supported_asset_type || code.is_empty() || name.is_empty() {
        return None;
    }
    let (market, symbol, display_code) = match exchange {
        "sh" | "sz" => ("CN", format!("{exchange}{code}"), code.to_string()),
        "hk" => ("HK", format!("hk{code}"), code.to_string()),
        "us" => {
            let ticker = code.split('.').next()?.to_ascii_uppercase();
            ("US", format!("us{ticker}"), ticker)
        }
        _ => return None,
    };
    Some(AssetSearchResult {
        symbol,
        code: display_code,
        name: name.to_string(),
        market: market.to_string(),
        asset_type: if matches!(asset_type, "ETF" | "LOF" | "FUND") {
            "etf".to_string()
        } else {
            "stock".to_string()
        },
    })
}

#[tauri::command]
async fn search_assets(
    query: String,
    market: Option<String>,
) -> Result<Vec<AssetSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| error.to_string())?;
    let body = client
        .get("https://smartbox.gtimg.cn/s3/")
        .query(&[("q", query), ("t", "all")])
        .header("Referer", "https://gu.qq.com/")
        .header("User-Agent", "Stocker/0.1")
        .send()
        .await
        .map_err(|error| format!("搜索请求失败: {error}"))?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;
    let marker = "v_hint=\"";
    let Some(start) = body.find(marker).map(|index| index + marker.len()) else {
        return Ok(Vec::new());
    };
    let Some(end) = body[start..].find('"').map(|index| start + index) else {
        return Ok(Vec::new());
    };
    let decoded = serde_json::from_str::<String>(&format!("\"{}\"", &body[start..end]))
        .map_err(|error| format!("搜索结果解析失败: {error}"))?;
    let results = decoded
        .split('^')
        .filter_map(parse_search_result)
        .filter(|item| {
            market
                .as_deref()
                .is_none_or(|value| value == "all" || item.market == value)
        })
        .take(60)
        .collect();
    Ok(results)
}

fn now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_global_shortcut_window(app);
                    }
                })
                .build(),
        )
        .manage(TrayBehavior::default())
        .manage(WatchAlertDedup::default())
        .manage(GlobalShortcutConfig::default())
        .invoke_handler(tauri::generate_handler![
            fetch_quotes,
            search_assets,
            set_minimize_to_tray,
            set_tray_alert_active,
            evaluate_watch_alert_breach,
            clear_watch_alert_breach,
            set_auto_start,
            set_global_shortcut,
            set_window_decorations,
            minimize_main_window,
            toggle_maximize_main_window,
            close_main_window,
            show_watch_alert
        ])
        .setup(|app| {
            if let Err(error) = update_global_shortcut(&app.handle(), DEFAULT_GLOBAL_SHORTCUT) {
                eprintln!("默认全局快捷键不可用：{error}");
            }
            if let Some(window) = app.get_webview_window("main") {
                restore_window_geometry(&window);
            }
            create_tray(app).map_err(|error| Box::new(error) as Box<dyn std::error::Error>)?;
            start_tray_alert_blinker(&app.handle());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(true) => acknowledge_tray_alert(window.app_handle()),
            WindowEvent::CloseRequested { api, .. } => {
                save_window_geometry(window);
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Resized(size)
                if size.width == 0
                    && size.height == 0
                    && window
                        .state::<TrayBehavior>()
                        .minimize_to_tray
                        .load(Ordering::Relaxed) =>
            {
                let _ = window.hide();
            }
            WindowEvent::Focused(false) => {
                if !consumes_focus_minimize_suppression(window.app_handle()) {
                    let app = window.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(300));
                        if should_minimize_after_focus_loss(&app) {
                            let _ = minimize_main_window_or_hide(&app);
                        }
                    });
                }
            }
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                note_window_motion(window.app_handle());
                save_window_geometry(window);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Stocker");
}

#[cfg(test)]
mod tests {
    use super::{
        main_window_is_open, parse_search_result, romanize_name, update_watch_alert_breach,
    };
    use std::collections::HashMap;

    #[test]
    fn treats_first_visible_window_as_open_without_requiring_focus() {
        assert!(main_window_is_open(true, false));
        assert!(!main_window_is_open(false, false));
        assert!(!main_window_is_open(true, true));
    }

    #[test]
    fn only_records_a_watch_alert_once_until_cleared() {
        let mut active = HashMap::new();
        assert!(update_watch_alert_breach(
            &mut active,
            "hk02513",
            "5.000000",
            true,
            false
        ));
        assert!(!update_watch_alert_breach(
            &mut active,
            "hk02513",
            "5.000000",
            true,
            false
        ));
        assert!(!update_watch_alert_breach(
            &mut active,
            "hk02513",
            "5.000000",
            false,
            false
        ));
        assert!(update_watch_alert_breach(
            &mut active,
            "hk02513",
            "5.000000",
            true,
            false
        ));
    }

    #[test]
    fn restores_persisted_watch_alert_without_retriggering() {
        let mut active = HashMap::new();
        assert!(!update_watch_alert_breach(
            &mut active,
            "hk02513",
            "5.000000",
            true,
            true
        ));
        assert!(!update_watch_alert_breach(
            &mut active,
            "hk02513",
            "5.000000",
            true,
            false
        ));
    }

    #[test]
    fn normalizes_stock_search_results_for_every_market() {
        let cn = parse_search_result("sh~688825~长鑫科技~cxkj~GP-A-KCB").unwrap();
        let hk = parse_search_result("hk~00700~腾讯控股~txkg~GP").unwrap();
        let us = parse_search_result("us~aapl.oq~苹果~pg~GP").unwrap();

        assert_eq!((cn.symbol.as_str(), cn.market.as_str()), ("sh688825", "CN"));
        assert_eq!((hk.symbol.as_str(), hk.market.as_str()), ("hk00700", "HK"));
        assert_eq!(
            (us.symbol.as_str(), us.code.as_str(), us.market.as_str()),
            ("usAAPL", "AAPL", "US")
        );
    }

    #[test]
    fn keeps_etf_search_results() {
        let etf = parse_search_result("sz~159928~消费ETF汇添富~xfetfhtf~ETF").unwrap();
        assert_eq!(
            (etf.symbol.as_str(), etf.code.as_str(), etf.market.as_str()),
            ("sz159928", "159928", "CN")
        );
    }

    #[test]
    fn romanizes_chinese_names_without_losing_ascii() {
        assert_eq!(romanize_name("平安银行"), "ping an yin hang");
        assert_eq!(romanize_name("MINIMAX-W"), "MINIMAX-W");
    }
}
