//! Bounded recording of full capture blocks, before browser ACK shedding.
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::SinkExt;
use serde::{Deserialize, Serialize};
use tokio::{
    fs::{self, File},
    io::{AsyncReadExt, AsyncWriteExt, BufWriter},
    sync::mpsc,
    task::JoinHandle,
    time::{Instant, timeout},
};

use crate::receiver::{AppState, ReceiverSettings};

const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_BLOCK_BYTES: usize = 262_168;
const QUEUE_BLOCKS: usize = 8;
const IO_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct Store {
    root: Arc<PathBuf>,
    active: Arc<Mutex<Option<Metadata>>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Metadata {
    pub id: String,
    pub name: String,
    pub created_ms: u64,
    pub source: String,
    pub path: String,
    pub format: String,
    pub sample_rate: u32,
    pub center_hz: u32,
    pub gain_db: Option<f32>,
    pub duration_seconds: f64,
    pub bytes: u64,
    pub blocks: u64,
    pub missing_blocks: u64,
    pub status: String,
    pub detail: String,
}

impl Store {
    pub async fn initialize(&self) -> std::io::Result<()> {
        fs::create_dir_all(self.root.as_ref()).await?;
        let mut directory = fs::read_dir(self.root.as_ref()).await?;
        while let Some(entry) = directory.next_entry().await? {
            if entry
                .path()
                .extension()
                .is_none_or(|extension| extension != "json")
            {
                continue;
            }
            let bytes = fs::read(entry.path()).await?;
            let Ok(mut metadata) = serde_json::from_slice::<Metadata>(&bytes) else {
                continue;
            };
            if metadata.status != "recording" {
                continue;
            }
            let Ok(path) = self.path(&metadata.id, "iqrec") else {
                continue;
            };
            metadata.path = path.display().to_string();
            metadata.duration_seconds = 0.0;
            metadata.blocks = 0;
            metadata.missing_blocks = 0;
            let mut previous: Option<u32> = None;
            if let Ok(mut file) = File::open(&path).await {
                while let Ok(Some(bytes)) = read_block(&mut file).await {
                    metadata.duration_seconds += field(&bytes, 12) as f64 / field(&bytes, 8) as f64;
                    metadata.blocks += 1;
                    let sequence = field(&bytes, 4);
                    if let Some(last) = previous {
                        metadata.missing_blocks +=
                            sequence.wrapping_sub(last).saturating_sub(1) as u64;
                    }
                    previous = Some(sequence);
                }
            }
            metadata.bytes = fs::metadata(path).await.map(|file| file.len()).unwrap_or(0);
            metadata.status = "interrupted".into();
            metadata.detail = "Server stopped before finalizing this recording; complete blocks recovered, partial tail may be unreadable.".into();
            self.save(&metadata).await?;
        }
        Ok(())
    }
    pub fn from_env() -> Result<Self, String> {
        let root = PathBuf::from(
            std::env::var("SDR_RECORDINGS_DIR").unwrap_or_else(|_| "recordings".into()),
        );
        let root = if root.is_absolute() {
            root
        } else {
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(root)
        };
        Ok(Self {
            root: Arc::new(root),
            active: Arc::new(Mutex::new(None)),
        })
    }

    fn path(&self, id: &str, extension: &str) -> Result<PathBuf, &'static str> {
        if id.is_empty() || id.len() > 64 || !id.bytes().all(|c| c.is_ascii_digit() || c == b'-') {
            return Err("Invalid recording ID.");
        }
        Ok(self.root.join(format!("{id}.{extension}")))
    }

    async fn save(&self, metadata: &Metadata) -> std::io::Result<()> {
        let path = self
            .path(&metadata.id, "json")
            .map_err(std::io::Error::other)?;
        let temporary = self
            .path(&metadata.id, "json.tmp")
            .map_err(std::io::Error::other)?;
        fs::write(&temporary, serde_json::to_vec_pretty(metadata)?).await?;
        fs::rename(temporary, path).await
    }

    async fn metadata(&self, id: &str) -> Result<Metadata, ApiError> {
        let path = self.path(id, "json").map_err(bad_request)?;
        let bytes = fs::read(path)
            .await
            .map_err(|_| (StatusCode::NOT_FOUND, "Recording not found.".into()))?;
        serde_json::from_slice(&bytes).map_err(internal)
    }
}

type ApiError = (StatusCode, String);
fn bad_request(detail: &str) -> ApiError {
    (StatusCode::BAD_REQUEST, detail.into())
}
fn internal(error: impl std::fmt::Display) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

#[derive(Serialize)]
pub struct Catalog {
    directory: String,
    max_seconds: u32,
    max_bytes: u64,
    recordings: Vec<Metadata>,
    unindexed_files: Vec<String>,
}

