use std::{net::SocketAddr, time::Duration};

use axum::{
    Json, Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use serde::Serialize;
use tokio::time::{MissedTickBehavior, interval, timeout};
use tower_http::services::{ServeDir, ServeFile};

const SAMPLE_RATE: u32 = 48_000;
const BLOCK_SIZE: usize = 2048;

mod synthetic;

#[derive(Serialize)]
struct Status {
    source: &'static str,
    sample_rate: u32,
    block_size: usize,
    protocol: &'static str,
}

async fn status() -> Json<Status> {
    Json(Status {
        source: "synthetic",
        sample_rate: SAMPLE_RATE,
        block_size: BLOCK_SIZE,
        protocol: "IQ01",
    })
}

async fn iq(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(stream_synthetic)
}

async fn stream_synthetic(mut socket: WebSocket) {
    let mut tick = interval(Duration::from_secs_f64(
        BLOCK_SIZE as f64 / SAMPLE_RATE as f64,
    ));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut sequence = 0u32;
    let mut source = synthetic::SyntheticSource::new(SAMPLE_RATE);
    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            _ = tick.tick() => {
                let samples = source.next_block(BLOCK_SIZE);
                let bytes = sdr_protocol::encode_iq(sequence, SAMPLE_RATE, &samples);
                sequence = sequence.wrapping_add(1);
                // A stalled client is disconnected instead of accumulating a backlog.
                if !matches!(timeout(Duration::from_secs(2), socket.send(Message::Binary(bytes.into()))).await, Ok(Ok(()))) {
                    break;
                }
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = std::env::var("SDR_BIND")
        .unwrap_or_else(|_| "127.0.0.1:3000".into())
        .parse()?;
    let web_dir = std::env::var("SDR_WEB_DIR").unwrap_or_else(|_| "apps/web/dist".into());
    let app = Router::new()
        .route("/api/status", get(status))
        .route("/api/iq", get(iq))
        .fallback_service(
            ServeDir::new(&web_dir)
                .not_found_service(ServeFile::new(format!("{web_dir}/index.html"))),
        );
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("SDR Lab synthetic server: http://{address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
