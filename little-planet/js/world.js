/* =========================================================
 * world.js
 * 宇宙・空・陸・海のワールド。取り込んだ絵 (スプライト) が
 * 生きもの・のりものとして動き回る。
 *  - 実時間連動の昼夜サイクル (夜はみんなおやすみ)
 *  - タップでエサやり / 生きもの同士のふれあい
 *  - クジラ・気球・虹・雨・雪・流れ星のランダムイベント
 *  - 放流時のおひろめ演出 (紙吹雪 + バナー + スポットライト)
 * ========================================================= */

"use strict";

const World = (() => {

  let canvas, ctx;
  let W = 0, H = 0, dpr = 1;
  let creatures = [];
  let particles = [];
  let clouds = [];
  let stars = [];
  let foods = [];
  let events = [];
  let banner = null;          // {text, t, dur}
  let spot = null;            // {c, t, dur}
  let time = 0;
  let lastTs = 0;
  let nextEventAt = 25;
  let greetTimer = 0;
  let zzzTimer = 0;
  let sky = { h: 12, night: 0, dusk: 0 };

  const MAX_CREATURES = 24;

  /* --- 領域のレイアウト (画面高さに対する比率) --- */
  const LAYOUT = {
    spaceBottom: 0.10,
    skyBottom: 0.44,
    roadTop: 0.555,
    roadBottom: 0.625,
    seaTop: 0.66,
  };

  /* デバッグ・デモ用の時刻上書き (?hour=22.5) */
  let hourOverride = null;
  {
    const hp = new URLSearchParams(location.search).get("hour");
    if (hp !== null && hp !== "") hourOverride = parseFloat(hp);
  }

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
        y: 0.13 + Math.random() * 0.16,
        s: 0.7 + Math.random() * 0.8,
        v: 0.004 + Math.random() * 0.008,
      });
    }
    stars = [];
    for (let i = 0; i < 90; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random() * LAYOUT.seaTop * 0.9,
        r: 0.6 + Math.random() * 1.4,
        tw: Math.random() * Math.PI * 2,
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
    // 4K プロジェクター等でラズパイが溺れないよう総ピクセル数に上限を設ける
    const BUDGET = 2400000;
    while (W * dpr * H * dpr > BUDGET && dpr > 1) dpr -= 0.25;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  /* ---------------- 時刻と空の状態 ---------------- */

  function nowHour() {
    if (hourOverride !== null && !Number.isNaN(hourOverride)) return hourOverride;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }

  /* night: 0(昼)〜1(夜) / dusk: 夕焼け・朝焼けの強さ */
  function skyState() {
    const h = nowHour();
    let night = 0, dusk = 0;
    if (h >= 19 || h < 5) night = 1;
    else if (h >= 17) { night = (h - 17) / 2; dusk = 1 - Math.abs(h - 18); }
    else if (h < 7) { night = (7 - h) / 2; dusk = 1 - Math.abs(h - 6); }
    return { h, night: Math.min(1, Math.max(0, night)), dusk: Math.max(0, dusk) };
  }

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function lerpColor(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    const m = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
    return `rgb(${m[0]},${m[1]},${m[2]})`;
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
      surface: !!(t && t.surface),
      sprite,
      name: opts.name || "",
      rare: !!opts.rare,
      x: opts.x !== undefined ? opts.x : 0.2 + Math.random() * 0.6,   // 0..1 正規化
      y: opts.y !== undefined ? opts.y : zone.min + Math.random() * (zone.max - zone.min),
      baseY: 0,
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: 0.05 + Math.random() * 0.05,        // 画面幅 / 秒 (横断 ~12-20秒)
      phase: Math.random() * Math.PI * 2,
      freq: 5 + Math.random() * 3,
      scale: 0,
      sizeFrac: 0.13 + Math.random() * 0.05,     // 画面幅に対する大きさの比率
      born: 0,          // 0→1 登場アニメ
      excited: 0,       // タップしたときの盛り上がり
      spin: 0,
      lastGreet: 0,
      motion: null,     // にんげんの行動 (walk/skip/bow)
      foodTarget: null,
    };

    // 自由描画に手動/ML リグ (正規化関節) が付いている場合
    if (opts.joints) {
      c.jointsN = opts.joints;
      c.puppet = makePuppet(sprite, rigFromJoints(opts.joints, sprite.width, sprite.height));
      c.speed *= 0.5;
    }
    // 骨格リグ付きテンプレート (にんげん) はスプライトをパーツに分解する
    else if (t && t.rig) {
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

    if (habitat === "space") c.speed *= 1.8;

    c.baseY = c.y;
    creatures.push(c);
    burst(c.x * W, c.y * H, "#ffd76e", 18);
    if (opts.celebrate) celebrate(c);
    if (!opts.fromStore) persist(c);
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
    if (habitat === "space") return { min: 0.025, max: LAYOUT.spaceBottom - 0.015 };
    if (habitat === "sky") return { min: 0.14, max: LAYOUT.skyBottom - 0.10 };
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
    knownIds.clear();
    if (storeMode === "server") {
      fetch("/api/creatures", { method: "DELETE" }).catch(() => {});
    } else {
      saveLocal();
    }
  }

  function count() { return creatures.length; }

  /* ---------------- タップ: リアクション or エサやり ---------------- */

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
        if (!c.puppet) c.spin = 0.001;
        burst(cx, cy, "#ffef9e", 14);
        burst(cx, cy, "#9edaff", 10);
        tapSound(c);
        return;
      }
    }
    // 生きものに当たらなかったらエサを落とす
    dropFood(px / W, py / H);
  }

  function tapSound(c) {
    const t = TEMPLATES[c.tid];
    if (c.puppet) return Sound.fx("yay");
    if (t && t.id === "car") return Sound.fx("horn");
    if (t && t.id === "dino") return Sound.fx("roar");
    if (c.surface) return Sound.fx("splash");
    if (c.habitat === "sea") return Sound.fx("bubble");
    if (c.habitat === "sky") return Sound.fx("chirp");
    if (c.habitat === "space") return Sound.fx("whoosh");
    Sound.fx("yay");
  }

  /* ---------------- エサやり ---------------- */

  function dropFood(nx, ny) {
    if (foods.length > 12) return;
    let habitat;
    if (ny >= LAYOUT.seaTop) habitat = "sea";
    else if (ny < LAYOUT.spaceBottom) habitat = "space";
    else if (ny < LAYOUT.skyBottom) habitat = "sky";
    else habitat = "land";
    const f = { habitat, x: nx, y: ny, age: 0, life: 20, phase: Math.random() * 7 };
    if (habitat === "land") f.y = (LAYOUT.roadTop + LAYOUT.roadBottom) / 2 - 0.01;
    foods.push(f);
    Sound.fx("plop");
    burst(nx * W, f.y * H, "#ffdf9e", 6);
  }

  function updateFoods(dt) {
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      f.age += dt;
      if (f.age > f.life) { foods.splice(i, 1); continue; }
      if (f.habitat === "sea" && f.y < 0.92) f.y += dt * 0.012;       // しずむ
      if (f.habitat === "sky" && f.y < LAYOUT.skyBottom - 0.12) f.y += dt * 0.008; // ふわふわ落ちる
    }

    // 生きものがエサへ向かう
    for (const c of creatures) {
      if (c.surface || c.puppet && sky.night > 0.6) continue;
      let best = null, bestD = 0.5;
      for (const f of foods) {
        if (f.habitat !== c.habitat) continue;
        const d = Math.abs(f.x - c.x);
        if (d < bestD) { bestD = d; best = f; }
      }
      c.foodTarget = best;
      if (!best) continue;
      const dx = best.x - c.x;
      if (Math.abs(dx) > 0.03) c.dir = dx > 0 ? 1 : -1;
      if (c.habitat === "sea" || c.habitat === "sky" || c.habitat === "space") {
        c.baseY += Math.max(-1, Math.min(1, (best.y - c.baseY) * 8)) * dt * 0.06;
      }
      // 食べる
      const dy = c.habitat === "land" ? 0 : best.y - c.y;
      if (Math.abs(dx) < 0.035 && Math.abs(dy) < 0.07) {
        foods.splice(foods.indexOf(best), 1);
        c.foodTarget = null;
        c.excited = Math.max(c.excited, 0.5);
        burst(best.x * W, best.y * H, "#ff9eb5", 10);
        Sound.fx("munch");
      }
    }
  }

  function drawFoods() {
    for (const f of foods) {
      const x = f.x * W, y = f.y * H;
      const bob = Math.sin(time * 3 + f.phase) * 2;
      if (f.habitat === "sea") {
        ctx.fillStyle = "#c8834a";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x + (i - 1) * 7, y + bob + (i % 2) * 5, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (f.habitat === "land") {
        ctx.fillStyle = "#e74c3c";
        ctx.beginPath();
        ctx.arc(x, y + bob, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#3f9e4f";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y + bob - 7);
        ctx.quadraticCurveTo(x + 6, y + bob - 13, x + 9, y + bob - 10);
        ctx.stroke();
      } else if (f.habitat === "sky") {
        ctx.fillStyle = "#f5d90a";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x + (i - 1) * 8, y + bob + (i % 2) * 4, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        drawStar(x, y + bob, 9, "#ffe36e");
      }
    }
  }

  function drawStar(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  /* ---------------- ふれあい ---------------- */

  function updateGreets(dt) {
    greetTimer += dt;
    if (greetTimer < 0.5 || sky.night > 0.6) return;
    greetTimer = 0;
    for (let i = 0; i < creatures.length; i++) {
      for (let j = i + 1; j < creatures.length; j++) {
        const a = creatures[i], b = creatures[j];
        if (a.habitat !== b.habitat) continue;
        if (time - a.lastGreet < 7 || time - b.lastGreet < 7) continue;
        if (Math.abs(a.x - b.x) > 0.06 || Math.abs(a.y - b.y) > 0.09) continue;
        a.lastGreet = b.lastGreet = time;
        const mx = ((a.x + b.x) / 2) * W;
        const my = ((a.y + b.y) / 2) * H - 30;
        for (let k = 0; k < 3; k++) {
          particles.push({
            kind: "text", text: "💛", x: mx + (k - 1) * 14, y: my,
            vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 30,
            life: 1.2, age: 0, size: 15 + Math.random() * 6,
          });
        }
        Sound.fx("heart");
        if (a.puppet && b.puppet) { a.excited = b.excited = 1; }  // にんげん同士はダンス
        else { a.excited = Math.max(a.excited, 0.35); b.excited = Math.max(b.excited, 0.35); }
      }
    }
  }

  /* ---------------- パーティクル ---------------- */

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 160;
      particles.push({
        kind: "dot",
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

  const CONFETTI_COLORS = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#b980f0", "#ff9f45"];

  function confetti() {
    for (let i = 0; i < 90; i++) {
      particles.push({
        kind: "confetti",
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.3,
        vx: (Math.random() - 0.5) * 40,
        vy: 70 + Math.random() * 120,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8,
        sway: Math.random() * Math.PI * 2,
        life: 3 + Math.random() * 1.5,
        age: 0,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age > p.life) { particles.splice(i, 1); continue; }
      if (p.kind === "confetti") {
        p.x += (p.vx + Math.sin(time * 3 + p.sway) * 40) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      } else {
        if (p.kind === "dot") p.vy += 260 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = a;
      if (p.kind === "confetti") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      } else if (p.kind === "text") {
        ctx.font = `${p.size}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- ランダムイベント ---------------- */

  const EVENT_DUR = { whale: 16, balloon: 26, rainbow: 13, rain: 15, snow: 20, shootingStar: 1.6 };

  function triggerEvent(type) {
    if (!EVENT_DUR[type]) return;
    events.push({
      type, t: 0, dur: EVENT_DUR[type],
      dir: Math.random() < 0.5 ? -1 : 1,
      seed: Math.random(),
      spoutAt: 3,
    });
    if (type === "whale") Sound.fx("splash");
    if (type === "shootingStar") Sound.fx("twinkle");
    if (type === "rain") Sound.fx("rain");
  }

  function updateEvents(dt) {
    if (time >= nextEventAt) {
      const pool = sky.night > 0.6
        ? ["shootingStar", "shootingStar", "shootingStar", "whale"]
        : ["whale", "balloon", "rainbow", "rain", "snow", "shootingStar"];
      triggerEvent(pool[Math.floor(Math.random() * pool.length)]);
      nextEventAt = time + 75 + Math.random() * 105;
    }
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      e.t += dt;
      if (e.type === "whale" && e.t > e.spoutAt) {
        e.spoutAt += 4;
        const p = e.t / e.dur;
        const wx = (e.dir > 0 ? p : 1 - p) * (W + 400) - 200;
        burst(wx, H * (LAYOUT.seaTop + 0.16), "#cfeeff", 12);
        Sound.fx("splash");
      }
      if (e.t > e.dur) events.splice(i, 1);
    }
  }

  function drawEvents(layer) {
    for (const e of events) {
      const p = e.t / e.dur;
      const fade = Math.min(1, Math.min(e.t, e.dur - e.t) * 2);

      if (layer === "sky" && e.type === "balloon") {
        const x = (e.dir > 0 ? p : 1 - p) * (W + 300) - 150;
        const y = H * (0.16 + Math.sin(e.t * 0.7 + e.seed * 6) * 0.03);
        const r = H * 0.05;
        ctx.fillStyle = ["#ff6b6b", "#4d96ff", "#ffd93d"][Math.floor(e.seed * 3)];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(90,70,50,.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y + r * 0.8);
        ctx.lineTo(x - r * 0.3, y + r * 1.5);
        ctx.moveTo(x + r * 0.5, y + r * 0.8);
        ctx.lineTo(x + r * 0.3, y + r * 1.5);
        ctx.stroke();
        ctx.fillStyle = "#8a6642";
        ctx.fillRect(x - r * 0.35, y + r * 1.5, r * 0.7, r * 0.5);
      }

      if (layer === "sky" && e.type === "rainbow") {
        const colors = ["#ff5b5b", "#ff9f45", "#ffd93d", "#6bcb77", "#4d96ff", "#7b6bd6", "#b980f0"];
        ctx.globalAlpha = 0.5 * fade;
        ctx.lineWidth = H * 0.012;
        const cx = W * 0.5, cy = H * 0.62, r0 = H * 0.5;
        colors.forEach((col, i) => {
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.arc(cx, cy, r0 - i * H * 0.013, Math.PI, Math.PI * 2);
          ctx.stroke();
        });
        ctx.globalAlpha = 1;
      }

      if (layer === "sky" && e.type === "shootingStar") {
        const x0 = W * (0.15 + e.seed * 0.6) + p * W * 0.28;
        const y0 = H * 0.05 + p * H * 0.2;
        ctx.strokeStyle = `rgba(255,255,220,${1 - p})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 - 60, y0 - 24);
        ctx.stroke();
        drawStar(x0, y0, 6, `rgba(255,255,220,${1 - p})`);
      }

      if (layer === "sea" && e.type === "whale") {
        const x = (e.dir > 0 ? p : 1 - p) * (W + 400) - 200;
        const y = H * (LAYOUT.seaTop + 0.2) + Math.sin(e.t * 1.2) * 8;
        const k = H / 800;
        ctx.save();
        ctx.translate(x, y);
        if (e.dir < 0) ctx.scale(-1, 1);
        ctx.fillStyle = "rgba(30,60,110,.75)";
        ctx.beginPath();
        ctx.ellipse(0, 0, 150 * k, 55 * k, 0, 0, Math.PI * 2);
        ctx.fill();
        // しっぽ
        const flap = Math.sin(e.t * 3) * 20 * k;
        ctx.beginPath();
        ctx.moveTo(-140 * k, 0);
        ctx.quadraticCurveTo(-190 * k, -30 * k - flap, -215 * k, -45 * k - flap);
        ctx.quadraticCurveTo(-185 * k, 0, -215 * k, 45 * k + flap);
        ctx.quadraticCurveTo(-190 * k, 30 * k + flap, -140 * k, 0);
        ctx.fill();
        ctx.restore();
      }

      if (layer === "front" && (e.type === "rain" || e.type === "snow")) {
        ctx.globalAlpha = 0.7 * fade;
        if (e.type === "rain") {
          ctx.strokeStyle = "rgba(160,200,255,.7)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 60; i++) {
            const rx = ((i * 97 + e.seed * 1000) % 100) / 100 * W;
            const ry = ((i * 61 + time * 320) % (H + 40)) - 20;
            ctx.moveTo(rx, ry);
            ctx.lineTo(rx - 4, ry + 14);
          }
          ctx.stroke();
        } else {
          ctx.fillStyle = "rgba(255,255,255,.9)";
          for (let i = 0; i < 45; i++) {
            const sx = ((i * 89 + e.seed * 1000) % 100) / 100 * W + Math.sin(time * 1.5 + i) * 20;
            const sy = ((i * 53 + time * 60) % (H + 20)) - 10;
            ctx.beginPath();
            ctx.arc(sx, sy, 2.5 + (i % 3), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ---------------- おひろめ演出 ---------------- */

  function creatureLabel(c) {
    const t = TEMPLATES[c.tid];
    if (c.puppet) return "にんげん";
    return t && t.path ? t.name : "え";
  }

  function celebrate(c) {
    const t = TEMPLATES[c.tid];
    const emoji = c.rare ? "✨" : (t ? t.emoji : "🎨");
    const who = c.name ? `${c.name}の ` : "";
    // 演出はワールド時間でなく壁時計基準 (FPS が落ちても長引かない)
    banner = {
      text: `${emoji} ${c.rare ? "きらきら " : ""}${who}${creatureLabel(c)}が やってきた!`,
      t0: performance.now(), dur: 4.2,
    };
    spot = { c, t0: performance.now(), dur: 1.8 };
    confetti();
    Sound.fx(c.rare ? "rare" : "release");
  }

  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function drawBanner() {
    if (!banner) return;
    const t = (performance.now() - banner.t0) / 1000;
    if (t > banner.dur) { banner = null; return; }
    const pop = easeOutBack(Math.min(1, t * 2.6));
    const fade = Math.min(1, (banner.dur - t) * 2);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(W / 2, H * 0.12);
    ctx.scale(pop, pop);
    ctx.font = 'bold 26px "Hiragino Maru Gothic ProN", "BIZ UDGothic", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(banner.text).width;
    const bw = tw + 60, bh = 56;
    ctx.fillStyle = "rgba(255,255,255,.94)";
    ctx.strokeStyle = "#ff8c42";
    ctx.lineWidth = 4;
    roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, 26);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#4a3b2f";
    ctx.fillText(banner.text, 0, 2);
    ctx.restore();
  }

  function drawSpot() {
    if (!spot) return;
    const t = (performance.now() - spot.t0) / 1000;
    if (t > spot.dur) { spot = null; return; }
    const c = spot.c;
    const a = Math.sin(Math.PI * (t / spot.dur)) * 0.45;
    const cx = c.x * W;
    const cy = c.habitat === "land"
      ? H * ((LAYOUT.roadTop + LAYOUT.roadBottom) / 2) - (c.sprite.height * c.scale) / 2
      : c.y * H;
    const r = Math.max(90, c.sprite.width * c.scale * 0.9);
    const g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, Math.max(W, H));
    g.addColorStop(0, "rgba(20,20,40,0)");
    g.addColorStop(1, `rgba(20,20,40,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------- メインループ ---------------- */

  function tick(ts) {
    // 0.1秒クランプ: 10fps を下回らない限りスローモーション化しない
    const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    time += dt;

    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();

    update(dt);
    render();
    requestAnimationFrame(tick);
  }

  function update(dt) {
    sky = skyState();
    if (window.Sound) Sound.setDay(sky.night < 0.5);
    const asleep = sky.night > 0.6;

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

      // にんげんの行動を選ぶ (歩く / スキップ / おじぎ)
      if (c.puppet && (!c.motion || time > c.motion.until)) {
        const r = Math.random();
        const mode = r < 0.55 ? "walk" : r < 0.85 ? "skip" : "bow";
        c.motion = { mode, t0: time, until: time + (mode === "bow" ? 2.6 : 8 + Math.random() * 8) };
      }

      let speedK = 1 + c.excited * 1.6;
      if (asleep) speedK *= 0.12;
      if (c.puppet && c.motion) {
        if (c.motion.mode === "bow") speedK = 0;
        if (c.motion.mode === "skip") speedK *= 1.35;
      }
      c.x += c.dir * c.speed * speedK * dt;

      // 端で折り返し
      const margin = 0.08;
      if (c.x > 1 - margin) { c.x = 1 - margin; c.dir = -1; }
      if (c.x < margin) { c.x = margin; c.dir = 1; }

      if (!c.surface) {
        if (c.habitat === "sea") {
          c.y = c.baseY + Math.sin(time * 0.9 + c.phase) * 0.012;
        } else if (c.habitat === "sky") {
          c.y = c.baseY + Math.sin(time * 1.4 + c.phase) * 0.03;
        } else if (c.habitat === "space") {
          c.y = c.baseY + Math.sin(time * 1.1 + c.phase) * 0.012;
        }
      }

      c.scale = fitScale(c) * easeOutBack(c.born);

      // ロケットの炎
      if (c.habitat === "space" && Math.random() < 0.6) {
        const back = c.x * W - c.dir * c.sprite.width * c.scale * 0.5;
        particles.push({
          kind: "dot",
          x: back, y: c.y * H + (Math.random() - 0.5) * 8,
          vx: -c.dir * (90 + Math.random() * 60), vy: (Math.random() - 0.5) * 26,
          life: 0.35, age: 0, r: 3 + Math.random() * 3,
          color: Math.random() < 0.5 ? "#ff9f45" : "#ffd93d",
        });
      }

      // きらきら個体のオーラ
      if (c.rare && Math.random() < 0.12) {
        particles.push({
          kind: "dot",
          x: c.x * W + (Math.random() - 0.5) * c.sprite.width * c.scale,
          y: c.y * H + (Math.random() - 0.5) * c.sprite.height * c.scale,
          vx: 0, vy: -22, life: 0.8, age: 0, r: 2.5, color: "#ffe36e",
        });
      }
    }

    // 夜: だれかが Zzz
    if (asleep) {
      zzzTimer += dt;
      if (zzzTimer > 2.5 && creatures.length) {
        zzzTimer = 0;
        const c = creatures[Math.floor(Math.random() * creatures.length)];
        particles.push({
          kind: "text", text: "💤",
          x: c.x * W + 14, y: c.y * H - c.sprite.height * c.scale * 0.5,
          vx: 8, vy: -22, life: 1.8, age: 0, size: 16,
        });
      }
    }

    updateFoods(dt);
    updateGreets(dt);
    updateEvents(dt);
    updateParticles(dt);
  }

  /* ---------------- 描画 ---------------- */

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawSky();
    drawEvents("sky");
    drawLand();
    drawSea();
    drawEvents("sea");

    // 夜は陸・海もくらく
    if (sky.night > 0) {
      ctx.fillStyle = `rgba(8,14,50,${sky.night * 0.32})`;
      ctx.fillRect(0, H * 0.40, W, H * 0.60);
    }

    drawFoods();

    // 奥から: 宇宙 → 空 → 陸 → 海
    for (const c of creatures) if (c.habitat === "space") drawCreature(c);
    for (const c of creatures) if (c.habitat === "sky") drawCreature(c);
    for (const c of creatures) if (c.habitat === "land") drawCreature(c);
    for (const c of creatures) if (c.habitat === "sea") drawCreature(c);

    drawEvents("front");
    drawParticles();
    drawSpot();
    drawBanner();
  }

  function drawSky() {
    const skyH = H * LAYOUT.seaTop;
    const dayTop = "#8fd7ff", dayBot = "#e8f8ff";
    const nightTop = "#0b1440", nightBot = "#23345e";
    const g = ctx.createLinearGradient(0, 0, 0, skyH);
    g.addColorStop(0, lerpColor(dayTop, nightTop, sky.night));
    g.addColorStop(1, lerpColor(dayBot, nightBot, sky.night));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, skyH + 2);

    // 夕焼け・朝焼け
    if (sky.dusk > 0) {
      const dg = ctx.createLinearGradient(0, 0, 0, skyH);
      dg.addColorStop(0, "rgba(255,154,92,0)");
      dg.addColorStop(1, `rgba(255,140,80,${sky.dusk * 0.55})`);
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, W, skyH);
    }

    // 宇宙の帯 (いちばん上はいつも宇宙)
    const sg = ctx.createLinearGradient(0, 0, 0, H * (LAYOUT.spaceBottom + 0.04));
    sg.addColorStop(0, "rgba(16,20,60,0.95)");
    sg.addColorStop(1, "rgba(16,20,60,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H * (LAYOUT.spaceBottom + 0.04));

    // 星: 宇宙帯は常時、空全体は夜だけ
    for (const st of stars) {
      const inSpace = st.y < LAYOUT.spaceBottom;
      const a = inSpace ? 0.9 : sky.night;
      if (a <= 0.02) continue;
      const tw = 0.6 + 0.4 * Math.sin(time * 2 + st.tw);
      ctx.fillStyle = `rgba(255,255,235,${a * tw})`;
      ctx.beginPath();
      ctx.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 太陽 (昼) / 月 (夜)
    const sr = Math.min(W, H) * 0.05;
    if (sky.night < 0.85) {
      const sunT = Math.max(0, Math.min(1, (sky.h - 6) / 12));   // 6時→18時
      const sx = W * (0.12 + sunT * 0.76);
      const sy = H * (0.30 - Math.sin(sunT * Math.PI) * 0.16);
      ctx.globalAlpha = 1 - sky.night;
      ctx.fillStyle = "rgba(255, 220, 110, 0.35)";
      ctx.beginPath(); ctx.arc(sx, sy, sr * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd76e";
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (sky.night > 0.15) {
      const mx = W * 0.8, my = H * 0.15;
      ctx.globalAlpha = sky.night;
      ctx.fillStyle = "#f4f1de";
      ctx.beginPath(); ctx.arc(mx, my, sr * 0.85, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lerpColor("#8fd7ff", "#0b1440", sky.night);
      ctx.beginPath(); ctx.arc(mx - sr * 0.35, my - sr * 0.2, sr * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 雲
    ctx.globalAlpha = 1 - sky.night * 0.6;
    for (const cl of clouds) drawCloud(cl.x * W, cl.y * H, cl.s * Math.min(W, H) * 0.001);
    ctx.globalAlpha = 1;
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

  function waveYAt(x) {
    return H * LAYOUT.seaTop + Math.sin(x * 0.025 + time * 1.8) * 5;
  }

  function drawSea() {
    const top = H * LAYOUT.seaTop;

    // 波打つ海面
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, top);
    for (let x = 0; x <= W; x += 14) ctx.lineTo(x, waveYAt(x));
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
      const y = waveYAt(x);
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

    // 夜の海は生きものがほんのり光る
    if (c.habitat === "sea" && !c.surface && sky.night > 0.4) {
      const r = c.sprite.width * c.scale * 0.7;
      const g = ctx.createRadialGradient(cx, c.y * H, r * 0.2, cx, c.y * H, r);
      g.addColorStop(0, `rgba(150,220,255,${0.25 * sky.night})`);
      g.addColorStop(1, "rgba(150,220,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, c.y * H, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // きらきら個体は金色のオーラ
    if (c.rare) {
      const pulse = 0.7 + 0.3 * Math.sin(time * 4 + c.phase);
      const cy0 = c.habitat === "land"
        ? H * ((LAYOUT.roadTop + LAYOUT.roadBottom) / 2) - (c.sprite.height * c.scale) / 2
        : c.y * H;
      const r = c.sprite.width * c.scale * 0.65 * pulse;
      const g = ctx.createRadialGradient(cx, cy0, r * 0.3, cx, cy0, r);
      g.addColorStop(0, "rgba(255,220,110,0.28)");
      g.addColorStop(1, "rgba(255,220,110,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy0, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();

    if (c.surface) {
      drawBoat(c, cx);
      ctx.restore();
      drawNameTag(c, cx, waveYAt(cx) - c.sprite.height * c.scale * 0.6);
      return;
    }

    if (c.habitat === "land") {
      if (c.puppet) drawPuppet(c, cx);
      else drawDrive(c, cx);
      ctx.restore();
      drawNameTag(c, cx, H * ((LAYOUT.roadTop + LAYOUT.roadBottom) / 2) - c.sprite.height * c.scale - 12);
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
    } else if (c.habitat === "space") {
      ctx.rotate(Math.sin(time * 1.1 + c.phase) * 0.06);
      drawPlain(c);
    } else {
      drawSwim(c);
    }

    ctx.restore();
    drawNameTag(c, cx, c.y * H - c.sprite.height * c.scale * 0.5 - 12);
  }

  function drawNameTag(c, cx, topY) {
    if (!c.name || c.excited <= 0.05) return;
    const a = Math.min(1, c.excited * 2);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = 'bold 15px "Hiragino Maru Gothic ProN", "BIZ UDGothic", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(c.name).width;
    roundRectPath(ctx, cx - tw / 2 - 10, topY - 14, tw + 20, 26, 13);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fill();
    ctx.fillStyle = "#4a3b2f";
    ctx.fillText(c.name, cx, topY);
    ctx.restore();
  }

  function drawPlain(c) {
    const spr = c.sprite;
    ctx.drawImage(
      spr,
      (-spr.width / 2) * c.scale,
      (-spr.height / 2) * c.scale,
      spr.width * c.scale,
      spr.height * c.scale
    );
  }

  /* ふね: 波の上でゆれる */
  function drawBoat(c, cx) {
    const spr = c.sprite;
    const wy = waveYAt(cx);
    // 波の傾きにあわせてロッキング
    const slope = Math.cos(cx * 0.025 + time * 1.8) * 5 * 0.025;
    ctx.translate(cx, wy);
    const facingSign = c.facing === "left" ? -1 : 1;
    if (c.dir !== facingSign) ctx.scale(-1, 1);
    ctx.rotate(Math.atan(slope) * 0.8 + Math.sin(time * 1.2 + c.phase) * 0.04);
    ctx.drawImage(
      spr,
      (-spr.width / 2) * c.scale,
      (-spr.height + spr.height * 0.13) * c.scale,   // 船底を少し沈める
      spr.width * c.scale,
      spr.height * c.scale
    );
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
   * walk / skip / bow の行動 + タップでダンス + 夜は立ったまま居眠り */
  function drawPuppet(c, cx) {
    const box = c.sprite;
    const roadY = H * ((LAYOUT.roadTop + LAYOUT.roadBottom) / 2) + 6;
    const d = Math.min(1, c.excited * 1.4);   // 0=通常 1=ダンス
    const wp = time * 6.5 + c.phase;
    const dp = time * 9 + c.phase;
    const asleep = sky.night > 0.6;
    const mode = asleep ? "sleep" : (c.motion ? c.motion.mode : "walk");

    let base;
    if (mode === "sleep") {
      base = {
        thighR: 0, thighL: 0, shinR: 0.05, shinL: 0.05,
        armR: 0.6, armL: -0.6, foreR: -0.1, foreL: 0.1,
        body: 0.08 + Math.sin(time * 1.2 + c.phase) * 0.03,
        lean: 0, hop: 0,
      };
    } else if (mode === "bow") {
      const bt = Math.min(1, (time - c.motion.t0) / 2.6);
      const bow = Math.sin(Math.PI * bt) * 0.85;      // おじぎして戻る
      base = {
        thighR: 0, thighL: 0, shinR: 0.05, shinL: 0.05,
        armR: 0.5, armL: -0.5, foreR: -0.1, foreL: 0.1,
        body: bow, lean: 0, hop: 0,
      };
    } else if (mode === "skip") {
      base = {
        thighR: Math.sin(wp) * 0.55,
        thighL: Math.sin(wp + Math.PI) * 0.55,
        shinR: 0.15 + Math.max(0, Math.sin(wp - 1.4)) * 0.75,
        shinL: 0.15 + Math.max(0, Math.sin(wp + Math.PI - 1.4)) * 0.75,
        armR: 0.35 + Math.sin(wp) * 0.45,             // 両うでを同時に振る
        armL: -0.35 + Math.sin(wp) * 0.45,
        foreR: -0.5, foreL: 0.5,
        body: 0.05 + Math.sin(wp * 2) * 0.03,
        lean: 0.05,
        hop: Math.abs(Math.sin(wp)) * 30,
      };
    } else {
      base = {
        thighR: Math.sin(wp) * 0.5,
        thighL: Math.sin(wp + Math.PI) * 0.5,
        shinR: 0.08 + Math.max(0, Math.sin(wp - 1.4)) * 0.7,
        shinL: 0.08 + Math.max(0, Math.sin(wp + Math.PI - 1.4)) * 0.7,
        armR: 0.55 + Math.sin(wp + Math.PI) * 0.3,    // 体側に下ろして前後に振る
        armL: -0.55 + Math.sin(wp) * 0.3,
        foreR: -0.35, foreL: 0.35,
        body: 0.04,
        lean: 0.05,
        hop: Math.abs(Math.sin(wp)) * 14,
      };
    }
    const dance = {
      thighR: Math.sin(dp) * 0.15,
      thighL: -Math.sin(dp) * 0.15,
      shinR: 0.15, shinL: 0.15,
      armR: -1.95 + Math.sin(dp) * 0.4,               // ばんざいして振る
      armL: 1.95 - Math.sin(dp + 0.6) * 0.4,
      foreR: -0.3 + Math.sin(dp + 1) * 0.4,
      foreL: 0.3 - Math.sin(dp + 1.6) * 0.4,
      body: Math.sin(dp * 0.5) * 0.16,
      lean: 0,
      hop: Math.abs(Math.sin(dp)) * 40,
    };
    const mix = k => base[k] * (1 - d) + dance[k] * d;
    const angles = {
      thighR: mix("thighR"), thighL: mix("thighL"),
      shinR: mix("shinR"), shinL: mix("shinL"),
      armR: mix("armR"), armL: mix("armL"),
      foreR: mix("foreR"), foreL: mix("foreL"),
      body: mix("body"),
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
        ctx.rotate(angles[angleKey] || 0);
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
    const slow = sky.night > 0.6 ? 0.25 : 1;
    const p = Math.sin(time * (6 + c.excited * 4) * slow + c.phase);
    const hop = Math.max(0, p) * spr.height * c.scale * (0.06 + c.excited * 0.25) * slow;

    let sx = 1, sy = 1;
    if (p < 0) { sy = 1 - 0.10 * -p * slow; sx = 1 + 0.10 * -p * slow; }   // 接地: つぶれる
    else       { sy = 1 + 0.05 * p * slow;  sx = 1 - 0.05 * p * slow; }    // 空中: 伸びる

    ctx.translate(cx, roadY - hop);
    const facingSign = c.facing === "left" ? -1 : 1;
    if (c.dir !== facingSign) ctx.scale(-1, 1);
    if (c.spin > 0) ctx.rotate(c.spin);
    ctx.rotate(p * 0.03 * slow);
    ctx.scale(sx, sy);
    ctx.drawImage(
      spr,
      (-spr.width / 2) * c.scale,
      -spr.height * c.scale,
      spr.width * c.scale,
      spr.height * c.scale
    );
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

  /* ---------------- 保存 / 復元 ----------------
   * サーバ (/api/creatures) があればそちらへ永続化し、他の端末で
   * 追加された生きものもポーリングで取り込む (ブース構成)。
   * サーバが無ければ従来どおり localStorage に保存する */

  const STORE_KEY = "oekaki-planet-creatures-v1";
  let storeMode = "local";        // 'server' = 保存サーバあり
  const knownIds = new Set();

  function creatureRecord(c) {
    // 保存サイズを抑えるため縮小して保存
    const small = document.createElement("canvas");
    const s = 280 / c.sprite.width;
    small.width = 280;
    small.height = Math.round(c.sprite.height * s);
    small.getContext("2d").drawImage(c.sprite, 0, 0, small.width, small.height);
    const rec = { tid: c.tid, habitat: c.habitat, data: small.toDataURL("image/png"), ts: Date.now() };
    if (c.jointsN) rec.joints = c.jointsN;
    if (c.name) rec.name = c.name;
    if (c.rare) rec.rare = true;
    return rec;
  }

  function persist(c) {
    if (storeMode === "server") {
      fetch("/api/creatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creatureRecord(c)),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(res => {
          if (res && res.id) {
            c.storeId = res.id;
            knownIds.add(res.id);
          }
        })
        .catch(() => {});
    } else {
      saveLocal();
    }
  }

  function saveLocal() {
    try {
      const list = creatures.slice(-12).map(creatureRecord);
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (e) { /* 容量オーバーなどは無視 */ }
  }

  function spawnRecord(item, celebrateNew) {
    if (!TEMPLATES[item.tid]) return;
    const img = new Image();
    img.onload = () => {
      const spr = document.createElement("canvas");
      spr.width = img.width;
      spr.height = img.height;
      spr.getContext("2d").drawImage(img, 0, 0);
      addCreature(item.tid, spr, {
        habitat: item.habitat,
        joints: item.joints,
        name: item.name,
        rare: item.rare,
        fromStore: true,
        celebrate: celebrateNew,
      });
    };
    img.src = item.data;
  }

  async function load() {
    try {
      if (location.protocol === "file:") throw new Error("no server on file:");
      const r = await fetch("/api/creatures", { cache: "no-store" });
      if (r.ok) {
        storeMode = "server";
        const body = await r.json();
        for (const item of body.creatures) {
          knownIds.add(item.id);
          spawnRecord(item, false);
        }
        setInterval(pollServer, 3000);
        return;
      }
    } catch (e) { /* サーバなし → localStorage へ */ }
    let list;
    try {
      list = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    } catch (e) { return; }
    for (const item of list) spawnRecord(item, false);
  }

  async function pollServer() {
    try {
      const r = await fetch("/api/creatures", { cache: "no-store" });
      if (!r.ok) return;
      const body = await r.json();
      for (const item of body.creatures) {
        if (knownIds.has(item.id)) continue;
        knownIds.add(item.id);
        spawnRecord(item, true);      // 他の端末からの新入り → おひろめ演出
      }
    } catch (e) { /* 一時的なエラーは無視 */ }
  }

  /* テスト・デバッグ用の内部状態スナップショット */
  function _state() {
    return {
      sky, hourOverride,
      foods: foods.length,
      events: events.map(e => e.type),
      particles: particles.length,
    };
  }

  return { init, addCreature, addSample, clearCreatures, count, load, triggerEvent, _state };
})();
