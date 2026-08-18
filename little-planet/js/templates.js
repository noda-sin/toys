/* =========================================================
 * templates.js
 * ぬりえテンプレート(輪郭シルエット・飾り線)と
 * 印刷用シート(A4 / 四隅マーカー付き)の定義
 * ========================================================= */

"use strict";

/* --- シート座標系 (A4縦 比率 1:1.414) --- */
const SHEET_W = 1000;
const SHEET_H = 1414;
const MARKER_SIZE = 110;   // 四隅の黒い正方形マーカー
const MARKER_MARGIN = 55;

/* マーカー中心座標 [TL, TR, BR, BL] */
const SHEET_MARKERS = (() => {
  const c = MARKER_MARGIN + MARKER_SIZE / 2;           // 110
  const r = SHEET_W - c;                               // 890
  const b = SHEET_H - c;                               // 1304
  return [ {x: c, y: c}, {x: r, y: c}, {x: r, y: b}, {x: c, y: b} ];
})();

/* 絵を描くエリア(この中にテンプレート輪郭を配置する) */
const DRAW_AREA = { x: 130, y: 330, w: 740, h: 760 };

/* ---------------------------------------------------------
 * 各テンプレート
 *   box    : シルエット定義座標系のサイズ
 *   facing : シルエットが向いている方向 ('left' | 'right')
 *   habitat: 'sea' | 'sky' | 'land'
 *   path() : 外周シルエット (マスク・輪郭線に使用)
 *   decor(): 目や窓などの飾り線 (印刷・画面おえかき用)
 * --------------------------------------------------------- */

function fishPath() {
  const p = new Path2D();
  p.moveTo(60, 250);
  p.bezierCurveTo(120, 90, 320, 50, 460, 110);
  p.bezierCurveTo(540, 145, 600, 190, 640, 220);
  p.lineTo(760, 80);
  p.quadraticCurveTo(800, 250, 760, 420);
  p.lineTo(640, 280);
  p.bezierCurveTo(600, 310, 540, 355, 460, 390);
  p.bezierCurveTo(320, 450, 120, 410, 60, 250);
  p.closePath();
  return p;
}

