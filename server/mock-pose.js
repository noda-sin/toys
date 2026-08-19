#!/usr/bin/env node
/* =========================================================
 * ポーズ推定サービスのモック (テスト用)
 *
 * AnimatedDrawings の TorchServe と同じエンドポイント
 * (POST /predictions/drawn_humanoid_pose_estimator) を持ち、
 * 送られた PNG のサイズに合わせた COCO-17 キーポイントを返す。
 * server.js の POSE_URL に指定して結合テストに使う:
 *   node server/mock-pose.js &            # port 8080
 *   POSE_URL=http://localhost:8080 node server/server.js
 * ========================================================= */

"use strict";

const http = require("http");

const PORT = Number(process.env.PORT || 8080);

/* multipart ボディから PNG を探して IHDR のサイズを読む */
function pngSizeInBody(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const at = buf.indexOf(sig);
  if (at < 0 || buf.length < at + 24) return null;
  return { w: buf.readUInt32BE(at + 16), h: buf.readUInt32BE(at + 20) };
}

/* COCO-17 順: nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles
 * わざと標準骨格と少し違う位置 (肩が高い等) を返して、
 * ML の結果が使われたことをテストで区別できるようにする */
function keypointsFor(w, h) {
  const p = (x, y) => [x * w, y * h, 0.9];
  return [
    p(0.50, 0.10),               // nose
    p(0.46, 0.08), p(0.54, 0.08), // eyes
    p(0.42, 0.09), p(0.58, 0.09), // ears
    p(0.34, 0.25), p(0.66, 0.25), // shoulders
    p(0.20, 0.38), p(0.80, 0.38), // elbows
    p(0.10, 0.50), p(0.90, 0.50), // wrists
    p(0.42, 0.58), p(0.58, 0.58), // hips
    p(0.38, 0.75), p(0.62, 0.75), // knees
    p(0.36, 0.92), p(0.64, 0.92), // ankles
  ];
}

http
  .createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/predictions/")) {
      res.writeHead(404);
      return res.end();
    }
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const size = pngSizeInBody(Buffer.concat(chunks)) || { w: 100, h: 100 };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ keypoints: keypointsFor(size.w, size.h) }]));
    });
  })
  .listen(PORT, () => console.log(`mock pose service on :${PORT}`));
