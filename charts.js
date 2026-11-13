// رسوم بيانية SVG بدون مكتبات خارجية (لتعمل دون إنترنت). المدخلات أرقام وألوان ثابتة فقط.
import { formatAmount } from './money.js';

const compact = b => {
  const o = b / 1000;
  return o >= 1000 ? (o / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : (o >= 100 ? Math.round(o) : Math.round(o * 10) / 10).toString();
};

/** حلقة (Donut). segments: [{value, color}] */
export function donutSVG(segments, { size = 190, thickness = 24, centerTop = '', centerBottom = '' } = {}) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r, mid = size / 2;
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  let off = 0, arcs = '';
  if (total > 0) {
    for (const s of segments) {
      if (s.value <= 0) continue;
      const len = (s.value / total) * c;
      arcs += `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${Math.max(0, len - (segments.filter(x => x.value > 0).length > 1 ? 2 : 0))} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${mid} ${mid})"/>`;
      off += len;
    }
  }
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="رسم بياني دائري لتوزيع الراتب" class="donut">
    <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${thickness}"/>${arcs}
    <text x="${mid}" y="${mid - 2}" text-anchor="middle" class="d-top">${centerTop}</text>
    <text x="${mid}" y="${mid + 20}" text-anchor="middle" class="d-bot">${centerBottom}</text></svg>`;
}

/** أعمدة مكدسة. rows: [{label, parts:[{value,color}]}] — تُرتب زمنياً من اليسار لليمين. */
export function stackedBarsSVG(rows, { height = 170, highlight = -1 } = {}) {
  const W = 340, padB = 22, padT = 16, n = rows.length;
  if (!n) return '';
  const max = Math.max(1, ...rows.map(r => r.parts.reduce((a, p) => a + p.value, 0)));
  const slot = W / n, bw = Math.min(34, slot * 0.58), H = height - padB - padT;
  let g = `<line x1="0" x2="${W}" y1="${padT + H}" y2="${padT + H}" stroke="var(--line)"/>`;
  rows.forEach((r, i) => {
    const x = i * slot + (slot - bw) / 2;
    let y = padT + H;
    const total = r.parts.reduce((a, p) => a + p.value, 0);
    r.parts.forEach(p => {
      const hh = (p.value / max) * H;
      if (hh <= 0) return;
      y -= hh;
      g += `<rect x="${x}" y="${y}" width="${bw}" height="${hh}" fill="${p.color}" rx="3" ${i === highlight ? '' : 'opacity=".88"'}/>`;
    });
    g += `<text x="${x + bw / 2}" y="${Math.max(10, y - 4)}" text-anchor="middle" class="c-val">${total > 0 ? compact(total) : ''}</text>`;
    g += `<text x="${x + bw / 2}" y="${height - 6}" text-anchor="middle" class="c-lbl${i === highlight ? ' on' : ''}">${r.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${height}" class="chart" role="img" aria-label="مقارنة المصاريف بين الأشهر">${g}</svg>`;
}

/** خط زمني. points: [{label, value}] */
export function lineSVG(points, { height = 160, target = 0 } = {}) {
  const W = 340, padB = 22, padT = 18, padX = 14, n = points.length;
  if (!n) return '';
  const vals = points.map(p => p.value);
  const max = Math.max(1, target, ...vals), min = Math.min(0, ...vals);
  const H = height - padB - padT;
  const xs = i => (n === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1));
  const ys = v => padT + H - ((v - min) / (max - min || 1)) * H;
  let g = `<line x1="0" x2="${W}" y1="${padT + H}" y2="${padT + H}" stroke="var(--line)"/>`;
  if (target > 0) g += `<line x1="0" x2="${W}" y1="${ys(target)}" y2="${ys(target)}" stroke="var(--gold)" stroke-dasharray="4 4"/><text x="${W - 2}" y="${ys(target) - 4}" text-anchor="end" class="c-val">الهدف ${compact(target)}</text>`;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.value).toFixed(1)}`).join(' ');
  g += `<path d="${d}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  points.forEach((p, i) => {
    g += `<circle cx="${xs(i)}" cy="${ys(p.value)}" r="3.5" fill="var(--surface)" stroke="var(--brand)" stroke-width="2"/>`;
    if (n <= 6 || i === n - 1 || i === 0) g += `<text x="${xs(i)}" y="${ys(p.value) - 8}" text-anchor="middle" class="c-val">${compact(p.value)}</text>`;
    if (n <= 7 || i % 2 === (n - 1) % 2) g += `<text x="${xs(i)}" y="${height - 6}" text-anchor="middle" class="c-lbl">${p.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${height}" class="chart" role="img" aria-label="تطور رصيد صندوق الطوارئ">${g}</svg>`;
}
export { formatAmount };
