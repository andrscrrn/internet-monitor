import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { ROOT_DIR } from '../src/config.js';
import { readSamplesInRange, readOutagesInRange, loadState } from '../src/store.js';
import { bucketSamples, summarize, dailyBreakdown } from '../src/aggregate.js';

function parseArgs() {
  const args = { days: 7, out: null };
  for (const arg of process.argv.slice(2)) {
    const m = /^--(\w+)=(.*)$/.exec(arg);
    if (!m) continue;
    if (m[1] === 'days') args.days = parseInt(m[2], 10);
    if (m[1] === 'out') args.out = m[2];
  }
  return args;
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  const date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const time = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

function fmtDate(key) {
  const [y, m, d] = key.split('-');
  return `${y}/${m}/${d}`;
}

function fmtDuration(ms) {
  if (!ms) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  if (!d && m) parts.push(`${m}m`);
  if (!d && !h && sec) parts.push(`${sec}s`);
  return parts.join(' ') || '0s';
}

const COLOR = { text: '#1a1a1a', muted: '#6b7280', up: '#3ecf6e', degraded: '#e8b339', down: '#ef4a4a', nodata: '#c7cad1', line: '#4f8cff', grid: '#e5e7eb', rowMild: '#fdf3d9', rowSevere: '#fbdfdf' };

function ensureSpace(doc, needed, margin) {
  const bottom = doc.page.height - margin;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

function drawSectionTitle(doc, text) {
  ensureSpace(doc, 30, doc.page.margins.bottom);
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor(COLOR.text).font('Helvetica-Bold').text(text);
  doc.moveDown(0.3);
  doc.font('Helvetica');
}

function drawSummaryCards(doc, items) {
  const margin = doc.page.margins.left;
  const usableWidth = doc.page.width - margin * 2;
  const cardW = usableWidth / items.length;
  const cardH = 50;
  ensureSpace(doc, cardH + 10, doc.page.margins.bottom);
  const y = doc.y;
  items.forEach((item, i) => {
    const x = margin + i * cardW;
    doc.fontSize(16).fillColor(COLOR.text).font('Helvetica-Bold').text(item.value, x, y, { width: cardW - 8 });
    doc.fontSize(8).fillColor(COLOR.muted).font('Helvetica').text(item.label, x, y + 20, { width: cardW - 8 });
  });
  doc.x = margin;
  doc.y = y + cardH;
}

function drawTable(doc, headers, rows, colWidths, rowColors) {
  const margin = doc.page.margins.left;
  const rowH = 18;
  const headerH = 20;

  function drawHeader() {
    const y = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLOR.muted);
    let x = margin;
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: colWidths[i] });
      x += colWidths[i];
    });
    doc.y = y + headerH;
    doc.moveTo(margin, doc.y).lineTo(margin + colWidths.reduce((a, b) => a + b, 0), doc.y).strokeColor(COLOR.grid).stroke();
    doc.moveDown(0.2);
  }

  ensureSpace(doc, headerH + rowH, doc.page.margins.bottom);
  drawHeader();

  doc.font('Helvetica').fontSize(9);
  rows.forEach((row, rowIndex) => {
    ensureSpace(doc, rowH, doc.page.margins.bottom);
    if (doc.y === doc.page.margins.top) drawHeader();
    const y = doc.y;
    const rowColor = rowColors?.[rowIndex];
    if (rowColor) {
      doc.rect(margin, y - 2, colWidths.reduce((a, b) => a + b, 0), rowH).fill(rowColor);
    }
    doc.fillColor(COLOR.text);
    let x = margin;
    row.forEach((cell, i) => {
      doc.text(String(cell), x, y, { width: colWidths[i] });
      x += colWidths[i];
    });
    doc.y = y + rowH;
  });
  doc.x = margin;
}

function drawTimelineBar(doc, points, width, height) {
  const margin = doc.page.margins.left;
  ensureSpace(doc, height + 10, doc.page.margins.bottom);
  const y = doc.y;
  if (!points.length) {
    doc.fontSize(9).fillColor(COLOR.muted).text('Sin datos', margin, y);
    doc.y = y + height;
    return;
  }
  const bw = width / points.length;
  points.forEach((p, i) => {
    doc.rect(margin + i * bw, y, Math.ceil(bw), height).fill(COLOR[p.status] || '#999');
  });
  doc.y = y + height + 6;
}

function drawLineChart(doc, points, width, height, key, color, unit) {
  const margin = doc.page.margins.left;
  ensureSpace(doc, height + 20, doc.page.margins.bottom);
  const top = doc.y;
  const values = points.map((p) => p[key]).filter((v) => v != null);
  const max = Math.max(...(values.length ? values : [1]), unit === '%' ? 10 : 50);

  doc.strokeColor(COLOR.grid).lineWidth(0.5);
  for (let i = 0; i <= 3; i++) {
    const y = top + (height * i) / 3;
    doc.moveTo(margin, y).lineTo(margin + width, y).stroke();
  }
  doc.fontSize(7).fillColor(COLOR.muted).text(Math.round(max) + unit, margin, top - 9);

  if (values.length) {
    doc.strokeColor(color).lineWidth(1.2);
    let started = false;
    points.forEach((p, i) => {
      const x = margin + (i / (points.length - 1 || 1)) * width;
      const v = p[key];
      if (v == null) { started = false; return; }
      const y = top + height - (v / max) * height;
      if (!started) { doc.moveTo(x, y); started = true; } else { doc.lineTo(x, y); }
    });
    doc.stroke();
  } else {
    doc.fontSize(9).fillColor(COLOR.muted).text('Sin datos', margin, top + height / 2);
  }
  doc.y = top + height + 10;
}

