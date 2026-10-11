use std::{
    process::Stdio,
    sync::{Arc, Mutex},
};

use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use tokio::{
    process::{Child, ChildStdout, Command},
    sync::watch,
};

pub const CAPTURE_SAMPLES: usize = 32_768;
pub const SUPPORTED_RATES: [u32; 3] = [240_000, 1_024_000, 2_400_000];
const SUPPORTED_GAINS: [f32; 29] = [
    0.0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28.0, 29.7,
    32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48.0, 49.6,
];

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct ReceiverSettings {
    pub center_hz: u32,
    pub sample_rate: u32,
    pub gain_db: Option<f32>,
}

impl Default for ReceiverSettings {
    fn default() -> Self {
        Self {
            center_hz: 97_100_000,
            sample_rate: 2_400_000,
            gain_db: Some(29.7),
        }
    }
}

impl ReceiverSettings {
    pub fn validate(self) -> Result<Self, &'static str> {
        if !(24_000_000..=1_766_000_000).contains(&self.center_hz) {
            return Err("Center frequency must be between 24 and 1766 MHz.");
        }
        if !SUPPORTED_RATES.contains(&self.sample_rate) {
            return Err("Unsupported sample rate.");
        }
        if self
            .gain_db
            .is_some_and(|gain| !SUPPORTED_GAINS.contains(&gain) || gain == 0.0)
        {
            return Err("Choose a supported manual tuner gain, or automatic gain.");
        }
        Ok(self)
    }
}

#[derive(Clone)]
pub struct AppState {
    pub live: bool,
    pub device: Arc<String>,
    pub executable: Arc<String>,
    pub owner: Arc<Mutex<Option<String>>>,
    pub settings: watch::Sender<ReceiverSettings>,
}

impl AppState {
    pub fn from_env() -> Result<Self, String> {
        let source = std::env::var("SDR_SOURCE").unwrap_or_else(|_| "synthetic".into());
        if source != "synthetic" && source != "rtlsdr" {
            return Err("SDR_SOURCE must be synthetic or rtlsdr.".into());
        }
        let (settings, _) = watch::channel(ReceiverSettings::default());
        Ok(Self {
            live: source == "rtlsdr",
            device: Arc::new(std::env::var("SDR_DEVICE").unwrap_or_else(|_| "homelab_sdr".into())),
            executable: Arc::new(
                std::env::var("SDR_RTL_EXECUTABLE").unwrap_or_else(|_| "rtl_sdr".into()),
            ),
            owner: Arc::new(Mutex::new(None)),
            settings,
        })
    }

    pub fn claim(&self, owner_id: String) -> Result<DeviceLease, &'static str> {
        let mut owner = self.owner.lock().expect("device ownership lock");
        if owner.is_some() {
            return Err(
                "The RTL-SDR is already owned by another browser session. Close it, then reconnect.",
            );
        }
        *owner = Some(owner_id);
        Ok(DeviceLease(self.owner.clone()))
    }
}

pub struct DeviceLease(Arc<Mutex<Option<String>>>);

impl Drop for DeviceLease {
    fn drop(&mut self) {
        *self.0.lock().expect("device ownership lock") = None;
    }
}

#[derive(Deserialize)]
pub struct TuneRequest {
    owner_id: String,
    settings: ReceiverSettings,
}

pub async fn tune(
    State(state): State<AppState>,
    Json(request): Json<TuneRequest>,
) -> Result<Json<ReceiverSettings>, (StatusCode, &'static str)> {
    if !state.live {
        return Err((
            StatusCode::CONFLICT,
            "This server uses the synthetic source.",
        ));
    }
    let settings = request
        .settings
        .validate()
        .map_err(|detail| (StatusCode::BAD_REQUEST, detail))?;
    let owner = state.owner.lock().expect("device ownership lock");
    if owner.as_deref() != Some(request.owner_id.as_str()) {
        return Err((
            StatusCode::CONFLICT,
            "Only the connected device owner can tune the receiver.",
        ));
    }
    state.settings.send_replace(settings);
    Ok(Json(settings))
}

pub struct Capture {
    child: Child,
    pub stdout: ChildStdout,
}

impl Capture {
    pub fn start(state: &AppState, settings: ReceiverSettings) -> std::io::Result<Self> {
        let mut child = Command::new(state.executable.as_str())
            .args([
                "-d",
                state.device.as_str(),
                "-f",
                &settings.center_hz.to_string(),
                "-s",
                &settings.sample_rate.to_string(),
                "-g",
                &settings.gain_db.unwrap_or(0.0).to_string(),
                "-b",
                &(CAPTURE_SAMPLES * 2).to_string(),
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()?;
        let stdout = child.stdout.take().expect("piped capture stdout");
        Ok(Self { child, stdout })
    }

    pub async fn stop(&mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tuning_rejects_invalid_hardware_parameters() {
        assert!(ReceiverSettings::default().validate().is_ok());
        for settings in [
            ReceiverSettings {
                center_hz: 1,
                ..Default::default()
            },
            ReceiverSettings {
                sample_rate: 48_000,
                ..Default::default()
            },
            ReceiverSettings {
                gain_db: Some(f32::NAN),
                ..Default::default()
            },
            ReceiverSettings {
                gain_db: Some(12.0),
                ..Default::default()
            },
        ] {
            assert!(settings.validate().is_err());
        }
    }

    #[test]
    fn ownership_is_exclusive_and_released_on_drop() {
        let state = AppState::from_env().unwrap();
        let lease = state.claim("first".into()).unwrap();
        assert!(state.claim("second".into()).is_err());
        drop(lease);
        assert!(state.claim("second".into()).is_ok());
    }
}
