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
        .route("/health", get(health))
        .route("/v1/eq/recommend", post(recommend_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Universal EQ API listening on http://{addr}");
    tracing::info!("POST /v1/eq/recommend  GET /health");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind API port");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("API server failed");
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
    if response.profile.bands.len() != 8 {
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
