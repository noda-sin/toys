/* =========================================================
 * app.js
 * 画面遷移・印刷・スキャン UI・画面おえかき の制御
 * ========================================================= */

"use strict";

(() => {

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* ================= タブ切り替え ================= */

  function showView(name) {
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === name));
    $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  }

  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.view);
      if (btn.dataset.view === "zukan") renderZukan();
    });
  });

  /* ================= ずかん ================= */

  async function fetchRecords() {
    try {
      if (location.protocol !== "file:") {
        const r = await fetch("/api/creatures", { cache: "no-store" });
        if (r.ok) return (await r.json()).creatures;
      }
    } catch (e) { /* サーバなし */ }
    try {
      return JSON.parse(localStorage.getItem("oekaki-planet-creatures-v1") || "[]");
    } catch (e) {
      return [];
    }
  }

  async function renderZukan() {
    const grid = $("#zukan-grid");
    const records = (await fetchRecords()).slice().reverse();
    $("#zukan-count").textContent = records.length
      ? `いままでに ${records.length}ひき はなたれたよ`
      : "まだ だれも いないよ。スキャンして ふやそう!";
    grid.innerHTML = "";
    for (const rec of records) {
      const t = TEMPLATES[rec.tid];
      const card = document.createElement("div");
      card.className = "zukan-card";
      const img = document.createElement("img");
      img.src = rec.data;
      img.alt = rec.name || "";
      const name = document.createElement("div");
      name.className = "z-name";
      name.textContent = rec.name || "(なまえなし)";
      const meta = document.createElement("div");
      meta.className = "z-meta";
      const kind = rec.joints ? "🕺 にんげん" : t ? `${t.emoji} ${t.name}` : "え";
      const when = rec.ts ? new Date(rec.ts).toLocaleDateString("ja-JP") : "";
      meta.textContent = `${kind} ${when}`;
      card.append(img, name, meta);
      if (rec.rare) {
        const star = document.createElement("div");
        star.className = "z-rare";
        star.textContent = "✨";
        card.append(star);
      }
      grid.append(card);
    }
  }

  /* ================= ワールド ================= */

  World.init($("#world-canvas"));
  World.load();
  setTimeout(() => {
    // まだ誰もいなければサンプルを泳がせておく
    if (World.count() === 0) {
      World.addSample();
      World.addSample();
      World.addSample();
    }
  }, 600);

  $("#btn-sample").addEventListener("click", () => World.addSample());
  $("#btn-clear-world").addEventListener("click", () => {
    if (confirm("ぜんぶ けしても いい?")) World.clearCreatures();
  });

  /* ================= 印刷 ================= */

  function buildPrintCards() {
    const row = $("#print-cards");
    for (const tid of TEMPLATE_IDS) {
      const t = TEMPLATES[tid];
      const card = document.createElement("div");
      card.className = "tmpl-card";
      const thumb = document.createElement("canvas");
      renderThumb(thumb, t, 300);
      const name = document.createElement("div");
      name.className = "tmpl-name";
      name.textContent = `${t.emoji} ${t.name}`;
      const btn = document.createElement("button");
      btn.className = "big-btn";
      btn.textContent = "🖨️ いんさつ";
      btn.addEventListener("click", () => printSheet(t));
      card.append(thumb, name, btn);
      row.append(card);
    }
  }

  function printSheet(t) {
    const c = document.createElement("canvas");
    renderSheet(c, t, 2);
    const img = $("#print-img");
    img.onload = () => {
      window.print();
      img.onload = null;
    };
    img.src = c.toDataURL("image/png");
  }

  buildPrintCards();

  /* ================= テンプレート選択チップ ================= */

  function buildChips(containerSel, onSelect) {
    const row = $(containerSel);
    let selected = TEMPLATE_IDS[0];
    for (const tid of TEMPLATE_IDS) {
      const t = TEMPLATES[tid];
      const b = document.createElement("button");
      b.className = "tmpl-chip" + (tid === selected ? " active" : "");
      b.textContent = `${t.emoji} ${t.name}`;
      b.dataset.tid = tid;
      b.addEventListener("click", () => {
        selected = tid;
        row.querySelectorAll(".tmpl-chip").forEach(x =>
          x.classList.toggle("active", x.dataset.tid === tid));
        onSelect(tid);
      });
      row.append(b);
    }
    return () => selected;
  }

  /* ================= 音 ================= */

  document.addEventListener("pointerdown", () => Sound.resume());

  const soundBtn = $("#btn-sound");
  function renderSoundBtn() {
    soundBtn.textContent = Sound.isMuted() ? "🔇" : "🔊";
  }
  soundBtn.addEventListener("click", () => {
    Sound.toggleMute();
    renderSoundBtn();
  });
  renderSoundBtn();

  /* ================= キオスクモード (プロジェクター常設用) ================= */

  if (new URLSearchParams(location.search).has("kiosk")) {
    document.body.classList.add("kiosk");
    $("#world-hint").textContent = `スマホで ${location.origin} を ひらいて スキャンしよう!`;
  }

  /* ================= 行き先ピッカー (じゆうモード用) ================= */

  const HABITATS = [
    { id: "sea", name: "うみ", emoji: "🌊" },
    { id: "sky", name: "そら", emoji: "☁️" },
    { id: "land", name: "りく", emoji: "🛣️" },
    { id: "space", name: "うちゅう", emoji: "🌌" },
    { id: "human", name: "にんげんにする", emoji: "🕺" },
  ];

  /* 放流オプション: 名前 + きらきら抽選 + おひろめ演出 */
  function releaseOpts(nameInputSel) {
    const input = $(nameInputSel);
    const name = input.value.trim().slice(0, 10);
    input.value = "";
    return { name, rare: Math.random() < 0.125, celebrate: true };
  }

  function buildHabitatChips(containerSel) {
    const row = $(containerSel);
    let selected = "sea";
    for (const hb of HABITATS) {
      const b = document.createElement("button");
      b.className = "tmpl-chip" + (hb.id === selected ? " active" : "");
      b.textContent = `${hb.emoji} ${hb.name}`;
      b.dataset.hid = hb.id;
      b.addEventListener("click", () => {
        selected = hb.id;
        row.querySelectorAll(".tmpl-chip").forEach(x =>
          x.classList.toggle("active", x.dataset.hid === hb.id));
      });
      row.append(b);
    }
    return () => selected;
  }

  const getScanHabitat = buildHabitatChips("#scan-habitat");
  const getDrawHabitat = buildHabitatChips("#draw-habitat");

  /* ================= にんげんリグ確認エディタ =================
   * じゆう描画を「にんげん」として放つとき、関節位置を決める。
   * まず /api/pose (AnimatedDrawings のポーズ推定) に自動配置を頼み、
   * サービスが無い/失敗したら標準骨格を初期値にする。
   * どちらの場合もドットをドラッグして手で直せる (Meta のデモと同じ流儀) */

  const RIG_BONES = [
    ["headTop", "hips"], ["shoulderL", "shoulderR"], ["hipL", "hipR"],
    ["shoulderR", "elbowR"], ["elbowR", "wristR"],
    ["shoulderL", "elbowL"], ["elbowL", "wristL"],
    ["hipR", "kneeR"], ["kneeR", "ankleR"],
    ["hipL", "kneeL"], ["kneeL", "ankleL"],
  ];

  const rigModal = $("#rig-modal");
  const rigCanvas = $("#rig-canvas");
  let rigJoints = null;     // 表示座標系 {name: [x,y]}
  let rigSprite = null;
  let rigDrag = null;
  let rigResolve = null;

  async function fetchAutoJoints(sprite) {
    try {
      const r = await fetch("/api/pose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: sprite.toDataURL("image/png") }),
      });
      if (!r.ok) return null;
      const body = await r.json();
      return body.joints || null;
    } catch (e) {
      return null;
    }
  }

  /* sprite を表示し、正規化関節 (0..1) を返す。キャンセルで null */
  async function editRig(sprite) {
    rigSprite = sprite;
    const maxW = Math.min(430, window.innerWidth - 80);
    const maxH = window.innerHeight * 0.52;
    const s = Math.min(maxW / sprite.width, maxH / sprite.height);
    rigCanvas.width = Math.round(sprite.width * s);
    rigCanvas.height = Math.round(sprite.height * s);

    rigModal.classList.remove("hidden");
    $("#rig-msg").textContent = "🤖 ほねを かんがえちゅう…";

    const auto = await fetchAutoJoints(sprite);   // ML 自動配置 (無ければ null)
    const jointsN = auto || DEFAULT_JOINTS_N;
    $("#rig-msg").textContent = auto
      ? "✨ ほねを つけたよ! ずれていたら ● を うごかしてね"
      : "ほねの ● を えの かんせつに あわせてね";

    rigJoints = {};
    for (const k in DEFAULT_JOINTS_N) {
      const p = jointsN[k] || DEFAULT_JOINTS_N[k];
      rigJoints[k] = [p[0] * rigCanvas.width, p[1] * rigCanvas.height];
    }
    drawRig();

    return new Promise(resolve => { rigResolve = resolve; });
  }

  function drawRig() {
    const ctx = rigCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rigCanvas.width, rigCanvas.height);
    ctx.drawImage(rigSprite, 0, 0, rigCanvas.width, rigCanvas.height);
    if (!rigJoints) return;
    ctx.strokeStyle = "rgba(74,163,223,0.9)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const [a, b] of RIG_BONES) {
      ctx.beginPath();
      ctx.moveTo(rigJoints[a][0], rigJoints[a][1]);
      ctx.lineTo(rigJoints[b][0], rigJoints[b][1]);
      ctx.stroke();
    }
    for (const k in rigJoints) {
      const side = k.endsWith("R") ? "#e74c3c" : k.endsWith("L") ? "#3498db" : "#ff8c42";
      ctx.fillStyle = side;
      ctx.beginPath();
      ctx.arc(rigJoints[k][0], rigJoints[k][1], 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  function rigPos(ev) {
    const rect = rigCanvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (rigCanvas.width / rect.width),
      y: (ev.clientY - rect.top) * (rigCanvas.height / rect.height),
    };
  }

  rigCanvas.addEventListener("pointerdown", ev => {
    if (!rigJoints) return;
    const p = rigPos(ev);
    let best = null, bestD = 26;
    for (const k in rigJoints) {
      const d = Math.hypot(rigJoints[k][0] - p.x, rigJoints[k][1] - p.y);
      if (d < bestD) { bestD = d; best = k; }
    }
    rigDrag = best;
    if (rigDrag) rigCanvas.setPointerCapture(ev.pointerId);
  });

  rigCanvas.addEventListener("pointermove", ev => {
    if (!rigDrag || !rigJoints) return;
    const p = rigPos(ev);
    rigJoints[rigDrag][0] = Math.max(0, Math.min(rigCanvas.width, p.x));
    rigJoints[rigDrag][1] = Math.max(0, Math.min(rigCanvas.height, p.y));
    drawRig();
  });

  rigCanvas.addEventListener("pointerup", () => { rigDrag = null; });

  $("#btn-rig-ok").addEventListener("click", () => {
    if (!rigResolve) return;
    const out = {};
    for (const k in rigJoints) {
      out[k] = [rigJoints[k][0] / rigCanvas.width, rigJoints[k][1] / rigCanvas.height];
    }
    rigModal.classList.add("hidden");
    const resolve = rigResolve;
    rigResolve = null;
    resolve(out);
  });

  $("#btn-rig-cancel").addEventListener("click", () => {
    if (!rigResolve) return;
    rigModal.classList.add("hidden");
    const resolve = rigResolve;
    rigResolve = null;
    resolve(null);
  });

  /* ================= スキャン ================= */

  const getScanTid = buildChips("#scan-template-chips", () => {});

  const adjustCanvas = $("#adjust-canvas");
  const adjustCtx = adjustCanvas.getContext("2d");

  let photoCanvas = null;      // 元写真 (縮小済み)
  let corners = null;          // adjustCanvas 表示座標系の 4 点 [TL,TR,BR,BL]
  let dragIdx = -1;
  let scannedSprite = null;

  $("#scan-file").addEventListener("change", async ev => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    let img;
    try {
      img = await Scan.loadImage(file);
    } catch (e) {
      alert("しゃしんが よみこめなかったよ。もういちど ためしてね。");
      return;
    }
    photoCanvas = Scan.toCanvas(img, 1600);

    // 表示用キャンバス
    const dispW = Math.min(640, photoCanvas.width);
    const s = dispW / photoCanvas.width;
    adjustCanvas.width = dispW;
    adjustCanvas.height = Math.round(photoCanvas.height * s);

    // マーカー自動検出
    const detected = Scan.detectMarkers(photoCanvas);
    if (detected) {
      corners = detected.map(p => ({ x: p.x * s, y: p.y * s }));
      $("#adjust-msg").textContent = "✅ マークを みつけたよ! ずれていたら ● を うごかしてね。";
    } else {
      const w = adjustCanvas.width, h = adjustCanvas.height;
      corners = [
        { x: w * 0.15, y: h * 0.12 }, { x: w * 0.85, y: h * 0.12 },
        { x: w * 0.85, y: h * 0.88 }, { x: w * 0.15, y: h * 0.88 },
      ];
      $("#adjust-msg").textContent = "⚠️ マークが みつからなかったよ。● を 4つの ■ マークに あわせてね。";
    }

    drawAdjust();
    $("#scan-step-adjust").classList.remove("hidden");
    $("#scan-step-preview").classList.add("hidden");
  });

  function drawAdjust() {
    adjustCtx.setTransform(1, 0, 0, 1, 0, 0);
    adjustCtx.drawImage(photoCanvas, 0, 0, adjustCanvas.width, adjustCanvas.height);
    if (!corners) return;
    // 枠線
    adjustCtx.strokeStyle = "#ff8c42";
    adjustCtx.lineWidth = 3;
    adjustCtx.beginPath();
    corners.forEach((p, i) => i === 0 ? adjustCtx.moveTo(p.x, p.y) : adjustCtx.lineTo(p.x, p.y));
    adjustCtx.closePath();
    adjustCtx.stroke();
    // ハンドル
    const labels = ["1", "2", "3", "4"];
    corners.forEach((p, i) => {
      adjustCtx.fillStyle = "rgba(255,140,66,0.9)";
      adjustCtx.beginPath();
      adjustCtx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      adjustCtx.fill();
      adjustCtx.strokeStyle = "#fff";
      adjustCtx.lineWidth = 3;
      adjustCtx.stroke();
      adjustCtx.fillStyle = "#fff";
      adjustCtx.font = "bold 14px sans-serif";
      adjustCtx.textAlign = "center";
      adjustCtx.textBaseline = "middle";
      adjustCtx.fillText(labels[i], p.x, p.y);
    });
  }

  function canvasPos(ev) {
    const rect = adjustCanvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (adjustCanvas.width / rect.width),
      y: (ev.clientY - rect.top) * (adjustCanvas.height / rect.height),
    };
  }

  adjustCanvas.addEventListener("pointerdown", ev => {
    if (!corners) return;
    const p = canvasPos(ev);
    let best = -1, bestD = 40;
    corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    dragIdx = best;
    if (dragIdx >= 0) adjustCanvas.setPointerCapture(ev.pointerId);
  });

  adjustCanvas.addEventListener("pointermove", ev => {
    if (dragIdx < 0 || !corners) return;
    const p = canvasPos(ev);
    corners[dragIdx].x = Math.max(0, Math.min(adjustCanvas.width, p.x));
    corners[dragIdx].y = Math.max(0, Math.min(adjustCanvas.height, p.y));
    drawAdjust();
  });

  adjustCanvas.addEventListener("pointerup", () => { dragIdx = -1; });

  $("#btn-retake").addEventListener("click", () => {
    $("#scan-step-adjust").classList.add("hidden");
    $("#scan-step-preview").classList.add("hidden");
  });

  $("#btn-do-scan").addEventListener("click", () => {
    if (!photoCanvas || !corners) return;
    const t = TEMPLATES[getScanTid()];
    const s = photoCanvas.width / adjustCanvas.width;
    const photoPts = corners.map(p => ({ x: p.x * s, y: p.y * s }));
    let sheet;
    try {
      sheet = Scan.warpToSheet(photoCanvas, photoPts, 0.5);
    } catch (e) {
      alert("よみとりに しっぱいしたよ。● の いちを たしかめてね。");
      return;
    }
    if (t.path) {
      scannedSprite = Scan.extractSprite(sheet, t);
    } else {
      scannedSprite = Scan.extractFreeSprite(sheet);
      if (!scannedSprite) {
        alert("えが みつからなかったよ。ふとい せんで おおきく かいてみてね。");
        return;
      }
    }
    $("#scan-habitat-row").classList.toggle("hidden", !!t.path);

    const pv = $("#preview-canvas");
    pv.width = scannedSprite.width;
    pv.height = scannedSprite.height;
    pv.getContext("2d").drawImage(scannedSprite, 0, 0);

    $("#scan-step-preview").classList.remove("hidden");
    $("#scan-step-preview").scrollIntoView({ behavior: "smooth" });
  });

  $("#btn-rescan").addEventListener("click", () => {
    $("#scan-step-preview").classList.add("hidden");
  });

  $("#btn-release").addEventListener("click", async () => {
    if (!scannedSprite) return;
    const tid = getScanTid();
    let opts = {};
    if (!TEMPLATES[tid].path) {
      const hb = getScanHabitat();
      if (hb === "human") {
        const joints = await editRig(scannedSprite);
        if (!joints) return;                       // キャンセルなら放流しない
        opts = { habitat: "land", joints };
      } else {
        opts = { habitat: hb };
      }
    }
    Object.assign(opts, releaseOpts("#scan-name"));
    World.addCreature(tid, scannedSprite, opts);
    scannedSprite = null;
    $("#scan-step-adjust").classList.add("hidden");
    $("#scan-step-preview").classList.add("hidden");
    showView("world");
  });

  /* ================= 画面でおえかき ================= */

  const drawCanvas = $("#draw-canvas");
  const drawCtx = drawCanvas.getContext("2d");
  let strokes = null;          // ユーザーの塗りだけを持つオフスクリーン
  let strokesCtx = null;
  let drawTid = TEMPLATE_IDS[0];
  let brushColor = "#e74c3c";
  let brushSize = 26;
  let erasing = false;
  let drawing = false;
  let lastPt = null;

  const PALETTE = [
    "#e74c3c", "#ff8c42", "#f5d90a", "#7ac74f", "#1abc9c",
    "#3498db", "#7d5fff", "#e84393", "#8d6e63", "#111111",
    "#ffffff", "#95a5a6",
  ];

  function setupDrawTemplate(tid) {
    drawTid = tid;
    const t = TEMPLATES[tid];
    drawCanvas.width = t.box.w;
    drawCanvas.height = t.box.h;
    strokes = document.createElement("canvas");
    strokes.width = t.box.w;
    strokes.height = t.box.h;
    strokesCtx = strokes.getContext("2d");
    $("#draw-habitat-row").classList.toggle("hidden", !!t.path);
    renderDrawCanvas();
  }

  function renderDrawCanvas() {
    const t = TEMPLATES[drawTid];
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.fillStyle = "#ffffff";
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (!t.path) {
      // じゆうモード: 点線のガイドわくのみ
      drawCtx.strokeStyle = "#cccccc";
      drawCtx.lineWidth = 4;
      drawCtx.setLineDash([16, 12]);
      roundRectPath(drawCtx, 12, 12, drawCanvas.width - 24, drawCanvas.height - 24, 24);
      drawCtx.stroke();
      drawCtx.setLineDash([]);
      drawCtx.drawImage(strokes, 0, 0);
      return;
    }
    const path = t.path();
    drawCtx.drawImage(strokes, 0, 0);
    drawCtx.strokeStyle = "#000000";
    drawCtx.lineWidth = 10;
    drawCtx.lineJoin = "round";
    drawCtx.stroke(path);
    drawCtx.lineWidth = 5;
    drawCtx.fillStyle = "#000000";
    t.decor(drawCtx);
  }

  const getDrawTid = buildChips("#draw-template-chips", tid => setupDrawTemplate(tid));

  // パレット
  const paletteEl = $("#palette");
  PALETTE.forEach((col, i) => {
    const b = document.createElement("button");
    b.className = "pal-color" + (i === 0 ? " active" : "");
    b.style.background = col;
    b.addEventListener("click", () => {
      brushColor = col;
      erasing = false;
      $("#btn-eraser").classList.remove("active");
      paletteEl.querySelectorAll(".pal-color").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
    paletteEl.append(b);
  });

  // ブラシサイズ
  const SIZES = [14, 26, 46];
  const sizesEl = $("#brush-sizes");
  SIZES.forEach((sz, i) => {
    const b = document.createElement("button");
    b.className = "brush-btn" + (i === 1 ? " active" : "");
    const px = 26 + i * 8;
    b.style.width = b.style.height = px + "px";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.width = dot.style.height = (6 + i * 5) + "px";
    b.append(dot);
    b.addEventListener("click", () => {
      brushSize = sz;
      sizesEl.querySelectorAll(".brush-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
    sizesEl.append(b);
  });

  $("#btn-eraser").addEventListener("click", () => {
    erasing = !erasing;
    $("#btn-eraser").classList.toggle("active", erasing);
  });

  $("#btn-clear-draw").addEventListener("click", () => {
    strokesCtx.clearRect(0, 0, strokes.width, strokes.height);
    renderDrawCanvas();
  });

  function drawPos(ev) {
    const rect = drawCanvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (drawCanvas.width / rect.width),
      y: (ev.clientY - rect.top) * (drawCanvas.height / rect.height),
    };
  }

  function strokeTo(p) {
    strokesCtx.lineCap = "round";
    strokesCtx.lineJoin = "round";
    strokesCtx.lineWidth = brushSize;
    if (erasing) {
      strokesCtx.globalCompositeOperation = "destination-out";
      strokesCtx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      strokesCtx.globalCompositeOperation = "source-over";
      strokesCtx.strokeStyle = brushColor;
    }
    strokesCtx.beginPath();
    strokesCtx.moveTo(lastPt.x, lastPt.y);
    strokesCtx.lineTo(p.x, p.y);
    strokesCtx.stroke();
    lastPt = p;
    renderDrawCanvas();
  }

  drawCanvas.addEventListener("pointerdown", ev => {
    drawing = true;
    lastPt = drawPos(ev);
    strokeTo({ x: lastPt.x + 0.01, y: lastPt.y });
    drawCanvas.setPointerCapture(ev.pointerId);
  });

  drawCanvas.addEventListener("pointermove", ev => {
    if (!drawing) return;
    strokeTo(drawPos(ev));
  });

  drawCanvas.addEventListener("pointerup", () => { drawing = false; });

  $("#btn-draw-release").addEventListener("click", async () => {
    const t = TEMPLATES[drawTid];
    let spr;
    if (t.path) {
      // 紙と同じ構成: 白地 + ユーザーの塗り + 輪郭
      const path = t.path();
      spr = document.createElement("canvas");
      spr.width = t.box.w;
      spr.height = t.box.h;
      const sctx = spr.getContext("2d");
      sctx.fillStyle = "#ffffff";
      sctx.fill(path);
      sctx.save();
      sctx.clip(path);
      sctx.drawImage(strokes, 0, 0);
      sctx.restore();
      sctx.globalCompositeOperation = "destination-in";
      sctx.fill(path);
      sctx.globalCompositeOperation = "source-over";
      sctx.strokeStyle = "#222222";
      sctx.lineWidth = 10;
      sctx.lineJoin = "round";
      sctx.stroke(path);
      sctx.lineWidth = 5;
      sctx.fillStyle = "#222222";
      t.decor(sctx);
    } else {
      // じゆうモード: 白地 + ストロークからインク検出で切り抜き
      const comp = document.createElement("canvas");
      comp.width = t.box.w;
      comp.height = t.box.h;
      const cc = comp.getContext("2d");
      cc.fillStyle = "#ffffff";
      cc.fillRect(0, 0, comp.width, comp.height);
      cc.drawImage(strokes, 0, 0);
      spr = Scan.extractInk(comp);
      if (!spr) {
        alert("えが みつからなかったよ。ふとい せんで おおきく かいてみてね。");
        return;
      }
    }

    let opts = {};
    if (!t.path) {
      const hb = getDrawHabitat();
      if (hb === "human") {
        const joints = await editRig(spr);
        if (!joints) return;
        opts = { habitat: "land", joints };
      } else {
        opts = { habitat: hb };
      }
    }
    Object.assign(opts, releaseOpts("#draw-name"));
    World.addCreature(drawTid, spr, opts);
    showView("world");
  });

  setupDrawTemplate(drawTid);

  // 未使用警告よけ (チップの現在値は setup 済み変数で管理)
  void getDrawTid;

})();
