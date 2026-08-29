'use strict';
// 轻量 Canvas 图表，无第三方依赖
const Charts = (function () {
  const PALETTE = ['#8b4513', '#b5541f', '#7a7163', '#2e6b3f', '#b8860b', '#6b3410', '#9a7b4f', '#7f6734', '#a0522d', '#4a6741'];

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function barChart(canvas, items) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!items.length) {
      ctx.fillStyle = '#9ca3af'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无数据', w / 2, h / 2);
      return { items: [] };
    }
    const padL = 30, padR = 10, padT = 14, padB = 30;
    const max = Math.max(...items.map(i => i.value), 1);
    const chartW = w - padL - padR, chartH = h - padT - padB;
    const slot = chartW / items.length;
    const barW = Math.min(44, slot * 0.6);
    ctx.textAlign = 'center';
    items.forEach((it, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const bh = (it.value / max) * chartH;
      const y = padT + chartH - bh;
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.beginPath();
      if (bh > 0) { ctx.roundRect(x, y, barW, bh, 4); ctx.fill(); }
      ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif';
      ctx.fillText(String(it.value), x + barW / 2, padT + chartH - bh - 5);
      ctx.fillStyle = '#6b7280';
      if (it.label) {
        const short = it.label.length > 8 ? it.label.slice(0, 8) + '…' : it.label;
        ctx.fillText(short, x + barW / 2, h - 10);
      }
    });
    return { items: items.map((i, idx) => ({ ...i, color: PALETTE[idx % PALETTE.length] })) };
  }

  function pieChart(canvas, items) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!items.length) {
      ctx.fillStyle = '#9ca3af'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无数据', w / 2, h / 2);
      return { items: [] };
    }
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8;
    let start = -Math.PI / 2;
    items.forEach((it, i) => {
      const angle = (it.value / total) * 2 * Math.PI;
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fill();
      start += angle;
    });
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#374151'; ctx.textAlign = 'center'; ctx.font = '14px sans-serif';
    ctx.fillText(String(total), cx, cy - 2);
    ctx.fillStyle = '#6b7280'; ctx.font = '11px sans-serif';
    ctx.fillText('总票数', cx, cy + 14);
    return { items: items.map((i, idx) => ({ ...i, color: PALETTE[idx % PALETTE.length] })) };
  }

  return { barChart, pieChart, palette: PALETTE };
})();