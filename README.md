# toys

あそべる小さなプロジェクト置き場。

## 🪐 おえかきプラネット — [`little-planet/`](little-planet/)

リトルプラネットの「描いた絵が動きだす」アトラクションや teamLab の「お絵かき水族館」風の、
**紙に描いた絵をスキャンすると海・陸・空のワールドで動きだす** ブラウザアプリ。

外部ライブラリなし(マーカー検出・射影変換も自前実装)。`little-planet/index.html` を開くだけで動く。

ラズパイ+プロジェクターでの常設ブース用に、永続化と AnimatedDrawings 連携
(にんげん自動リグ)を担う依存ゼロのサーバも同梱: [server/README.md](server/README.md)

詳しくは [little-planet/README.md](little-planet/README.md) を参照。
