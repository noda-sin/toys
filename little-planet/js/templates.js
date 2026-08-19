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

/* ---------------------------------------------------------
 * にんげん (Aポーズ・正面向き)
 * シルエットは右半身のベジェ列を定義し、左半身はミラー生成する。
 * テンプレートなので関節位置が既知 = ML なしで骨格リグが組める
 * --------------------------------------------------------- */

const HUMAN_W = 520;

/* (260,30) 頭頂から時計回りに右半身 → 下中央 (260,516) までのベジェ列
 * [c1x,c1y, c2x,c2y, x,y] */
const HUMAN_RIGHT_SEGS = [
  [310, 30, 345, 60, 345, 115],     // 頭の右側
  [345, 160, 320, 180, 300, 190],   // あご〜首
  [325, 200, 350, 205, 362, 225],   // 肩
  [400, 260, 455, 350, 472, 410],   // 腕の外側
  [478, 440, 455, 462, 430, 452],   // 手の丸み
  [390, 398, 330, 310, 305, 285],   // 腕の内側 (わきへ)
  [310, 330, 320, 420, 330, 480],   // 胴の横
  [338, 520, 338, 620, 338, 720],   // 脚の外側
  [338, 762, 300, 772, 272, 762],   // 足
  [258, 700, 258, 600, 262, 540],   // 脚の内側
  [262, 528, 261, 520, 260, 516],   // またぐら
];

function humanPath() {
  const p = new Path2D();
  p.moveTo(260, 30);
  for (const [c1x, c1y, c2x, c2y, x, y] of HUMAN_RIGHT_SEGS) {
    p.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
  }
  // 左半身: 逆順にミラー (x → HUMAN_W - x)
  for (let i = HUMAN_RIGHT_SEGS.length - 1; i >= 0; i--) {
    const [c1x, c1y, c2x, c2y] = HUMAN_RIGHT_SEGS[i];
    const start = i > 0 ? HUMAN_RIGHT_SEGS[i - 1] : null;
    const sx = start ? start[4] : 260;
    const sy = start ? start[5] : 30;
    p.bezierCurveTo(HUMAN_W - c2x, c2y, HUMAN_W - c1x, c1y, HUMAN_W - sx, sy);
  }
  p.closePath();
  return p;
}