async function main() {
  const { days, out } = parseArgs();
  const now = Date.now();
  const start = now - days * 24 * 60 * 60 * 1000;

  const samples = readSamplesInRange(start, now);
  const outages = readOutagesInRange(start, now);
  const state = loadState();
  if (state.ongoingOutageStart && state.ongoingOutageStart >= start) {
    outages.push({ start: state.ongoingOutageStart, end: now, durationMs: now - state.ongoingOutageStart, ongoing: true });
  }
  outages.sort((a, b) => a.start - b.start);

  const summary = summarize(samples, outages, start, now);
  const byDay = dailyBreakdown(samples, outages, start, now);
  const bucketSizeMs = days <= 1 ? 60_000 : 60 * 60 * 1000;
  const chartPoints = bucketSamples(samples, bucketSizeMs, start, now);

  const outDir = path.join(ROOT_DIR, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = out || path.join(outDir, `reporte-internet-${new Date(now).toISOString().slice(0, 10)}.pdf`);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(fs.createWriteStream(outPath));

  doc.fontSize(18).font('Helvetica-Bold').fillColor(COLOR.text).text('Reporte de Conexion a Internet');
  doc.fontSize(10).font('Helvetica').fillColor(COLOR.muted)
    .text(`Periodo: ${fmtDateTime(start)} - ${fmtDateTime(now)}`)
    .text(`Generado: ${fmtDateTime(now)}`);
  doc.moveDown(1);

  drawSectionTitle(doc, 'Resumen');
  drawSummaryCards(doc, [
    { label: 'Uptime', value: summary.uptimePct != null ? summary.uptimePct + '%' : '--' },
    { label: 'Latencia promedio', value: summary.avgLatency != null ? summary.avgLatency + ' ms' : '--' },
    { label: 'Perdida de paquetes', value: (summary.avgLoss ?? 0) + '%' },
    { label: 'Caidas registradas', value: String(summary.outageCount) },
    {
      label: 'Frecuencia de caidas',
      value: summary.avgOutageIntervalMs != null ? `1 cada ${fmtDuration(summary.avgOutageIntervalMs)}` : 'Sin caidas',
    },
    { label: 'Tiempo caido total', value: fmtDuration(summary.totalDowntimeMs) },
    { label: 'Sin monitorear', value: fmtDuration(summary.noDataMs) },
  ]);
  if (summary.noDataMs > 0) {
    doc.fontSize(8).fillColor(COLOR.muted).text(
      '"Sin monitorear" son periodos en que el equipo estaba dormido/apagado y no se pudo verificar la conexion (no cuenta como caida ni como conexion buena).'
    );
    doc.moveDown(0.3);
  }

  drawSectionTitle(doc, 'Estado a lo largo del periodo');
  doc.fontSize(8).fillColor(COLOR.muted)
    .text('Verde = conectado   Amarillo = degradado   Rojo = caido   Gris = sin datos (equipo dormido/apagado)');
  doc.moveDown(0.3);
  drawTimelineBar(doc, chartPoints, doc.page.width - doc.page.margins.left * 2, 18);

  drawSectionTitle(doc, 'Latencia (ms)');
  drawLineChart(doc, chartPoints, doc.page.width - doc.page.margins.left * 2, 90, 'avgMs', COLOR.line, 'ms');

  drawSectionTitle(doc, 'Resumen por dia');
  drawTable(
    doc,
    ['Fecha', 'Uptime', 'Latencia prom.', 'Perdida', 'Caidas', 'Tiempo caido', 'Sin datos'],
    byDay.map((d) => [
      fmtDate(d.key),
      d.uptimePct != null ? d.uptimePct + '%' : '--',
      d.avgLatency != null ? d.avgLatency + ' ms' : '--',
      (d.avgLoss ?? 0) + '%',
      d.outageCount,
      fmtDuration(d.totalDowntimeMs),
      fmtDuration(d.noDataMs),
    ]),
    [75, 55, 80, 50, 45, 85, 80]
  );

  drawSectionTitle(doc, `Detalle de caidas (${outages.length})`);
  if (outages.length) {
    drawTable(
      doc,
      ['Inicio', 'Fin', 'Duracion'],
      outages.map((o) => [fmtDateTime(o.start), o.ongoing ? 'en curso' : fmtDateTime(o.end), fmtDuration(o.durationMs)]),
      [180, 180, 100],
      outages.map((o) => (o.durationMs > 5000 ? COLOR.rowSevere : o.durationMs > 1000 ? COLOR.rowMild : null))
    );
  } else {
    doc.fontSize(10).fillColor(COLOR.muted).text('No se registraron caidas en este periodo.');
  }

  doc.end();
  await new Promise((resolve) => doc.on('end', resolve));
  console.log(`Reporte generado: ${outPath}`);
}

main();
