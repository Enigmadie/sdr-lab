use std::{net::SocketAddr, time::Duration};

use axum::{
    Json, Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Query, State},
    response::IntoResponse,
    routing::{get, put},
};
use futures_util::SinkExt;
use serde::{Deserialize, Serialize};
use tokio::time::{Instant, MissedTickBehavior, interval, timeout};
use tower_http::services::{ServeDir, ServeFile};

const SAMPLE_RATE: u32 = 48_000;
const BLOCK_SIZE: usize = 2048;
const STREAM_TIMEOUT: Duration = Duration::from_secs(2);

mod live;
mod receiver;
mod synthetic;
use receiver::{AppState, ReceiverSettings};

#[derive(Serialize)]
struct Status {
    source: &'static str,
    sample_rate: u32,
    block_size: usize,
    protocol: &'static str,
    settings: ReceiverSettings,
    device_busy: bool,
}

async fn status(State(state): State<AppState>) -> Json<Status> {
    let settings = *state.settings.borrow();
    Json(Status {
        source: if state.live { "rtlsdr" } else { "synthetic" },
        sample_rate: if state.live {
            settings.sample_rate
        } else {
            SAMPLE_RATE
        },
        block_size: if state.live {
            receiver::CAPTURE_SAMPLES
        } else {
            BLOCK_SIZE
        },
        protocol: if state.live { "IQ02" } else { "IQ01" },
        settings,
        device_busy: state.owner.lock().expect("device ownership lock").is_some(),
    })
}

#[derive(Deserialize)]
struct StreamQuery {
    owner_id: Option<String>,
}

async fn iq(
    State(state): State<AppState>,
    Query(query): Query<StreamQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if state.live {
            if let Some(owner_id) = query
                .owner_id
                .filter(|id| id.len() >= 16 && id.len() <= 128)
            {
                live::stream(socket, state, owner_id).await;
            } else {
                let mut socket = socket;
                let _ = socket
                    .send(Message::Text(
                        "error:A browser session ID is required for RTL-SDR capture.".into(),
                    ))
                    .await;
            }
        } else {
            stream_synthetic(socket).await;
        }
    })
}

async fn stream_synthetic(mut socket: WebSocket) {
    let block_duration = Duration::from_secs_f64(BLOCK_SIZE as f64 / SAMPLE_RATE as f64);
    let started_at = Instant::now();
    let mut tick = interval(block_duration);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut next_block = 0u64;
    let mut source = synthetic::SyntheticSource::new(SAMPLE_RATE);
    let mut pending: Option<(u32, Instant)> = None;
    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(Message::Text(text))) => {
                        if let Some(acknowledged) = text.strip_prefix("ack:").and_then(|value| value.parse::<u32>().ok()) {
                            if pending.is_some_and(|(sequence, _)| sequence == acknowledged) {
                                pending = None;
                            }
                        } else if text.starts_with("ping:") && text.len() <= 64
                            && !matches!(timeout(STREAM_TIMEOUT, socket.send(Message::Text(text))).await, Ok(Ok(()))) {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            _ = tick.tick() => {
                if pending.is_some_and(|(_, sent_at)| sent_at.elapsed() >= STREAM_TIMEOUT) {
                    break;
                }
                let current_block = (started_at.elapsed().as_nanos() / block_duration.as_nanos()) as u64;
                // Timer stalls are gaps too; never replay old timer ticks in a burst.
                if current_block > next_block {
                    source.skip_samples(((current_block - next_block) as usize) * BLOCK_SIZE);
                    next_block = current_block;
                }
                let samples = source.next_block(BLOCK_SIZE);
                let current_sequence = next_block as u32;
                next_block += 1;
                if pending.is_some() {
                    continue;
                }
                let bytes = sdr_protocol::encode_iq(current_sequence, SAMPLE_RATE, &samples);
                // A stalled client is disconnected instead of accumulating a backlog.
                if !matches!(timeout(STREAM_TIMEOUT, socket.send(Message::Binary(bytes.into()))).await, Ok(Ok(()))) {
                    break;
                }
                pending = Some((current_sequence, Instant::now()));
            }
        }
    }
    let _ = timeout(STREAM_TIMEOUT, socket.close()).await;
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = std::env::var("SDR_BIND")
        .unwrap_or_else(|_| "127.0.0.1:3000".into())
        .parse()?;
    let web_dir = std::env::var("SDR_WEB_DIR").unwrap_or_else(|_| "apps/web/dist".into());
    let app = Router::new()
        .route("/api/receiver", put(receiver::tune))
        .route("/api/status", get(status))
        .route("/api/iq", get(iq))
        .fallback_service(
            ServeDir::new(&web_dir)
                .not_found_service(ServeFile::new(format!("{web_dir}/index.html"))),
        )
        .with_state(AppState::from_env()?);
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("SDR Lab server: http://{address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