function humanDecor(ctx) {
  // 目
  for (const ex of [232, 288]) {
    ctx.beginPath();
    ctx.arc(ex, 100, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, 100, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 口
  ctx.beginPath();
  ctx.arc(260, 125, 22, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

/* 関節座標とパーツ分割 (テンプレート座標系)。
 * parts は奥→手前の描画順。seg のカプセル (太い丸端線分) でスプライトを
 * 切り出し、chain の [関節, 角度キー] を順に適用して回転させる */
const HUMAN_RIG = {
  joints: {
    hips: [260, 480],
    shoulderR: [330, 235], elbowR: [400, 330], wristR: [452, 420],
    shoulderL: [190, 235], elbowL: [120, 330], wristL: [68, 420],
    hipR: [298, 495], kneeR: [320, 612], ankleR: [330, 730],
    hipL: [222, 495], kneeL: [200, 612], ankleL: [190, 730],
  },
  parts: [
    { seg: ["elbowR", "wristR"], width: 84, ext: 0.42,
      chain: [["shoulderR", "armR"], ["elbowR", "foreR"]] },
    { seg: ["shoulderR", "elbowR"], width: 88,
      chain: [["shoulderR", "armR"]] },
    { seg: ["elbowL", "wristL"], width: 84, ext: 0.42,
      chain: [["shoulderL", "armL"], ["elbowL", "foreL"]] },
    { seg: ["shoulderL", "elbowL"], width: 88,
      chain: [["shoulderL", "armL"]] },
    { seg: ["kneeR", "ankleR"], width: 92, ext: 0.5,
      chain: [["hipR", "thighR"], ["kneeR", "shinR"]] },
    { seg: ["hipR", "kneeR"], width: 96,
      chain: [["hipR", "thighR"]] },
    { seg: ["kneeL", "ankleL"], width: 92, ext: 0.5,
      chain: [["hipL", "thighL"], ["kneeL", "shinL"]] },
    { seg: ["hipL", "kneeL"], width: 96,
      chain: [["hipL", "thighL"]] },
    // 体幹 + 頭 (最後 = 最前面。肩・またの切れ目を隠す)
    { seg: ["hips", "headTop"], width: 215, chain: [] },
  ],
};
HUMAN_RIG.joints.headTop = [260, 70];

/* 自由描画に「にんげんリグ」を付けるときの標準骨格
 * (スプライトのバウンディングボックスに対する比率 0..1) */
const DEFAULT_JOINTS_N = {
  headTop: [0.5, 0.06],
  hips: [0.5, 0.60],
  shoulderR: [0.64, 0.29], elbowR: [0.77, 0.41], wristR: [0.87, 0.52],
  shoulderL: [0.36, 0.29], elbowL: [0.23, 0.41], wristL: [0.13, 0.52],
  hipR: [0.57, 0.62], kneeR: [0.62, 0.77], ankleR: [0.64, 0.91],
  hipL: [0.43, 0.62], kneeL: [0.38, 0.77], ankleL: [0.36, 0.91],
};

/* 正規化関節 (0..1) をスプライト座標へ展開し、にんげんと同じパーツ構成の
 * リグを作る。パーツ幅はスプライトの大きさに比例させる */
function rigFromJoints(jointsN, w, h) {
  const joints = {};
  for (const k in jointsN) joints[k] = [jointsN[k][0] * w, jointsN[k][1] * h];
  const scale = (w + h) / (520 + 800);
  const parts = HUMAN_RIG.parts.map(p => ({ ...p, width: p.width * scale }));
  return { joints, parts };
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
  human: {
    id: "human", name: "にんげん", emoji: "🧍",
    habitat: "land", facing: "left",
    box: { w: HUMAN_W, h: 800 },
    path: humanPath, decor: humanDecor,
    rig: HUMAN_RIG,
  },
  /* じゆうモード: 形は決めず、描かれたインクから切り抜く */
  free: {
    id: "free", name: "じゆうに かく", emoji: "✏️",
    habitat: null, facing: "left",
    box: { w: 800, h: 800 },
    path: null, decor: null,
  },
};

const TEMPLATE_IDS = Object.keys(TEMPLATES);
const SHAPE_TEMPLATE_IDS = TEMPLATE_IDS.filter(id => TEMPLATES[id].path);

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
  if (t.path) {
    ctx.fillText("くろい わくの なかに じゆうに いろを ぬってね!", SHEET_W / 2, 255);
  } else {
    // じゆうシート: 絵の中にガイド文を入れるとスキャンに写り込むので上部にまとめる
    ctx.fillText("わくの なかに すきなものを ひとつ おおきく かこう!", SHEET_W / 2, 245);
    ctx.fillText("りんかくは ふとい くろペンで しっかり とじて かいてね", SHEET_W / 2, 290);
  }
  ctx.fillText("かきおわったら アプリで スキャンしよう (すみの ■ は ぬらないでね)", SHEET_W / 2, SHEET_H - 240);

  // 描画エリアのガイド枠
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  roundRectPath(ctx, DRAW_AREA.x - 20, DRAW_AREA.y - 20, DRAW_AREA.w + 40, DRAW_AREA.h + 40, 24);
  ctx.stroke();
  ctx.setLineDash([]);

  if (t.path) {
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
  }
  // じゆうシートは点線わくの中を空のままにする (ガイド文は上部に記載済み)

  return canvas;
}

/* サムネイル (輪郭のみの小さいプレビュー) */
function renderThumb(canvas, t, size = 150) {
  if (!t.path) {
    // じゆうモード: 点線わく + えんぴつ
    canvas.width = size;
    canvas.height = Math.round(size * 0.62);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#bbbbbb";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    roundRectPath(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `${Math.round(size * 0.3)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✏️", canvas.width / 2, canvas.height / 2);
    return canvas;
  }
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
