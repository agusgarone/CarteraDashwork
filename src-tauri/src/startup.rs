use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::watch;

#[derive(Default, PartialEq, Debug)]
enum Phase {
    #[default]
    Waiting,
    Fading,
    MainVisible,
    Presented,
}

pub struct StartupState {
    backend: watch::Sender<Option<Result<(), String>>>,
    phase: Mutex<Phase>,
}

impl Default for StartupState {
    fn default() -> Self {
        Self {
            backend: watch::channel(None).0,
            phase: Mutex::new(Phase::Waiting),
        }
    }
}

impl StartupState {
    pub fn backend_finished(&self, outcome: Result<(), String>) {
        self.backend.send_replace(Some(outcome));
    }

    async fn wait_for_backend(&self) -> Result<(), String> {
        let mut receiver = self.backend.subscribe();
        receiver
            .wait_for(|value| value.is_some())
            .await
            .map_err(|error| error.to_string())?;
        let outcome = receiver.borrow().clone();
        outcome.unwrap_or_else(|| Err("No se pudo iniciar la aplicación.".into()))
    }

    fn begin_fade(&self) -> Result<bool, String> {
        let mut phase = self.phase.lock().map_err(|error| error.to_string())?;
        if *phase != Phase::Waiting {
            return Ok(false);
        }
        *phase = Phase::Fading;
        Ok(true)
    }

    fn present_with(
        &self,
        show: impl FnOnce() -> Result<(), String>,
        close: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut phase = self.phase.lock().map_err(|error| error.to_string())?;
        if *phase == Phase::Presented {
            return Ok(());
        }
        if *phase != Phase::MainVisible {
            show()?;
            *phase = Phase::MainVisible;
        }
        close()?;
        *phase = Phase::Presented;
        Ok(())
    }
}

#[tauri::command]
pub async fn startup_backend_ready(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, StartupState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada.".into());
    }
    state.wait_for_backend().await
}

fn present_main(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<StartupState>();
    state.present_with(
        || {
            let main = app
                .get_webview_window("main")
                .ok_or("No se encontró la ventana principal.")?;
            main.show().map_err(|error| error.to_string())?;
            let _ = main.set_focus();
            Ok(())
        },
        || {
            if let Some(splash) = app.get_webview_window("splash") {
                // No listeners cancel this close. Destroy is a fallback for a native close error.
                splash
                    .close()
                    .or_else(|_| splash.destroy())
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        },
    )
}

#[tauri::command]
pub fn startup_show_main(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if window.label() != "splash" {
        return Err("Ventana no autorizada.".into());
    }
    present_main(&app)
}

#[tauri::command]
pub fn startup_frontend_ready(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada.".into());
    }
    if !app.state::<StartupState>().begin_fade()? {
        return Ok(());
    }
    // The fade is 120 ms; never wait for the entrance animation or enforce a minimum display time.
    let _ = app.emit_to("splash", "startup-ready", ());
    tauri::async_runtime::spawn(async move {
        // Also finish if the splash listener was not loaded or its script failed.
        tokio::time::sleep(Duration::from_millis(180)).await;
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = present_main(&handle) {
                log::error!("No se pudo mostrar la ventana principal: {error}");
            }
        });
    });
    Ok(())
}

pub fn start_watchdog(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // A recovery notice, never a forced READY or a timeout on DB operations.
        tokio::time::sleep(Duration::from_secs(45)).await;
        let state = app.state::<StartupState>();
        let presented = state
            .phase
            .lock()
            .map(|phase| *phase == Phase::Presented)
            .unwrap_or(false);
        if !presented {
            if let Some(splash) = app.get_webview_window("splash") {
                let _ = splash.eval("document.getElementById('status').textContent = 'El inicio está tardando más de lo habitual. Podés abrir la aplicación para revisar el estado.'; document.getElementById('recovery').hidden = false; document.body.getAnimations().forEach(animation => animation.cancel()); document.body.style.opacity = '1';");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[tokio::test]
    async fn waits_for_backend_and_preserves_errors() {
        let state = StartupState::default();
        assert!(
            tokio::time::timeout(Duration::from_millis(10), state.wait_for_backend())
                .await
                .is_err()
        );
        state.backend_finished(Err("No se pudo abrir SQLite".into()));
        assert_eq!(
            state.wait_for_backend().await,
            Err("No se pudo abrir SQLite".into())
        );
        assert_eq!(
            state.wait_for_backend().await,
            Err("No se pudo abrir SQLite".into())
        );
    }

    #[tokio::test]
    async fn backend_ready_is_retained_for_dev_reload() {
        let state = StartupState::default();
        state.backend_finished(Ok(()));
        assert_eq!(state.wait_for_backend().await, Ok(()));
        assert_eq!(state.wait_for_backend().await, Ok(()));
    }

    #[test]
    fn strict_mode_and_reload_present_only_once() {
        let state = StartupState::default();
        assert!(state.begin_fade().unwrap());
        assert!(!state.begin_fade().unwrap());
        let shows = Cell::new(0);
        let closes = Cell::new(0);
        for _ in 0..3 {
            state
                .present_with(
                    || {
                        shows.set(shows.get() + 1);
                        Ok(())
                    },
                    || {
                        closes.set(closes.get() + 1);
                        Ok(())
                    },
                )
                .unwrap();
        }
        assert_eq!(shows.get(), 1);
        assert_eq!(closes.get(), 1);
        assert!(!state.begin_fade().unwrap());
    }

    #[test]
    fn failed_close_can_retry_without_showing_main_twice() {
        let state = StartupState::default();
        let shows = Cell::new(0);
        state
            .present_with(
                || {
                    shows.set(shows.get() + 1);
                    Ok(())
                },
                || Err("close failed".into()),
            )
            .unwrap_err();
        state
            .present_with(
                || {
                    shows.set(shows.get() + 1);
                    Ok(())
                },
                || Ok(()),
            )
            .unwrap();
        assert_eq!(shows.get(), 1);
    }

    #[test]
    fn failed_show_does_not_close_splash_and_can_retry() {
        let state = StartupState::default();
        state
            .present_with(
                || Err("show failed".into()),
                || panic!("Must keep splash available"),
            )
            .unwrap_err();
        state.present_with(|| Ok(()), || Ok(())).unwrap();
    }
}