function fishDecor(ctx) {
  // 目
  ctx.beginPath();
  ctx.arc(170, 215, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(176, 215, 7, 0, Math.PI * 2);
  ctx.fill();
  // えら
  ctx.beginPath();
  ctx.moveTo(250, 140);
  ctx.quadraticCurveTo(300, 250, 250, 360);
  ctx.stroke();
  // ひれ
  ctx.beginPath();
  ctx.moveTo(380, 200);
  ctx.quadraticCurveTo(470, 230, 400, 300);
  ctx.quadraticCurveTo(350, 260, 380, 200);
  ctx.stroke();
}

function birdPath() {
  const p = new Path2D();
  p.moveTo(690, 300);                                  // くちばしの先
  p.lineTo(600, 255);
  p.bezierCurveTo(590, 170, 500, 140, 440, 175);       // 頭
  p.bezierCurveTo(400, 60, 250, 30, 140, 90);          // 翼の上側
  p.bezierCurveTo(230, 140, 300, 180, 340, 210);       // 翼の下側
  p.bezierCurveTo(250, 230, 150, 240, 60, 300);        // 背中〜しっぽ上
  p.lineTo(120, 340);                                  // しっぽの切れ込み
  p.lineTo(60, 390);                                   // しっぽ下
  p.bezierCurveTo(200, 420, 380, 430, 500, 380);       // おなか
  p.bezierCurveTo(580, 350, 640, 330, 690, 300);
  p.closePath();
  return p;
}

function birdDecor(ctx) {
  // 目
  ctx.beginPath();
  ctx.arc(540, 220, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(545, 220, 6, 0, Math.PI * 2);
  ctx.fill();
  // くちばしの線
  ctx.beginPath();
  ctx.moveTo(600, 255);
  ctx.lineTo(660, 290);
  ctx.stroke();
  // 羽の線
  ctx.beginPath();
  ctx.moveTo(320, 150);
  ctx.quadraticCurveTo(260, 120, 190, 110);
  ctx.stroke();
}

function carPath() {
  const p = new Path2D();
  p.moveTo(60, 340);
  p.quadraticCurveTo(30, 340, 30, 295);
  p.quadraticCurveTo(30, 245, 95, 238);
  p.quadraticCurveTo(135, 160, 235, 152);              // フロントガラス
  p.lineTo(480, 152);                                  // 屋根
  p.quadraticCurveTo(590, 160, 645, 238);              // リア
  p.quadraticCurveTo(770, 245, 770, 295);
  p.quadraticCurveTo(770, 340, 740, 340);
  p.lineTo(660, 340);
  p.arc(590, 340, 70, 0, Math.PI, false);              // 後輪 (下ぶくれ)
  p.lineTo(280, 340);
  p.arc(210, 340, 70, 0, Math.PI, false);              // 前輪
  p.closePath();
  return p;
}

function carDecor(ctx) {
  // 窓
  ctx.beginPath();
  ctx.moveTo(250, 175);
  ctx.lineTo(345, 175);
  ctx.lineTo(345, 240);
  ctx.lineTo(175, 240);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(375, 175);
  ctx.lineTo(470, 175);
  ctx.lineTo(540, 240);
  ctx.lineTo(375, 240);
  ctx.closePath();
  ctx.stroke();
  // タイヤ
  ctx.beginPath();
  ctx.arc(210, 340, 42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(590, 340, 42, 0, Math.PI * 2);
  ctx.stroke();
}

const TEMPLATES = {
  fish: {
    id: "fish", name: "さかな", emoji: "🐟",
    habitat: "sea", facing: "left",
    box: { w: 800, h: 470 },
    path: fishPath, decor: fishDecor,
  },
  bird: {
    id: "bird", name: "とり", emoji: "🐦",
    habitat: "sky", facing: "right",
    box: { w: 740, h: 450 },
    path: birdPath, decor: birdDecor,
  },
  car: {
    id: "car", name: "くるま", emoji: "🚗",
    habitat: "land", facing: "left",
    box: { w: 800, h: 420 },
    path: carPath, decor: carDecor,
  },
};

const TEMPLATE_IDS = Object.keys(TEMPLATES);

/* テンプレートを DRAW_AREA の中央に収める配置 (シート座標系) */
function getPlacement(t) {
  const scale = Math.min(DRAW_AREA.w / t.box.w, DRAW_AREA.h / t.box.h) * 0.95;
  const ox = DRAW_AREA.x + (DRAW_AREA.w - t.box.w * scale) / 2;
  const oy = DRAW_AREA.y + (DRAW_AREA.h - t.box.h * scale) / 2;
  return { scale, ox, oy };
}

/* ---------------------------------------------------------
 * 印刷用シートを canvas に描画する
 *   res: 解像度倍率 (印刷は 2 推奨)
 * --------------------------------------------------------- */
function renderSheet(canvas, t, res = 2) {
  canvas.width = SHEET_W * res;
  canvas.height = SHEET_H * res;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(res, 0, 0, res, 0, 0);

  // 背景
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);

  // 四隅マーカー
  ctx.fillStyle = "#000000";
  for (const m of SHEET_MARKERS) {
    ctx.fillRect(m.x - MARKER_SIZE / 2, m.y - MARKER_SIZE / 2, MARKER_SIZE, MARKER_SIZE);
  }

  // タイトル・説明
  ctx.fillStyle = "#333333";
  ctx.textAlign = "center";
  ctx.font = 'bold 46px "Hiragino Maru Gothic ProN", "BIZ UDGothic", sans-serif';
  ctx.fillText("🪐 おえかきプラネット", SHEET_W / 2, 130);
  ctx.font = 'bold 38px "Hiragino Maru Gothic ProN", "BIZ UDGothic", sans-serif';
  ctx.fillText(`〜 ${t.name} 〜`, SHEET_W / 2, 195);
  ctx.font = '28px "Hiragino Maru Gothic ProN", "BIZ UDGothic", sans-serif';
  ctx.fillStyle = "#777777";
  ctx.fillText("くろい わくの なかに じゆうに いろを ぬってね!", SHEET_W / 2, 255);
  ctx.fillText("かきおわったら アプリで スキャンしよう (すみの ■ は ぬらないでね)", SHEET_W / 2, SHEET_H - 240);

  // 描画エリアのガイド枠
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  roundRectPath(ctx, DRAW_AREA.x - 20, DRAW_AREA.y - 20, DRAW_AREA.w + 40, DRAW_AREA.h + 40, 24);
  ctx.stroke();
  ctx.setLineDash([]);

  // テンプレート輪郭
  const pl = getPlacement(t);
  ctx.save();
  ctx.translate(pl.ox, pl.oy);
  ctx.scale(pl.scale, pl.scale);
  const path = t.path();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 9 / pl.scale;
  ctx.lineJoin = "round";
  ctx.stroke(path);
  ctx.lineWidth = 5 / pl.scale;
  ctx.fillStyle = "#000000";
  t.decor(ctx);
  ctx.restore();

  return canvas;
}

/* サムネイル (輪郭のみの小さいプレビュー) */
function renderThumb(canvas, t, size = 150) {
  const ratio = t.box.h / t.box.w;
  canvas.width = size;
  canvas.height = Math.round(size * ratio);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = (size * 0.9) / t.box.w;
  ctx.save();
  ctx.translate(size * 0.05, canvas.height * 0.05);
  ctx.scale(s, s);
  ctx.strokeStyle = "#333333";
  ctx.lineWidth = 8 / s;
  ctx.lineJoin = "round";
  ctx.stroke(t.path());
  ctx.lineWidth = 4 / s;
  ctx.fillStyle = "#333333";
  t.decor(ctx);
  ctx.restore();
  return canvas;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
