use axum::extract::ws::{Message, WebSocket};
use futures_util::SinkExt;
use tokio::{
    io::AsyncReadExt,
    time::{Duration, Instant, interval, timeout},
};

use crate::receiver::{AppState, CAPTURE_SAMPLES, Capture};

const STREAM_TIMEOUT: Duration = Duration::from_secs(2);

async fn error(socket: &mut WebSocket, detail: &str) {
    let _ = timeout(
        STREAM_TIMEOUT,
        socket.send(Message::Text(format!("error:{detail}").into())),
    )
    .await;
}

pub async fn stream(mut socket: WebSocket, state: AppState, owner_id: String) {
    let mut recorder = None;
    let _lease = match state.claim(owner_id) {
        Ok(lease) => lease,
        Err(detail) => {
            error(&mut socket, detail).await;
            return;
        }
    };
    let mut updates = state.settings.subscribe();
    let mut settings = *updates.borrow_and_update();
    let mut capture = match Capture::start(&state, settings) {
        Ok(capture) => capture,
        Err(_) => {
            error(&mut socket, "Unable to start rtl_sdr. Install the V4-compatible rtl-sdr package and check USB permissions.").await;
            return;
        }
    };
    let mut buffer = vec![0u8; CAPTURE_SAMPLES * 2];
    let mut filled = 0;
    let mut sequence = 0u32;
    let mut pending: Option<(u32, Instant)> = None;
    let mut last_capture = Instant::now();
    let mut watchdog = interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if text.starts_with("record") {
                            if let Err(detail) = crate::recordings::control(&text, &state, &mut recorder, settings).await {
                                let _ = socket.send(Message::Text(format!("record-error:{detail}").into())).await;
                            }
                            continue;
                        }
                        if let Some(ack) = text.strip_prefix("ack:").and_then(|value| value.parse::<u32>().ok()) {
                            if pending.is_some_and(|(sequence, _)| sequence == ack) { pending = None; }
                        } else if text.starts_with("ping:") && text.len() <= 64
                            && !matches!(timeout(STREAM_TIMEOUT, socket.send(Message::Text(text))).await, Ok(Ok(()))) { break; }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            result = capture.stdout.read(&mut buffer[filled..]) => {
                match result {
                    Ok(0) | Err(_) => { error(&mut socket, "RTL-SDR capture stopped. The dongle may be busy, disconnected or inaccessible; check server logs.").await; break; }
                    Ok(count) => { filled += count; last_capture = Instant::now(); }
                }
                if filled == buffer.len() {
                    let current_sequence = sequence;
                    sequence = sequence.wrapping_add(1);
                    filled = 0;
                    let bytes = sdr_protocol::encode_rtl_iq(current_sequence, settings.sample_rate, settings.center_hz, &buffer);
                    if let Some(recording) = recorder.as_mut() { recording.offer(&bytes); }
                    if pending.is_none() {
                        if !matches!(timeout(STREAM_TIMEOUT, socket.send(Message::Binary(bytes.into()))).await, Ok(Ok(()))) { break; }
                        pending = Some((current_sequence, Instant::now()));
                    }
                }
            }
            result = updates.changed() => {
                if result.is_err() { break; }
                if let Some(recording) = recorder.take() { recording.finish("Stopped at receiver retune boundary.").await; }
                settings = *updates.borrow_and_update();
                capture.stop().await;
                capture = match Capture::start(&state, settings) {
                    Ok(capture) => capture,
                    Err(_) => { error(&mut socket, "Unable to restart RTL-SDR capture with the requested settings.").await; break; }
                };
                filled = 0;
                // Never join samples from opposite sides of a retune.
                sequence = sequence.wrapping_add(1);
                last_capture = Instant::now();
            }
            _ = watchdog.tick() => {
                if pending.is_some_and(|(_, sent_at)| sent_at.elapsed() >= STREAM_TIMEOUT) { break; }
                if last_capture.elapsed() >= Duration::from_secs(5) {
                    error(&mut socket, "RTL-SDR produced no samples for five seconds.").await; break;
                }
            }
        }
    }
    capture.stop().await;
    if let Some(recording) = recorder {
        recording.finish("Capture disconnected.").await;
    }
    let _ = timeout(STREAM_TIMEOUT, socket.close()).await;
}