pub async fn catalog(State(state): State<AppState>) -> Result<Json<Catalog>, ApiError> {
    let store = &state.recordings;
    fs::create_dir_all(store.root.as_ref())
        .await
        .map_err(internal)?;
    let mut directory = fs::read_dir(store.root.as_ref()).await.map_err(internal)?;
    let mut recordings = Vec::new();
    let mut data_files = Vec::new();
    let mut unindexed_files = Vec::new();
    let active = store.active.lock().expect("recording lock").clone();
    while let Some(entry) = directory.next_entry().await.map_err(internal)? {
        if entry
            .path()
            .extension()
            .is_some_and(|extension| extension == "iqrec")
        {
            data_files.push(entry.path());
        }
        if entry
            .path()
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            let bytes = fs::read(entry.path()).await.map_err(internal)?;
            if let Ok(mut metadata) = serde_json::from_slice::<Metadata>(&bytes) {
                let Ok(path) = store.path(&metadata.id, "iqrec") else {
                    unindexed_files.push(entry.path().display().to_string());
                    continue;
                };
                metadata.path = path.display().to_string();
                if let Some(current) = active.as_ref().filter(|current| current.id == metadata.id) {
                    metadata = current.clone();
                } else if metadata.status == "recording" {
                    metadata.status = "interrupted".into();
                    metadata.detail =
                        "Server stopped before finalizing this recording; partial file retained."
                            .into();
                    metadata.bytes = fs::metadata(&metadata.path)
                        .await
                        .map(|file| file.len())
                        .unwrap_or(0);
                }
                recordings.push(metadata);
            } else {
                unindexed_files.push(entry.path().display().to_string());
            }
        }
    }
    for path in data_files {
        if !recordings.iter().any(|recording| {
            path.file_stem()
                .is_some_and(|stem| stem == recording.id.as_str())
        }) {
            unindexed_files.push(path.display().to_string());
        }
    }
    recordings.sort_by_key(|recording| std::cmp::Reverse(recording.created_ms));
    Ok(Json(Catalog {
        directory: store.root.display().to_string(),
        max_seconds: 60,
        max_bytes: MAX_BYTES,
        recordings,
        unindexed_files,
    }))
}

#[derive(Deserialize)]
pub struct Rename {
    name: String,
}

