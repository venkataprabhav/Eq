use std::net::SocketAddr;
use std::time::Instant;

use axum::http::{header, Method, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
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
        .route("/v1/eq/recommend", post(recommend_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind API port");
    tracing::info!("Universal EQ API listening on http://{addr}");
    tracing::info!("GET /  GET /health  POST /v1/eq/recommend");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("API server failed");
}

async fn index() -> axum::response::Html<&'static str> {
    axum::response::Html(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Universal EQ API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; padding: 0 1rem; color: #222; }
    code { background: #f3f3f3; padding: 0.1rem 0.35rem; }
    .ok { color: #0a7a32; }
  </style>
</head>
<body>
  <p class="ok">Backend is running.</p>
  <h1>Universal EQ API</h1>
  <p>This server is <strong>HTTP only</strong>. Use <code>http://127.0.0.1:8787</code>, not <code>https://</code>.</p>
  <p>If Chrome shows <code>ERR_SSL_PROTOCOL_ERROR</code>, it forced HTTPS. Turn off <em>Always use secure connections</em> or keep the <code>http://</code> prefix.</p>
  <ul>
    <li><a href="/health">GET /health</a></li>
    <li>POST /v1/eq/recommend — used by the Chrome extension Auto button</li>
  </ul>
</body>
</html>"#,
    )
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "service": "universal-eq-api",
        "engine": "universal-eq-rust/0.1",
    }))
}

async fn recommend_handler(
    Json(request): Json<RecommendRequest>,
) -> Result<Json<RecommendResponse>, (StatusCode, String)> {
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
