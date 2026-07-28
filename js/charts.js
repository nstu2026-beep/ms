// ==========================================================================
// Minimal canvas chart renderer — no external chart library required.
// Handles the small set of chart types Study Mission needs: bar and line.
// ==========================================================================

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: rect.height };
}

function readCssColor(varName, fallback) {
  const v = getComputedStyle(document.body).getPropertyValue(varName).trim();
  return v || fallback;
}

export function drawBarChart(canvas, labels, values, opts = {}) {
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = { top: 12, right: 8, bottom: 24, left: 8 };
  const max = Math.max(1, ...values, opts.max || 0);
  const barW = (w - pad.left - pad.right) / values.length * 0.6;
  const gap = (w - pad.left - pad.right) / values.length;
  const accent = readCssColor("--indigo", "#4C5FD5");
  const accent2 = readCssColor("--teal", "#2DD4BF");
  const muted = readCssColor("--text-muted", "#8A93B0");

  values.forEach((v, i) => {
    const barH = ((h - pad.top - pad.bottom) * v) / max;
    const x = pad.left + i * gap + (gap - barW) / 2;
    const y = h - pad.bottom - barH;
    const grad = ctx.createLinearGradient(0, y, 0, h - pad.bottom);
    grad.addColorStop(0, accent2);
    grad.addColorStop(1, accent);
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, barW, Math.max(barH, 2), 5);
    ctx.fill();

    ctx.fillStyle = muted;
    ctx.font = "10.5px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(labels[i] ?? "", x + barW / 2, h - 8);
  });
}

export function drawLineChart(canvas, labels, values, opts = {}) {
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = { top: 14, right: 10, bottom: 24, left: 10 };
  const max = Math.max(1, ...values, opts.max || 0);
  const accent = readCssColor("--gold", "#E8A33D");
  const muted = readCssColor("--text-muted", "#8A93B0");
  const stepX = (w - pad.left - pad.right) / Math.max(1, values.length - 1);

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad.left + i * stepX;
    const y = h - pad.bottom - ((h - pad.top - pad.bottom) * v) / max;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Fill under the line
  const last = pad.left + (values.length - 1) * stepX;
  ctx.lineTo(last, h - pad.bottom);
  ctx.lineTo(pad.left, h - pad.bottom);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(232,163,61,0.25)");
  grad.addColorStop(1, "rgba(232,163,61,0.0)");
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = muted;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  labels.forEach((l, i) => {
    if (labels.length > 10 && i % Math.ceil(labels.length / 6) !== 0) return;
    ctx.fillText(l, pad.left + i * stepX, h - 8);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