pub async fn rename(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<Rename>,
) -> Result<Json<Metadata>, ApiError> {
    validate_name(&request.name).map_err(bad_request)?;
    ensure_inactive(&state.recordings, &id)?;
    let mut metadata = state.recordings.metadata(&id).await?;
    metadata.name = request.name.trim().into();
    state.recordings.save(&metadata).await.map_err(internal)?;
    Ok(Json(metadata))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    ensure_inactive(&state.recordings, &id)?;
    let data = state.recordings.path(&id, "iqrec").map_err(bad_request)?;
    let metadata = state.recordings.path(&id, "json").map_err(bad_request)?;
    fs::remove_file(data).await.map_err(internal)?;
    fs::remove_file(metadata).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

fn ensure_inactive(store: &Store, id: &str) -> Result<(), ApiError> {
    if store
        .active
        .lock()
        .expect("recording lock")
        .as_ref()
        .is_some_and(|active| active.id == id)
    {
        return Err((StatusCode::CONFLICT, "Stop recording first.".into()));
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<(), &'static str> {
    if name.trim().is_empty() || name.len() > 120 || name.chars().any(char::is_control) {
        return Err("Recording name must contain 1–120 characters without control characters.");
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct RecordRequest {
    name: String,
    seconds: u32,
}

pub struct Recorder {
    sender: Option<mpsc::Sender<Vec<u8>>>,
    task: JoinHandle<()>,
    deadline: Instant,
    store: Store,
    id: String,
}

impl Recorder {
    pub async fn start(
        state: &AppState,
        request: RecordRequest,
        settings: ReceiverSettings,
    ) -> Result<Self, String> {
        validate_name(&request.name).map_err(str::to_string)?;
        if !(1..=60).contains(&request.seconds) {
            return Err("Recording duration must be 1–60 seconds.".into());
        }
        let store = state.recordings.clone();
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?;
        let created_ms = created.as_millis() as u64;
        let id = format!("{}-{}", created.as_nanos(), std::process::id());
        let metadata = Metadata {
            id: id.clone(),
            name: request.name.trim().into(),
            created_ms,
            source: if state.live { "rtlsdr" } else { "synthetic" }.into(),
            path: store.path(&id, "iqrec")?.display().to_string(),
            format: if state.live {
                "IQ02 / uint8 I/Q"
            } else {
                "IQ01 / float32 I/Q"
            }
            .into(),
            sample_rate: if state.live {
                settings.sample_rate
            } else {
                crate::SAMPLE_RATE
            },
            center_hz: if state.live { settings.center_hz } else { 0 },
            gain_db: if state.live { settings.gain_db } else { None },
            duration_seconds: 0.0,
            bytes: 0,
            blocks: 0,
            missing_blocks: 0,
            status: "recording".into(),
            detail: String::new(),
        };
        {
            let mut active = store.active.lock().expect("recording lock");
            if active.is_some() {
                return Err("Another recording is already active on this server.".into());
            }
            *active = Some(metadata.clone());
        }
        let setup = async {
            fs::create_dir_all(store.root.as_ref()).await?;
            let file = File::create_new(&metadata.path).await?;
            store.save(&metadata).await?;
            Ok::<_, std::io::Error>(file)
        }
        .await;
        let file = match setup {
            Ok(file) => file,
            Err(error) => {
                *store.active.lock().expect("recording lock") = None;
                return Err(error.to_string());
            }
        };
        let (sender, receiver) = mpsc::channel(QUEUE_BLOCKS);
        let task_store = store.clone();
        let task = tokio::spawn(async move {
            write_recording(task_store, file, metadata, receiver).await;
        });
        Ok(Self {
            sender: Some(sender),
            task,
            deadline: Instant::now() + Duration::from_secs(request.seconds as u64),
            store,
            id,
        })
    }

    pub fn offer(&mut self, bytes: &[u8]) {
        if Instant::now() >= self.deadline {
            if let Some(active) = self
                .store
                .active
                .lock()
                .expect("recording lock")
                .as_mut()
                .filter(|active| active.id == self.id)
            {
                if active.detail.is_empty() {
                    active.detail = "Requested duration reached.".into();
                }
            }
        }
        if Instant::now() >= self.deadline || self.task.is_finished() {
            self.sender = None;
        }
        if let Some(sender) = &self.sender {
            if sender.try_send(bytes.to_vec()).is_err() {
                if let Some(active) = self
                    .store
                    .active
                    .lock()
                    .expect("recording lock")
                    .as_mut()
                    .filter(|active| active.id == self.id)
                {
                    active.detail =
                        "Disk queue filled; recording stopped instead of blocking capture.".into();
                }
                self.sender = None;
            }
        }
    }

    pub async fn finish(self, reason: &str) {
        if let Some(active) = self
            .store
            .active
            .lock()
            .expect("recording lock")
            .as_mut()
            .filter(|active| active.id == self.id)
        {
            if active.detail.is_empty() {
                active.detail = reason.into();
            }
        }
        drop(self.sender);
        let _ = self.task.await;
    }

    pub fn finished(&self) -> bool {
        self.task.is_finished()
    }
}

async fn write_recording(
    store: Store,
    file: File,
    mut metadata: Metadata,
    mut receiver: mpsc::Receiver<Vec<u8>>,
) {
    let mut writer = BufWriter::new(file);
    let mut previous: Option<u32> = None;
    let mut failure = None;
    while let Some(bytes) = receiver.recv().await {
        if metadata.bytes + bytes.len() as u64 + 4 > MAX_BYTES {
            metadata.detail = "Recording size limit reached.".into();
            break;
        }
        let write = async {
            writer
                .write_all(&(bytes.len() as u32).to_le_bytes())
                .await?;
            writer.write_all(&bytes).await
        };
        match timeout(IO_TIMEOUT, write).await {
            Ok(Ok(())) => {}
            result => {
                failure = Some(format!("Disk write failed or timed out: {result:?}"));
                break;
            }
        }
        let sequence = field(&bytes, 4);
        if let Some(last) = previous {
            metadata.missing_blocks += sequence.wrapping_sub(last).saturating_sub(1) as u64;
        }
        previous = Some(sequence);
        metadata.duration_seconds += field(&bytes, 12) as f64 / field(&bytes, 8) as f64;
        metadata.bytes += bytes.len() as u64 + 4;
        metadata.blocks += 1;
        let mut active = store.active.lock().expect("recording lock");
        if let Some(current) = active.as_ref() {
            if !current.detail.is_empty() {
                metadata.detail = current.detail.clone();
            }
        }
        *active = Some(metadata.clone());
    }
    match timeout(IO_TIMEOUT, writer.flush()).await {
        Ok(Ok(())) => {}
        result => {
            failure = Some(format!("Disk flush failed or timed out: {result:?}"));
        }
    }
    if let Some(active) = store.active.lock().expect("recording lock").as_ref() {
        if metadata.detail.is_empty() {
            metadata.detail = active.detail.clone();
        }
    }
    metadata.status = if failure.is_some() { "failed" } else { "ready" }.into();
    metadata.bytes = fs::metadata(&metadata.path)
        .await
        .map(|file| file.len())
        .unwrap_or(metadata.bytes);
    if let Some(detail) = failure {
        metadata.detail = detail;
    }
    if let Err(error) = store.save(&metadata).await {
        eprintln!("Recording metadata save failed: {error}");
    }
    *store.active.lock().expect("recording lock") = None;
}

fn field(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("I/Q field"))
}

pub async fn control(
    text: &str,
    state: &AppState,
    recorder: &mut Option<Recorder>,
    settings: ReceiverSettings,
) -> Result<(), String> {
    if text == "record-stop" {
        if let Some(recording) = recorder.take() {
            recording.finish("Stopped by browser.").await;
        }
    } else if let Some(request) = text.strip_prefix("record:") {
        if recorder.as_ref().is_some_and(Recorder::finished) {
            *recorder = None;
        }
        if recorder.is_some() {
            return Err("This stream already has an active recording.".into());
        }
        let request = serde_json::from_str(request).map_err(|_| "Invalid recording request.")?;
        *recorder = Some(Recorder::start(state, request, settings).await?);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct ReplayQuery {
    #[serde(default)]
    start: f64,
}

pub async fn replay(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ReplayQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, ApiError> {
    if !query.start.is_finite() || query.start < 0.0 {
        return Err(bad_request("Invalid playback position."));
    }
    ensure_inactive(&state.recordings, &id)?;
    state.recordings.metadata(&id).await?;
    let file = File::open(state.recordings.path(&id, "iqrec").map_err(bad_request)?)
        .await
        .map_err(internal)?;
    Ok(ws.on_upgrade(move |socket| async move {
        let mut socket = socket;
        if let Err(error) = replay_file(&mut socket, file, query.start).await {
            let _ = socket
                .send(Message::Text(format!("error:{error}").into()))
                .await;
        } else {
            let _ = socket.send(Message::Text("replay-ended".into())).await;
        }
        let _ = socket.close().await;
    }))
}

async fn read_block(file: &mut File) -> std::io::Result<Option<Vec<u8>>> {
    let mut length = [0; 4];
    if file.read(&mut length[..1]).await? == 0 {
        return Ok(None);
    }
    file.read_exact(&mut length[1..]).await?;
    let length = u32::from_le_bytes(length) as usize;
    if !(16..=MAX_BLOCK_BYTES).contains(&length) {
        return Err(std::io::Error::other("Invalid recording block length."));
    }
    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes).await?;
    let count = field(&bytes, 12) as usize;
    let valid = match &bytes[..4] {
        b"IQ01" => count.checked_mul(8).and_then(|n| n.checked_add(16)) == Some(length),
        b"IQ02" => {
            length >= 24
                && field(&bytes, 20) == 1
                && count.checked_mul(2).and_then(|n| n.checked_add(24)) == Some(length)
        }
        _ => false,
    };
    if !valid || count == 0 || field(&bytes, 8) == 0 {
        return Err(std::io::Error::other("Invalid I/Q recording block."));
    }
    Ok(Some(bytes))
}

async fn replay_file(socket: &mut WebSocket, mut file: File, start: f64) -> Result<(), String> {
    let mut position = 0.0;
    let mut reported_at = Instant::now() - Duration::from_secs(1);
    while let Some(bytes) = read_block(&mut file).await.map_err(|e| e.to_string())? {
        let seconds = field(&bytes, 12) as f64 / field(&bytes, 8) as f64;
        position += seconds;
        if position <= start {
            continue;
        }
        let sequence = field(&bytes, 4);
        let sent_at = Instant::now();
        timeout(IO_TIMEOUT, socket.send(Message::Binary(bytes.into())))
            .await
            .map_err(|_| "Playback send timed out.")?
            .map_err(|e| e.to_string())?;
        timeout(IO_TIMEOUT, async {
            loop {
                match socket.recv().await {
                    Some(Ok(Message::Text(text))) if text == format!("ack:{sequence}") => {
                        return Ok(());
                    }
                    Some(Ok(Message::Text(text)))
                        if text.starts_with("ping:") && text.len() <= 64 =>
                    {
                        socket
                            .send(Message::Text(text))
                            .await
                            .map_err(|e| e.to_string())?;
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                        return Err("Playback disconnected.".to_string());
                    }
                    _ => {}
                }
            }
        })
        .await
        .map_err(|_| "Playback ACK timed out.")??;
        if reported_at.elapsed() >= Duration::from_millis(500) {
            timeout(
                IO_TIMEOUT,
                socket.send(Message::Text(format!("position:{position}").into())),
            )
            .await
            .map_err(|_| "Playback position timed out.")?
            .map_err(|e| e.to_string())?;
            reported_at = Instant::now();
        }
        // Replay every saved block; a slow FFT stretches playback instead of dropping data.
        tokio::time::sleep_until(sent_at + Duration::from_secs_f64(seconds.min(1.0))).await;
    }
    let _ = socket
        .send(Message::Text(format!("position:{position}").into()))
        .await;
    Ok(())
}
