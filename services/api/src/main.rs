use std::net::SocketAddr;
use std::time::Instant;

use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use device_manager::{list_output_devices_cached, DeviceInventory};
use dsp::recommend;
use eq_core::{RecommendRequest, RecommendResponse};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let port: u16 = std::env::var("UNIVERSAL_EQ_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8787);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    let app = Router::new()
        .route("/", get(index))
        .route("/health", get(health))
        .route("/v1/devices", get(devices_handler))
        .route("/v1/eq/recommend", post(recommend_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind API port");
    tracing::info!("Universal EQ API listening on http://{addr}");
    tracing::info!("GET /  GET /health  GET /v1/devices  POST /v1/eq/recommend");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("API server failed");
}

const STATUS_PAGE: &str = r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Universally Equalizing</title>
  <style>
    :root { color-scheme: dark; }
    html, body { height: 100%; margin: 0; }
    body {
      min-height: 100%;
      display: grid;
      place-items: center;
      background: #0b0c0f;
      color: #f3efe6;
      font-family: "Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    }
    .mark { text-align: center; padding: 2rem; }
    h1 {
      margin: 0;
      font-size: clamp(2.1rem, 6vw, 3.6rem);
      font-weight: 600;
      letter-spacing: -0.04em;
      color: #c4a574;
    }
    p {
      margin: 0.85rem 0 0;
      color: #8a857c;
      font-size: 0.95rem;
    }
  </style>
</head>
<body>
  <div class="mark">
    <h1>Universally Equalizing</h1>
    <p>Universal EQ is running</p>
  </div>
</body>
</html>"#;

fn wants_html(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/html"))
}

async fn index() -> axum::response::Html<&'static str> {
    axum::response::Html(STATUS_PAGE)
}

async fn health(headers: HeaderMap) -> impl IntoResponse {
    if wants_html(&headers) {
        return axum::response::Html(STATUS_PAGE).into_response();
    }
    Json(serde_json::json!({
        "ok": true,
        "service": "universal-eq-api",
        "engine": "universal-eq-rust/0.1",
        "message": "Universally Equalizing",
    }))
    .into_response()
}

async fn devices_handler() -> Json<DeviceInventory> {
    let inventory = tokio::task::spawn_blocking(list_output_devices_cached)
        .await
        .unwrap_or_else(|_| DeviceInventory::empty());
    Json(inventory)
}

async fn recommend_handler(
    Json(mut request): Json<RecommendRequest>,
) -> Result<Json<RecommendResponse>, (StatusCode, String)> {
    if request.device.is_none() {
        let inventory = tokio::task::spawn_blocking(list_output_devices_cached)
            .await
            .unwrap_or_else(|_| DeviceInventory::empty());
        request.device = inventory.hint();
    }
    let started = Instant::now();
    let mut response = recommend(&request);
    response.latency_ms = started.elapsed().as_millis() as u64;

    if response.latency_ms > 500 {
        tracing::warn!(
            latency_ms = response.latency_ms,
            "recommend exceeded 500ms budget"
        );
    } else {
        tracing::info!(
            latency_ms = response.latency_ms,
            track = %response.track_key,
            device = %request
                .device
                .as_ref()
                .map(|device| device.name.as_str())
                .unwrap_or("unknown"),
            "recommend ok"
        );
    }

    // Cheap sanity check so the extension always gets a usable profile.
    if response.profile.bands.len() != eq_core::BAND_COUNT {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid EQ profile band count".into(),
        ));
    }

    Ok(Json(response))
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down Universal EQ API");
}
