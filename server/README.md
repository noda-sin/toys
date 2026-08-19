# おえかきプラネット サーバ (ラズパイ常設ブース用)

依存ゼロの Node.js サーバ。リビングのプロジェクター常設ブース構成を想定:

```
[プロジェクター] ← HDMI ← [ラズパイ]                [スマホ / タブレット]
                     Chromium キオスクで              家族の Wi-Fi から
                     ワールドを全画面表示             http://raspberrypi.local:8000
                          ▲                          を開いてシートを撮影
                          │ ポーリング (3秒)                │
                          └──── [server.js] ◀── POST ──────┘
                                  │  /api/creatures (永続化: server/data/*.json)
                                  │  /api/pose      (にんげん自動リグ)
                                  ▼
                        [AnimatedDrawings TorchServe]
                        POSE_URL で指定 (任意。無ければ手動リグ)
```

- 生きものは `server/data/*.json` にファイル保存 → **再起動しても消えない**
- スマホでスキャンした絵が、プロジェクターのワールドに **3秒以内に出現**
- サーバが無い環境 (GitHub Pages など) ではアプリは自動的に localStorage に切り替わる

## ラズパイ セットアップ

```sh
# 1. Node.js (Raspberry Pi OS Bookworm なら apt で十分)
sudo apt install -y nodejs chromium-browser

# 2. リポジトリを配置
git clone https://github.com/noda-sin/toys.git /home/pi/toys

# 3. サーバを systemd で常時起動
sudo cp /home/pi/toys/server/oekaki-planet.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oekaki-planet

# 4. 動作確認
curl http://localhost:8000/api/creatures
```

### 表示方法は2通り

| 方式 | 構成 | 向き不向き |
|---|---|---|
| **A. HDMI 直結** | ラズパイの Chromium キオスク → HDMI → プロジェクター | 確実・低遅延。HDMI 入力のある機種なら何でも可 |
| **B. ブラウザ直接表示** | Google TV 搭載プロジェクターに [Fully Kiosk Browser](https://www.fully-kiosk.com/) を入れ、`http://raspberrypi.local:8000/little-planet/?kiosk=1` を全画面表示 | 配線レス。自動起動・スリープ防止・自動リロードあり。Google TV 機 (XGIMI 等) 限定 — Aladdin は独自 OS なので不可 |

ワールド画面は表示専用の軽い Canvas ページ (カメラ等はスマホ側でしか使わない)
なので、Android TV の WebView でも動く。B 方式で万一描画が重い機種だったら
A 方式にフォールバックすればよい。

### プロジェクターに全画面表示 (キオスクモード)

`?kiosk=1` を付けるとタブや操作ボタンが消え、ワールドだけの全画面になり、
画面下に「スマホで http://〜 をひらいてスキャンしよう!」の案内が出る。

自動起動 (デスクトップセッションの autostart):

```sh
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/oekaki-kiosk.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Oekaki Planet Kiosk
Exec=chromium-browser --kiosk --noerrdialogs --disable-restore-session-state http://localhost:8000/little-planet/?kiosk=1
EOF
```

スクリーンブランクの無効化も忘れずに (`raspi-config` → Display → Screen Blanking → Off)。

## にんげんの自動リグ (AnimatedDrawings ポーズ推定)

じゆう描画を「🕺 にんげんにする」で放流すると、`/api/pose` 経由で
[Meta AnimatedDrawings](https://github.com/facebookresearch/AnimatedDrawings) の
ポーズ推定モデルに関節位置を推定させ、確認画面に自動配置する
(ずれはドラッグで補正可能)。**サービスが無くても動く** — その場合は
標準骨格が初期値になり、手で合わせる。

### ポーズ推定サービスの立てかた

モデルは TorchServe 用 `.mar` として配布されている (mmdet / mmpose 製)。
コンテナイメージは x86_64 向けなので、**LAN 内の PC (古いノートで十分、CPU 推論可) で
動かすのが現実的**。ラズパイ本体で動かすのは非推奨 (ARM ではビルドが困難)。

```sh
# LAN 内の x86 マシンで:
git clone https://github.com/facebookresearch/AnimatedDrawings.git
cd AnimatedDrawings/torchserve
docker build -t animated-drawings-torchserve .
docker run -d -p 8080:8080 --name pose animated-drawings-torchserve

# ラズパイ側: サーバに場所を教える
sudo systemctl edit oekaki-planet   # → Environment=POSE_URL=http://<PCのIP>:8080
sudo systemctl restart oekaki-planet
```

結合テスト用のモックも同梱している:

```sh
node server/mock-pose.js &                       # :8080 で COCO-17 を返す
POSE_URL=http://localhost:8080 node server/server.js
```

## API

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/creatures` | 最新40体を返す `{creatures:[{id,tid,habitat,joints?,data}]}` |
| POST | `/api/creatures` | 1体保存 (PNG は dataURL)。`{id}` を返す |
| DELETE | `/api/creatures` | 全消去 |
| POST | `/api/pose` | `{data: dataURL}` → `{joints:{name:[nx,ny],...}}` (要 POSE_URL) |
