import { useEffect, useRef } from "react";
import { logFrequencies, profileMagnitudeDb } from "../shared/response";
import type { EqProfile } from "../shared/types";

const FREQS = logFrequencies(180);
const MIN_DB = -12;
const MAX_DB = 12;

function xFor(freq: number, width: number): number {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  return ((Math.log10(freq) - min) / (max - min)) * width;
}

function yFor(db: number, height: number): number {
  const t = (db - MAX_DB) / (MIN_DB - MAX_DB);
  return t * height;
}

export function EqGraph({
  profile,
  enabled,
  selectedId,
  onSelect,
}: {
  profile: EqProfile;
  enabled: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "#2a2d35";
    ctx.lineWidth = 1;
    for (const freq of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = xFor(freq, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (const db of [-12, -6, 0, 6, 12]) {
      const y = yFor(db, height);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const magnitudes = profileMagnitudeDb(profile, FREQS).map((db) =>
      enabled ? db : 0,
    );
    ctx.beginPath();
    magnitudes.forEach((db, i) => {
      const x = xFor(FREQS[i], width);
      const y = yFor(Math.min(MAX_DB, Math.max(MIN_DB, db)), height);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = enabled ? "#e8a54b" : "#6b675f";
    ctx.lineWidth = 2;
    ctx.stroke();

    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, enabled ? "rgba(232,165,75,0.28)" : "rgba(107,103,95,0.16)");
    fill.addColorStop(1, "rgba(16,17,20,0)");
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    for (const band of profile.bands) {
      const x = xFor(band.frequency, width);
      const y = yFor(
        Math.min(MAX_DB, Math.max(MIN_DB, enabled ? band.gain + profile.preamp : 0)),
        height,
      );
      ctx.beginPath();
      ctx.arc(x, y, band.id === selectedId ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = band.id === selectedId ? "#f3efe6" : "#e8a54b";
      ctx.fill();
    }
  }, [enabled, profile, selectedId]);

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    let nearest = profile.bands[0];
    let best = Number.POSITIVE_INFINITY;
    for (const band of profile.bands) {
      const x = xFor(band.frequency, rect.width);
      const dist = Math.abs(x - clickX);
      if (dist < best) {
        best = dist;
        nearest = band;
      }
    }
    onSelect(nearest.id);
  }

  return (
    <canvas
      ref={canvasRef}
      className="graph"
      onClick={handleClick}
      aria-label="EQ frequency response"
    />
  );
}
