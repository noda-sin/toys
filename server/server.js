#!/usr/bin/env node
/* =========================================================
 * おえかきプラネット サーバ (ラズパイ常設ブース用)
 *
 * 依存ゼロの Node.js サーバ。3つの仕事をする:
 *   1. 静的配信   : リポジトリ全体 (ランディング + little-planet)
 *   2. 永続化 API : /api/creatures — 生きものを server/data/ に
 *                   JSON ファイルとして保存。スマホでスキャン →
 *                   プロジェクターのワールドに数秒で出現する
 *   3. ポーズ推定プロキシ : /api/pose — AnimatedDrawings の
 *                   TorchServe (POSE_URL) へ画像を転送し、
 *                   COCO 17 キーポイントをこのアプリの関節名に
 *                   変換して返す。未設定/停止中なら 503
 *
 * 使いかた:
 *   node server/server.js
 *   PORT=8000 POSE_URL=http://192.168.x.x:8080 node server/server.js
 * ========================================================= */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8000);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const POSE_URL = process.env.POSE_URL || "";
const MAX_BODY = 4 * 1024 * 1024;      // 4MB
const MAX_CREATURES = 40;              // GET で返す最新数

fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
};

/* ---------------- 永続化 ---------------- */

function listCreatures() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json")).sort();
  const latest = files.slice(-MAX_CREATURES);
  const out = [];
  for (const f of latest) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")));
    } catch (e) { /* 壊れたファイルは無視 */ }
  }
  return out;
}

function saveCreature(rec) {
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const item = {
    id,
    tid: String(rec.tid || ""),
    habitat: String(rec.habitat || ""),
    data: String(rec.data || ""),
    ts: Number(rec.ts) || Date.now(),
  };
  if (rec.joints && typeof rec.joints === "object") item.joints = rec.joints;
  if (rec.name) item.name = String(rec.name).slice(0, 20);
  if (rec.rare) item.rare = true;
  if (!item.tid || !item.data.startsWith("data:image/")) {
    throw new Error("bad record");
  }
  fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify(item));
  return id;
}

function clearCreatures() {
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (f.endsWith(".json")) fs.unlinkSync(path.join(DATA_DIR, f));
  }
}

/* ---------------- ポーズ推定 (AnimatedDrawings TorchServe) ---------------- */

/* COCO-17 順のキーポイント配列をこのアプリの関節名 (正規化 0..1) へ変換。
 * 左右はモデルのラベルではなく画像上の x 座標で割り当てる
 * (正面向きの絵では解剖学的な左右と画像上の左右が逆になるため) */
function cocoToJoints(kpts, w, h) {
  const P = i => kpts[i];
  const pair = (a, b) => (P(a)[0] <= P(b)[0] ? [P(a), P(b)] : [P(b), P(a)]);
  const [shL, shR] = pair(5, 6);
  const [elL, elR] = pair(7, 8);
  const [wrL, wrR] = pair(9, 10);
  const [hiL, hiR] = pair(11, 12);
  const [knL, knR] = pair(13, 14);
  const [anL, anR] = pair(15, 16);
  const nose = P(0);
  const hips = [(hiL[0] + hiR[0]) / 2, (hiL[1] + hiR[1]) / 2];
  const shoulderMidY = (shL[1] + shR[1]) / 2;
  const headTop = [nose[0], nose[1] - Math.abs(shoulderMidY - nose[1])];
  const J = {
    headTop, hips,
    shoulderL: shL, shoulderR: shR,
    elbowL: elL, elbowR: elR,
    wristL: wrL, wristR: wrR,
    hipL: hiL, hipR: hiR,
    kneeL: knL, kneeR: knR,
    ankleL: anL, ankleR: anR,
  };
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const out = {};
  for (const k in J) out[k] = [clamp01(J[k][0] / w), clamp01(J[k][1] / h)];
  return out;
}

/* TorchServe の応答から「17個以上の [x,y,(score)] の配列」を探す。
 * ハンドラのバージョン差異に耐えるため形をゆるく解釈する */
function findKeypoints(node) {
  if (Array.isArray(node)) {
    if (
      node.length >= 17 &&
      node.every(p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite))
    ) {
      return node;
    }
    for (const child of node) {
      const found = findKeypoints(child);
      if (found) return found;
    }
  } else if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      const found = findKeypoints(node[key]);
      if (found) return found;
    }
  }
  return null;
}

/* PNG バイナリを multipart/form-data で TorchServe へ POST する */
function requestPose(pngBuffer, imgW, imgH) {
  return new Promise((resolve, reject) => {
    const boundary = "----oekaki" + crypto.randomBytes(8).toString("hex");
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="data"; filename="sprite.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, pngBuffer, tail]);

    const url = new URL("/predictions/drawn_humanoid_pose_estimator", POSE_URL);
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
        timeout: 60000,
      },
      res => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`pose service ${res.statusCode}`));
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const kpts = findKeypoints(parsed);
            if (!kpts) return reject(new Error("no keypoints in response"));
            resolve(cocoToJoints(kpts, imgW, imgH));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("pose service timeout")));
    req.end(body);
  });
}

/* PNG ヘッダから幅・高さを読む (IHDR) */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ---------------- HTTP ---------------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) {
        req.destroy();
        return reject(new Error("body too large"));
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    /* ---- API ---- */
    if (url.pathname === "/api/creatures") {
      if (req.method === "GET") {
        return sendJSON(res, 200, { creatures: listCreatures() });
      }
      if (req.method === "POST") {
        const rec = JSON.parse((await readBody(req)).toString("utf8"));
        const id = saveCreature(rec);
        return sendJSON(res, 200, { id });
      }
      if (req.method === "DELETE") {
        clearCreatures();
        return sendJSON(res, 200, { ok: true });
      }
      return sendJSON(res, 405, { error: "method not allowed" });
    }

    if (url.pathname === "/api/pose") {
      if (req.method !== "POST") return sendJSON(res, 405, { error: "method not allowed" });
      if (!POSE_URL) return sendJSON(res, 503, { error: "pose service not configured" });
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const m = /^data:image\/png;base64,(.+)$/.exec(String(body.data || ""));
      if (!m) return sendJSON(res, 400, { error: "expected png data url" });
      const png = Buffer.from(m[1], "base64");
      const size = pngSize(png);
      if (!size) return sendJSON(res, 400, { error: "broken png" });
      try {
        const joints = await requestPose(png, size.w, size.h);
        return sendJSON(res, 200, { joints });
      } catch (e) {
        return sendJSON(res, 502, { error: String(e.message || e) });
      }
    }

    /* ---- 静的配信 ---- */
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJSON(res, 405, { error: "method not allowed" });
    }
    let filePath = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    sendJSON(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`おえかきプラネット サーバ起動: http://0.0.0.0:${PORT}/little-planet/`);
  console.log(`  データ保存先: ${DATA_DIR}`);
  console.log(`  ポーズ推定  : ${POSE_URL || "未設定 (手動リグにフォールバック)"}`);
});
