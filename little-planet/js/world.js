/* =========================================================
 * world.js
 * 海・陸・空のワールド。取り込んだ絵 (スプライト) が
 * 生きもの・のりものとして動き回る
 * ========================================================= */

"use strict";

const World = (() => {

  let canvas, ctx;
  let W = 0, H = 0, dpr = 1;
  let creatures = [];
  let particles = [];
  let clouds = [];
  let time = 0;
  let lastTs = 0;

  const MAX_CREATURES = 24;

  /* --- 領域のレイアウト (画面高さに対する比率) --- */
  const LAYOUT = {
    skyBottom: 0.44,
    roadTop: 0.555,
    roadBottom: 0.625,
    seaTop: 0.66,
  };

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", onTap);

    clouds = [];
    for (let i = 0; i < 4; i++) {
      clouds.push({
        x: Math.random(),
        y: 0.05 + Math.random() * 0.22,
        s: 0.7 + Math.random() * 0.8,
        v: 0.004 + Math.random() * 0.008,
      });
    }
    requestAnimationFrame(tick);
  }

  function resize() {
    // 別タブ表示中 (display:none) は clientWidth が 0 になるので無視する
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  /* ---------------- 生きものの追加 ---------------- */

  function addCreature(templateId, sprite, opts = {}) {
    const t = TEMPLATES[templateId];
    const habitat = opts.habitat || (t && t.habitat);
    if (!habitat) return null;
    while (creatures.length >= MAX_CREATURES) creatures.shift();

    const zone = zoneFor(habitat);
    const c = {
      tid: templateId,
      habitat,
      facing: (t && t.facing) || "left",
      sprite,
      x: opts.x !== undefined ? opts.x : 0.2 + Math.random() * 0.6,   // 0..1 正規化
      y: opts.y !== undefined ? opts.y : zone.min + Math.random() * (zone.max - zone.min),
      baseY: 0,
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: 0.025 + Math.random() * 0.03,       // 画面幅 / 秒
      phase: Math.random() * Math.PI * 2,
      freq: 5 + Math.random() * 3,
      scale: 0,
      sizeFrac: 0.13 + Math.random() * 0.05,   // 画面幅に対する大きさの比率
      born: 0,          // 0→1 登場アニメ
      excited: 0,       // タップしたときの盛り上がり
      spin: 0,
    };
    // 骨格リグ付きテンプレート (にんげん) はスプライトをパーツに分解する
    if (t && t.rig) {
      let spr = sprite;
      if (sprite.width !== t.box.w || sprite.height !== t.box.h) {
        // 保存データ等で縮小されている場合はテンプレート座標系に戻す
        spr = document.createElement("canvas");
        spr.width = t.box.w;
        spr.height = t.box.h;
        spr.getContext("2d").drawImage(sprite, 0, 0, spr.width, spr.height);
        c.sprite = spr;
      }
      c.puppet = makePuppet(spr, t.rig);
      c.speed *= 0.5;   // 歩きなのでゆっくり
    }

    c.baseY = c.y;
    creatures.push(c);
    burst(c.x * W, c.y * H, "#ffd76e", 18);
    save();
    return c;
  }

  /* スプライトを関節カプセル (太い丸端線分) でパーツに切り出す */
  function makePuppet(sprite, rig) {
    const parts = rig.parts.map(def => {
      const a = rig.joints[def.seg[0]];
      const b0 = rig.joints[def.seg[1]];
      const ext = def.ext || 0;
      const b = [b0[0] + (b0[0] - a[0]) * ext, b0[1] + (b0[1] - a[1]) * ext];
      const r = def.width / 2 + 4;
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r));
      const maxX = Math.min(sprite.width, Math.ceil(Math.max(a[0], b[0]) + r));
      const maxY = Math.min(sprite.height, Math.ceil(Math.max(a[1], b[1]) + r));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, maxX - minX);
      cv.height = Math.max(1, maxY - minY);
      const pctx = cv.getContext("2d");
      pctx.drawImage(sprite, -minX, -minY);
      pctx.globalCompositeOperation = "destination-in";
      pctx.strokeStyle = "#000";
      pctx.lineWidth = def.width;
      pctx.lineCap = "round";
      pctx.beginPath();
      pctx.moveTo(a[0] - minX, a[1] - minY);
      pctx.lineTo(b[0] - minX, b[1] - minY);
      pctx.stroke();
      return { canvas: cv, ox: minX, oy: minY, chain: def.chain };
    });
    return { parts, joints: rig.joints };
  }

  function zoneFor(habitat) {
    if (habitat === "sky") return { min: 0.08, max: LAYOUT.skyBottom - 0.10 };
    if (habitat === "sea") return { min: LAYOUT.seaTop + 0.07, max: 0.93 };
    return { min: 0.585, max: 0.585 };  // land: 道路の上
  }

  /* 現在の画面サイズに対するスプライトの表示倍率。
   * 追加時に固定せず毎フレーム計算する — canvas が非表示 (幅0) の
   * タブから放流されたときや、ウィンドウリサイズ後も正しく描ける */
  function fitScale(c) {
    return Math.min(
      (c.sizeFrac * W) / c.sprite.width,
      (H * 0.22) / c.sprite.height
    );
  }

  function clearCreatures() {
    creatures = [];
    save();
  }

  function count() { return creatures.length; }

  /* ---------------- タップでリアクション ---------------- */

  function onTap(ev) {
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    for (let i = creatures.length - 1; i >= 0; i--) {
      const c = creatures[i];
      const hw = (c.sprite.width * c.scale) / 2;
      const hh = (c.sprite.height * c.scale) / 2;
      const cx = c.x * W;
      let cy = c.y * H;
      if (c.habitat === "land") {
        // 陸は接地面が基準なので見た目の中心に合わせる
        cy = H * ((LAYOUT.roadTop + LAYOUT.roadBottom) / 2) + 6 - hh;
      }
      if (px > cx - hw && px < cx + hw && py > cy - hh && py < cy + hh) {
        c.excited = 1;
        c.spin = 0.001;
        burst(cx, cy, "#ffef9e", 14);
        burst(cx, cy, "#9edaff", 10);
        break;
      }
    }
  }

  /* ---------------- パーティクル ---------------- */

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 160;
      particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 60,
        life: 0.7 + Math.random() * 0.5,
        age: 0,
        r: 3 + Math.random() * 5,
        color,
      });
    }
  }

  /* ---------------- メインループ ---------------- */

  function tick(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    time += dt;

    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();

    update(dt);
    render();
    requestAnimationFrame(tick);
  }

  function update(dt) {
    for (const cl of clouds) {
      cl.x += cl.v * dt;
      if (cl.x > 1.2) cl.x = -0.25;
    }

    for (const c of creatures) {
      if (c.born < 1) c.born = Math.min(1, c.born + dt * 2.2);
      if (c.excited > 0) c.excited = Math.max(0, c.excited - dt * 0.8);
      if (c.spin > 0) {
        c.spin += dt * 9;
        if (c.spin > Math.PI * 2) c.spin = 0;
      }

      const boost = 1 + c.excited * 1.6;
      c.x += c.dir * c.speed * boost * dt;

      // 端で折り返し
      const margin = 0.08;
      if (c.x > 1 - margin) { c.x = 1 - margin; c.dir = -1; }
      if (c.x < margin) { c.x = margin; c.dir = 1; }

      if (c.habitat === "sea") {
        c.y = c.baseY + Math.sin(time * 0.9 + c.phase) * 0.012;
      } else if (c.habitat === "sky") {
        c.y = c.baseY + Math.sin(time * 1.4 + c.phase) * 0.03;
      }
      // land はバウンドのみ (描画時)

      c.scale = fitScale(c) * easeOutBack(c.born);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age > p.life) { particles.splice(i, 1); continue; }
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /* ---------------- 描画 ---------------- */

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawSky();
    drawLand();
    drawSea();

    // 奥から: 空 → 陸 → 海 の順に生きものを描く
    for (const c of creatures) if (c.habitat === "sky") drawCreature(c);
    for (const c of creatures) if (c.habitat === "land") drawCreature(c);
    for (const c of creatures) if (c.habitat === "sea") drawCreature(c);

    drawParticles();
  }

  function drawSky() {
    const skyH = H * LAYOUT.seaTop; // 海面より上はすべて空ベース
    const g = ctx.createLinearGradient(0, 0, 0, skyH);
    g.addColorStop(0, "#8fd7ff");
    g.addColorStop(1, "#e8f8ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, skyH + 2);

    // 太陽
    const sx = W * 0.85, sy = H * 0.10, sr = Math.min(W, H) * 0.05;
    ctx.fillStyle = "rgba(255, 220, 110, 0.35)";
    ctx.beginPath(); ctx.arc(sx, sy, sr * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd76e";
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();

    // 雲
    for (const cl of clouds) drawCloud(cl.x * W, cl.y * H, cl.s * Math.min(W, H) * 0.001);
  }

  function drawCloud(x, y, s) {
    const u = 60 * s * 10;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.arc(x, y, u * 0.5, 0, Math.PI * 2);
    ctx.arc(x + u * 0.55, y - u * 0.28, u * 0.62, 0, Math.PI * 2);
    ctx.arc(x + u * 1.15, y, u * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLand() {
    const top = H * LAYOUT.skyBottom;
    const bottom = H * LAYOUT.seaTop;

    // 丘のシルエット
    ctx.fillStyle = "#8ed86a";
    ctx.beginPath();
    ctx.moveTo(0, top + 20);
    ctx.quadraticCurveTo(W * 0.2, top - H * 0.06, W * 0.42, top + 14);
    ctx.quadraticCurveTo(W * 0.65, top - H * 0.045, W * 0.85, top + 12);
    ctx.quadraticCurveTo(W * 0.95, top + 2, W, top + 16);
    ctx.lineTo(W, bottom);
    ctx.lineTo(0, bottom);
    ctx.closePath();
    ctx.fill();

    // 草の帯
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, "rgba(126, 200, 90, 0)");
    g.addColorStop(1, "#5cbf4a");
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, bottom - top);

    // 道路
    const rt = H * LAYOUT.roadTop, rb = H * LAYOUT.roadBottom;
    ctx.fillStyle = "#e9d8a8";
    ctx.fillRect(0, rt, W, rb - rt);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 18]);
    ctx.beginPath();
    ctx.moveTo(0, (rt + rb) / 2);
    ctx.lineTo(W, (rt + rb) / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 木を数本
    for (let i = 0; i < 3; i++) {
      const tx = W * (0.15 + i * 0.35);
      const ty = top + 8;
      ctx.fillStyle = "#8a6642";
      ctx.fillRect(tx - 4, ty - 26, 8, 26);
      ctx.fillStyle = "#3f9e4f";
      ctx.beginPath(); ctx.arc(tx, ty - 40, 22, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawSea() {
    const top = H * LAYOUT.seaTop;

    // 波打つ海面
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, top);
    for (let x = 0; x <= W; x += 14) {
      ctx.lineTo(x, top + Math.sin(x * 0.025 + time * 1.8) * 5);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, "#54c2ee");
    g.addColorStop(1, "#1a6db6");
    ctx.fillStyle = g;
    ctx.fill();

    // 波頭のハイライト
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 14) {
      const y = top + Math.sin(x * 0.025 + time * 1.8) * 5;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ゆらぐ光のすじ (水面から差しこむ細い光)
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 4; i++) {
      const lx = W * (0.12 + i * 0.24) + Math.sin(time * 0.4 + i * 2) * 24;
      ctx.beginPath();
      ctx.moveTo(lx - W * 0.015, top + 8);
      ctx.lineTo(lx + W * 0.015, top + 8);
      ctx.lineTo(lx + W * 0.06, H);
      ctx.lineTo(lx - W * 0.06, H);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ---- 生きもの描画 ---- */

  function drawCreature(c) {
    const cx = c.x * W;

    ctx.save();

    if (c.habitat === "land") {
      if (c.puppet) drawPuppet(c, cx);
      else drawDrive(c, cx);
      ctx.restore();
      return;
    }

    ctx.translate(cx, c.y * H);

    // シルエットの向きと進行方向を合わせる
    const facingSign = c.facing === "left" ? -1 : 1;
    if (c.dir !== facingSign) ctx.scale(-1, 1);

    if (c.spin > 0) ctx.rotate(c.spin);

    if (c.habitat === "sky") {
      // 進行方向へ少し傾ける
      ctx.rotate(Math.sin(time * 1.4 + c.phase) * 0.12);
      drawFlap(c);
    } else {
      drawSwim(c);
    }

    ctx.restore();
  }

  /* 背骨カーブに沿って体をしならせる (頭→しっぽへ進む波)。
   * 各ストリップを波の局所勾配ぶん回転させるので、単なる上下ゆれでなく
   * 「しなり」に見える。頭は安定、しっぽほど大きく振れる */
  function drawSwim(c) {
    const spr = c.sprite;
    const n = 14;
    const sw = spr.width / n;
    const tailAtRight = c.facing === "left";   // しっぽは「向き」と反対側
    const t0 = time * c.freq + c.phase;
    const baseAmp = spr.height * 0.055 * (1 + c.excited * 1.6);
    const waveLen = 3.6;                       // 体に乗る波の位相量 (rad)
    const offAt = s => baseAmp * (0.12 + s * s) * Math.sin(t0 - s * waveLen);

    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) * sw;                                    // ストリップ中心
      const s = tailAtRight ? u / spr.width : 1 - u / spr.width;   // 頭からの距離 0..1
      const off = offAt(s);
      const ds = 0.05;
      const slope = (offAt(s + ds) - offAt(s - ds)) / (2 * ds * spr.width)
        * (tailAtRight ? 1 : -1);

      // 継ぎ目が開かないよう前後に少し重ねて切り出す
      const sx0 = Math.max(0, i * sw - sw * 0.25);
      const sx1 = Math.min(spr.width, (i + 1) * sw + sw * 0.25);

      ctx.save();
      ctx.translate((u - spr.width / 2) * c.scale, off * c.scale);
      ctx.rotate(Math.atan(slope) * 0.9);
      ctx.drawImage(
        spr,
        sx0, 0, sx1 - sx0, spr.height,
        (sx0 - u) * c.scale, (-spr.height / 2) * c.scale,
        (sx1 - sx0) * c.scale, spr.height * c.scale
      );
      ctx.restore();
    }
  }

  /* 上半分 (翼) を縮ませて羽ばたく。打ち下ろしは速く、持ち上げはゆっくり */
  function drawFlap(c) {
    const spr = c.sprite;
    const split = Math.round(spr.height * 0.48);
    const raw = Math.sin(time * (c.freq * 1.2) + c.phase);
    const shaped = Math.sign(raw) * Math.pow(Math.abs(raw), 0.65);  // 非対称イージング
    const flap = 0.55 + 0.45 * Math.abs(shaped);
    const bodyLift = -shaped * spr.height * 0.03;   // 打ち下ろしで体がふわっと浮く
    const w = spr.width * c.scale;
    const x0 = -w / 2;
    const y0 = (-spr.height / 2 + bodyLift) * c.scale;

    // 下半分 (体)
    ctx.drawImage(
      spr,
      0, split, spr.width, spr.height - split,
      x0, y0 + split * c.scale,
      w, (spr.height - split) * c.scale
    );
    // 上半分 (翼): 付け根を基準に縦へ伸縮
    const wingH = split * c.scale * flap;
    ctx.drawImage(
      spr,
      0, 0, spr.width, split,
      x0, y0 + split * c.scale - wingH,
      w, wingH
    );
  }

  /* 骨格リグ付きスプライト (にんげん) のカットアウトアニメ。
   * ふだんは歩行サイクル、タップされる (excited) とダンスにブレンドする */
  function drawPuppet(c, cx) {
    const box = c.sprite;
    const roadY = H * ((LAYOUT.roadTop + LAYOUT.roadBottom) / 2) + 6;
    const d = Math.min(1, c.excited * 1.4);   // 0=歩き 1=ダンス
    const wp = time * 6.5 + c.phase;          // 歩行の位相
    const dp = time * 9 + c.phase;            // ダンスの位相

    const walk = {
      thighR: Math.sin(wp) * 0.5,
      thighL: Math.sin(wp + Math.PI) * 0.5,
      shinR: 0.08 + Math.max(0, Math.sin(wp - 1.4)) * 0.7,
      shinL: 0.08 + Math.max(0, Math.sin(wp + Math.PI - 1.4)) * 0.7,
      // 腕は体側に下ろした姿勢を基準に前後へ振る
      armR: 0.55 + Math.sin(wp + Math.PI) * 0.3,
      armL: -0.55 + Math.sin(wp) * 0.3,
      foreR: -0.35, foreL: 0.35,
      lean: 0.05,
      hop: Math.abs(Math.sin(wp)) * 14,
    };
    const dance = {
      thighR: Math.sin(dp) * 0.15,
      thighL: -Math.sin(dp) * 0.15,
      shinR: 0.15, shinL: 0.15,
      armR: -1.95 + Math.sin(dp) * 0.4,          // ばんざいして振る
      armL: 1.95 - Math.sin(dp + 0.6) * 0.4,
      foreR: -0.3 + Math.sin(dp + 1) * 0.4,
      foreL: 0.3 - Math.sin(dp + 1.6) * 0.4,
      lean: Math.sin(dp * 0.5) * 0.14,
      hop: Math.abs(Math.sin(dp)) * 40,
    };
    const mix = k => walk[k] * (1 - d) + dance[k] * d;
    const angles = {
      thighR: mix("thighR"), thighL: mix("thighL"),
      shinR: mix("shinR"), shinL: mix("shinL"),
      armR: mix("armR"), armL: mix("armL"),
      foreR: mix("foreR"), foreL: mix("foreL"),
    };

    ctx.translate(cx, roadY);
    const facingSign = c.facing === "left" ? -1 : 1;
    if (c.dir !== facingSign) ctx.scale(-1, 1);
    ctx.rotate(mix("lean"));
    ctx.scale(c.scale, c.scale);
    ctx.translate(-box.width / 2, -box.height - mix("hop"));

    for (const part of c.puppet.parts) {
      ctx.save();
      for (const [jointName, angleKey] of part.chain) {
        const j = c.puppet.joints[jointName];
        ctx.translate(j[0], j[1]);
        ctx.rotate(angles[angleKey]);
        ctx.translate(-j[0], -j[1]);
      }
      ctx.drawImage(part.canvas, part.ox, part.oy);
      ctx.restore();
    }
  }

  /* 道路の上をホップしながら走る。接地でつぶれ、空中で伸びる
   * (スクワッシュ&ストレッチ)。基準点は接地面 (下端中央) */
  function drawDrive(c, cx) {
    const spr = c.sprite;
    const roadY = H * ((LAYOUT.roadTop + LAYOUT.roadBottom) / 2) + 6;
    const p = Math.sin(time * (6 + c.excited * 4) + c.phase);
    const hop = Math.max(0, p) * spr.height * c.scale * (0.06 + c.excited * 0.25);

    let sx = 1, sy = 1;
    if (p < 0) { sy = 1 - 0.10 * -p; sx = 1 + 0.10 * -p; }   // 接地: つぶれる
    else       { sy = 1 + 0.05 * p;  sx = 1 - 0.05 * p; }    // 空中: 伸びる

    ctx.translate(cx, roadY - hop);
    const facingSign = c.facing === "left" ? -1 : 1;
    if (c.dir !== facingSign) ctx.scale(-1, 1);
    if (c.spin > 0) ctx.rotate(c.spin);
    ctx.rotate(p * 0.03);
    ctx.scale(sx, sy);
    ctx.drawImage(
      spr,
      (-spr.width / 2) * c.scale,
      -spr.height * c.scale,
      spr.width * c.scale,
      spr.height * c.scale
    );
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- サンプル生成 ---------------- */

  const SAMPLE_HUES = [10, 35, 120, 200, 260, 320];

  function makeSampleSprite(t) {
    const spr = document.createElement("canvas");
    spr.width = t.box.w;
    spr.height = t.box.h;
    const sctx = spr.getContext("2d");
    const hue = SAMPLE_HUES[Math.floor(Math.random() * SAMPLE_HUES.length)];
    const path = t.path();

    // ベース色 + しましま
    sctx.fillStyle = `hsl(${hue}, 75%, 68%)`;
    sctx.fill(path);
    sctx.save();
    sctx.clip(path);
    sctx.fillStyle = `hsl(${(hue + 40) % 360}, 80%, 60%)`;
    const stripeW = 60 + Math.random() * 50;
    for (let x = -spr.height; x < spr.width; x += stripeW * 2) {
      sctx.save();
      sctx.translate(x, 0);
      sctx.rotate(0.35);
      sctx.fillRect(0, -200, stripeW, spr.height + 400);
      sctx.restore();
    }
    // 水玉
    sctx.fillStyle = `hsla(${(hue + 180) % 360}, 80%, 85%, 0.85)`;
    for (let i = 0; i < 7; i++) {
      sctx.beginPath();
      sctx.arc(Math.random() * spr.width, Math.random() * spr.height, 12 + Math.random() * 18, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.restore();

    // 輪郭と飾り
    sctx.strokeStyle = "#222222";
    sctx.lineWidth = 10;
    sctx.lineJoin = "round";
    sctx.stroke(path);
    sctx.lineWidth = 5;
    sctx.fillStyle = "#222222";
    t.decor(sctx);

    // 形でマスク (輪郭線の外側は残す必要なし)
    sctx.globalCompositeOperation = "destination-in";
    sctx.fill(path);
    sctx.globalCompositeOperation = "source-over";
    sctx.lineWidth = 10;
    sctx.stroke(path);

    return spr;
  }

  function addSample() {
    const tid = SHAPE_TEMPLATE_IDS[Math.floor(Math.random() * SHAPE_TEMPLATE_IDS.length)];
    const t = TEMPLATES[tid];
    addCreature(tid, makeSampleSprite(t));
  }

  /* ---------------- 保存 / 復元 ---------------- */

  const STORE_KEY = "oekaki-planet-creatures-v1";

  function save() {
    try {
      const list = creatures.slice(-12).map(c => {
        // 保存サイズを抑えるため縮小して保存
        const small = document.createElement("canvas");
        const s = 280 / c.sprite.width;
        small.width = 280;
        small.height = Math.round(c.sprite.height * s);
        small.getContext("2d").drawImage(c.sprite, 0, 0, small.width, small.height);
        return { tid: c.tid, habitat: c.habitat, data: small.toDataURL("image/png") };
      });
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (e) { /* 容量オーバーなどは無視 */ }
  }

  function load() {
    let list;
    try {
      list = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    } catch (e) { return; }
    for (const item of list) {
      if (!TEMPLATES[item.tid]) continue;
      const img = new Image();
      img.onload = () => {
        const spr = document.createElement("canvas");
        spr.width = img.width;
        spr.height = img.height;
        spr.getContext("2d").drawImage(img, 0, 0);
        addCreature(item.tid, spr, { habitat: item.habitat });
      };
      img.src = item.data;
    }
  }

  return { init, addCreature, addSample, clearCreatures, count, load };
})();
