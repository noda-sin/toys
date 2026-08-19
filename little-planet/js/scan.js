/* =========================================================
 * scan.js
 * 写真からシートを読み取る画像処理
 *   - 四隅マーカーの自動検出 (二値化 + 連結成分)
 *   - 射影変換 (ホモグラフィ) による歪み補正
 *   - テンプレート形状での切り抜き & ホワイトバランス補正
 * 外部ライブラリなしの自前実装
 * ========================================================= */

"use strict";

const Scan = (() => {

  /* ---- 画像ファイル読み込み (EXIF回転を考慮) ---- */
  async function loadImage(file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch (e) { /* fallback へ */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  /* 画像を最大辺 maxDim 以下の canvas に描く */
  function toCanvas(img, maxDim) {
    const w = img.width, h = img.height;
    const s = Math.min(1, maxDim / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  /* ---- 大津の二値化しきい値 ---- */
  function otsuThreshold(gray) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = 0, thr = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += i * hist[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > maxVar) { maxVar = v; thr = i; }
    }
    return thr;
  }

  /* ---- 連結成分ラベリング (暗い画素の塊を列挙) ---- */
  function findDarkBlobs(canvas) {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      gray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    }
    const thr = otsuThreshold(gray);
    const dark = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) dark[i] = gray[i] < thr ? 1 : 0;

    const visited = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const blobs = [];

    for (let start = 0; start < w * h; start++) {
      if (!dark[start] || visited[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      visited[start] = 1;
      let area = 0, sx = 0, sy = 0;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      while (sp > 0) {
        const idx = stack[--sp];
        const x = idx % w, y = (idx / w) | 0;
        area++;
        sx += x; sy += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        // 4近傍
        if (x > 0     && dark[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; stack[sp++] = idx - 1; }
        if (x < w - 1 && dark[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; stack[sp++] = idx + 1; }
        if (y > 0     && dark[idx - w] && !visited[idx - w]) { visited[idx - w] = 1; stack[sp++] = idx - w; }
        if (y < h - 1 && dark[idx + w] && !visited[idx + w]) { visited[idx + w] = 1; stack[sp++] = idx + w; }
      }
      blobs.push({
        area,
        cx: sx / area, cy: sy / area,
        bw: maxX - minX + 1, bh: maxY - minY + 1,
      });
    }
    return { blobs, w, h };
  }

  /* ---- 四隅マーカー検出。photo 座標系の [TL,TR,BR,BL] か null を返す ---- */
  function detectMarkers(photoCanvas) {
    const work = toCanvas(photoCanvas, 900);
    const { blobs, w, h } = findDarkBlobs(work);
    const imgArea = w * h;

    // マーカー候補: 一定の大きさの、正方形に近い、詰まった塊
    const cands = blobs.filter(b => {
      if (b.area < imgArea * 0.00012 || b.area > imgArea * 0.03) return false;
      const aspect = b.bw / b.bh;
      if (aspect < 0.4 || aspect > 2.5) return false;
      const fill = b.area / (b.bw * b.bh);
      return fill > 0.55;
    });
    if (cands.length < 4) return null;

    // 各コーナー役に最もふさわしい候補を選ぶ
    const roles = [
      b => -(b.cx + b.cy),        // TL: x+y 最小
      b => b.cx - b.cy,           // TR
      b => b.cx + b.cy,           // BR
      b => b.cy - b.cx,           // BL
    ];
    const picked = [];
    for (const score of roles) {
      let best = null, bestS = -Infinity;
      for (const b of cands) {
        if (picked.includes(b)) continue;
        const s = score(b);
        if (s > bestS) { bestS = s; best = b; }
      }
      if (!best) return null;
      picked.push(best);
    }

    // 4点の張る四角形が小さすぎるならノイズとみなす
    const quadArea = polygonArea(picked.map(b => [b.cx, b.cy]));
    if (quadArea < imgArea * 0.12) return null;

    // シートは縦長。横長に検出されたら 90 度回転していると判断してロールをずらす
    let pts = picked.map(b => ({ x: b.cx, y: b.cy }));
    const wSide = dist(pts[0], pts[1]);
    const hSide = dist(pts[0], pts[3]);
    if (wSide > hSide * 1.15) {
      pts = [pts[1], pts[2], pts[3], pts[0]];
    }

    // 元画像スケールへ戻す
    const s = photoCanvas.width / w;
    return pts.map(p => ({ x: p.x * s, y: p.y * s }));
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function polygonArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  /* ---- ホモグラフィ: src[4] → dst[4] を写す 3x3 行列 (DLT) ---- */
  function computeHomography(src, dst) {
    const A = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i];
      const u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    const hv = solveLinear(A);
    return [hv[0], hv[1], hv[2], hv[3], hv[4], hv[5], hv[6], hv[7], 1];
  }

  /* 8x8 連立一次方程式 (拡大係数行列 8x9) をガウスの消去法で解く */
  function solveLinear(M) {
    const n = 8;
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      [M[col], M[piv]] = [M[piv], M[col]];
      const p = M[col][col];
      if (Math.abs(p) < 1e-12) throw new Error("degenerate homography");
      for (let c = col; c <= n; c++) M[col][c] /= p;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        if (f === 0) continue;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map(row => row[8]);
  }

  function applyH(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return {
      x: (H[0] * x + H[1] * y + H[2]) / w,
      y: (H[3] * x + H[4] * y + H[5]) / w,
    };
  }

  /* ---- 写真をシート座標系へ射影変換 (バイリニア補間) ----
   *  photoPts: 写真上のマーカー中心 [TL,TR,BR,BL]
   *  返り値: SHEET_W*s × SHEET_H*s の canvas
   */
  function warpToSheet(photoCanvas, photoPts, s = 0.5) {
    const dw = Math.round(SHEET_W * s);
    const dh = Math.round(SHEET_H * s);
    const sheetPts = SHEET_MARKERS.map(m => ({ x: m.x * s, y: m.y * s }));
    const H = computeHomography(sheetPts, photoPts); // sheet → photo

    const sw = photoCanvas.width, sh = photoCanvas.height;
    const srcData = photoCanvas.getContext("2d").getImageData(0, 0, sw, sh).data;

    const out = document.createElement("canvas");
    out.width = dw;
    out.height = dh;
    const octx = out.getContext("2d");
    const oimg = octx.createImageData(dw, dh);
    const od = oimg.data;

    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const p = applyH(H, x + 0.5, y + 0.5);
        const o = (y * dw + x) * 4;
        if (p.x < 0 || p.y < 0 || p.x >= sw - 1 || p.y >= sh - 1) {
          od[o] = od[o + 1] = od[o + 2] = 255;
          od[o + 3] = 255;
          continue;
        }
        const x0 = p.x | 0, y0 = p.y | 0;
        const fx = p.x - x0, fy = p.y - y0;
        const i00 = (y0 * sw + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + sw * 4;
        const i11 = i01 + 4;
        for (let ch = 0; ch < 3; ch++) {
          od[o + ch] =
            srcData[i00 + ch] * (1 - fx) * (1 - fy) +
            srcData[i10 + ch] * fx * (1 - fy) +
            srcData[i01 + ch] * (1 - fx) * fy +
            srcData[i11 + ch] * fx * fy;
        }
        od[o + 3] = 255;
      }
    }
    octx.putImageData(oimg, 0, 0);
    return out;
  }

  /* ---- シート画像の描画エリア周縁 (紙の白) から白基準を推定 ---- */
  function estimateWhite(sheetCanvas, s) {
    const ctx = sheetCanvas.getContext("2d");
    const samples = [[], [], []];
    const strips = [
      // 描画エリアの四辺のすぐ内側 (だいたい紙のまま残る場所)
      { x: DRAW_AREA.x, y: DRAW_AREA.y, w: DRAW_AREA.w, h: 18 },
      { x: DRAW_AREA.x, y: DRAW_AREA.y + DRAW_AREA.h - 18, w: DRAW_AREA.w, h: 18 },
      { x: DRAW_AREA.x, y: DRAW_AREA.y, w: 18, h: DRAW_AREA.h },
      { x: DRAW_AREA.x + DRAW_AREA.w - 18, y: DRAW_AREA.y, w: 18, h: DRAW_AREA.h },
    ];
    for (const st of strips) {
      const d = ctx.getImageData(
        Math.round(st.x * s), Math.round(st.y * s),
        Math.max(1, Math.round(st.w * s)), Math.max(1, Math.round(st.h * s))
      ).data;
      for (let i = 0; i < d.length; i += 16) { // 間引きサンプリング
        samples[0].push(d[i]);
        samples[1].push(d[i + 1]);
        samples[2].push(d[i + 2]);
      }
    }
    return samples.map(arr => {
      arr.sort((a, b) => a - b);
      return arr[Math.floor(arr.length * 0.6)] || 255; // 中央より少し上の値
    });
  }

  /* ---- シート画像からテンプレート形状のスプライトを切り出す ----
   *  返り値: 透明背景の canvas (テンプレート box 座標系)
   */
  function extractSprite(sheetCanvas, t) {
    const s = sheetCanvas.width / SHEET_W;
    const pl = getPlacement(t);

    const spr = document.createElement("canvas");
    spr.width = t.box.w;
    spr.height = t.box.h;
    const ctx = spr.getContext("2d");

    // シートからテンプレート領域を等倍で転写
    ctx.drawImage(
      sheetCanvas,
      pl.ox * s, pl.oy * s, t.box.w * pl.scale * s, t.box.h * pl.scale * s,
      0, 0, t.box.w, t.box.h
    );

    // ホワイトバランス補正 (照明かぶりを除去)
    const white = estimateWhite(sheetCanvas, s);
    const img = ctx.getImageData(0, 0, spr.width, spr.height);
    const d = img.data;
    const gains = white.map(wv => Math.min(3, 250 / Math.max(60, wv)));
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.min(255, d[i] * gains[0]);
      d[i + 1] = Math.min(255, d[i + 1] * gains[1]);
      d[i + 2] = Math.min(255, d[i + 2] * gains[2]);
    }
    ctx.putImageData(img, 0, 0);

    // テンプレート形状でマスク
    const path = t.path();
    ctx.globalCompositeOperation = "destination-in";
    ctx.fill(path);
    ctx.globalCompositeOperation = "source-over";

    // 輪郭線を描き直してくっきりさせる
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.stroke(path);

    return spr;
  }

  /* =========================================================
   * 自由描画モード: 描かれたインクから形そのものを推定して切り抜く
   *   ① インク画素の検出 (暗い or 彩度が高い)
   *   ② 膨張処理で輪郭のかすれ・すき間を閉じる
   *   ③ 縁からフラッドフィル → 届かない場所 = 線に囲まれた内側
   *   ④ 最大連結成分だけを残して切り出し (ゴミ・小さな落書きを除去)
   * ========================================================= */

  function dilate(mask, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask[i] ||
            (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) ||
            (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])) {
          out[i] = 1;
        }
      }
    }
    return out;
  }

  /* 白背景の canvas から絵を切り抜く。見つからなければ null */
  function extractInk(canvas) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext("2d");
    const src = ctx.getImageData(0, 0, w, h);
    const d = src.data;

    // ① インク画素
    let ink = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      const r = d[j], g = d[j + 1], b = d[j + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mn < 170 || mx - mn > 45) ink[i] = 1;
    }

    // ② closing (輪郭の小さなすき間を塞ぐ)
    for (let it = 0; it < 3; it++) ink = dilate(ink, w, h);

    // ③ 外側判定
    const outside = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;
    const push = i => {
      if (!outside[i] && !ink[i]) { outside[i] = 1; stack[sp++] = i; }
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }

    // ④ 内側 (= 外側でない場所) の最大連結成分
    const labels = new Int32Array(w * h);
    let label = 0, bestLabel = 0, bestArea = 0;
    let bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
    for (let start = 0; start < w * h; start++) {
      if (outside[start] || labels[start]) continue;
      label++;
      let sp2 = 0;
      stack[sp2++] = start;
      labels[start] = label;
      let area = 0, minX = w, maxX = 0, minY = h, maxY = 0;
      while (sp2 > 0) {
        const i = stack[--sp2];
        const x = i % w, y = (i / w) | 0;
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0     && !outside[i - 1] && !labels[i - 1]) { labels[i - 1] = label; stack[sp2++] = i - 1; }
        if (x < w - 1 && !outside[i + 1] && !labels[i + 1]) { labels[i + 1] = label; stack[sp2++] = i + 1; }
        if (y > 0     && !outside[i - w] && !labels[i - w]) { labels[i - w] = label; stack[sp2++] = i - w; }
        if (y < h - 1 && !outside[i + w] && !labels[i + w]) { labels[i + w] = label; stack[sp2++] = i + w; }
      }
      if (area > bestArea) {
        bestArea = area; bestLabel = label;
        bx0 = minX; by0 = minY; bx1 = maxX; by1 = maxY;
      }
    }
    if (bestArea < w * h * 0.004) return null; // 小さすぎ = 絵がない

    // 切り出し
    const pad = 6;
    const x0 = Math.max(0, bx0 - pad), y0 = Math.max(0, by0 - pad);
    const x1 = Math.min(w - 1, bx1 + pad), y1 = Math.min(h - 1, by1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const spr = document.createElement("canvas");
    spr.width = cw;
    spr.height = ch;
    const sctx = spr.getContext("2d");
    const oimg = sctx.createImageData(cw, ch);
    const od = oimg.data;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const si = (y + y0) * w + (x + x0);
        if (labels[si] !== bestLabel) continue;
        const sj = si * 4;
        const oi = (y * cw + x) * 4;
        od[oi] = d[sj];
        od[oi + 1] = d[sj + 1];
        od[oi + 2] = d[sj + 2];
        od[oi + 3] = 255;
      }
    }
    sctx.putImageData(oimg, 0, 0);
    return spr;
  }

  /* 射影変換済みシートの描画エリアから自由描画を切り抜く */
  function extractFreeSprite(sheetCanvas) {
    const s = sheetCanvas.width / SHEET_W;
    const crop = document.createElement("canvas");
    crop.width = Math.round(DRAW_AREA.w * s);
    crop.height = Math.round(DRAW_AREA.h * s);
    const cctx = crop.getContext("2d");
    cctx.drawImage(
      sheetCanvas,
      DRAW_AREA.x * s, DRAW_AREA.y * s, crop.width, crop.height,
      0, 0, crop.width, crop.height
    );

    // ホワイトバランス補正 (extractSprite と同じ)
    const white = estimateWhite(sheetCanvas, s);
    const img = cctx.getImageData(0, 0, crop.width, crop.height);
    const d = img.data;
    const gains = white.map(wv => Math.min(3, 250 / Math.max(60, wv)));
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.min(255, d[i] * gains[0]);
      d[i + 1] = Math.min(255, d[i + 1] * gains[1]);
      d[i + 2] = Math.min(255, d[i + 2] * gains[2]);
    }
    cctx.putImageData(img, 0, 0);

    return extractInk(crop);
  }

  return { loadImage, toCanvas, detectMarkers, computeHomography, applyH, warpToSheet, extractSprite, extractInk, extractFreeSprite };
})();
