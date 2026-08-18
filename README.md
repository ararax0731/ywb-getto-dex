# 妖怪ウォッチバスターズ 月兎組 妖怪大辞典チェック表

全470体の図鑑チェック表。ようかいの輪・レジェンド解放・進化/合成・魂・実用装備26種を、逆引き（この妖怪が何に必要か）まで含めて1枚のHTMLにまとめたもの。

- 公開先: GitHub Pages（プライベートリポジトリ、URLを知っている人だけが開ける）
- チェック状態は `localStorage`（キー `ywb-getto-dex-v1`）に保存。**端末ごとに独立**で、他の人とは共有されない。

## 構成

| パス | 中身 |
| --- | --- |
| `index.html` | 公開用。単体で完結するHTML（生成物・直接編集しない） |
| `artifact.html` | Claude Artifact 用。doctype/head/body は公開時に自動で付くので中身だけ（生成物） |
| `src/data.json` | 元データ（4つの攻略サイトを突き合わせたもの） |
| `src/equipment.tsv` | 選定した実用装備26種の能力・効果・出典 |
| `src/equipment-recipes.json` | 各装備の必要素材と、素材の入手方法・出典 |
| `src/equipment-base-recipes.json` | 強化元となる装備16種の作成方法・出典 |
| `src/availability.json` | 現在入手困難な妖怪・装備と判定日・根拠 |
| `src/build.js` | data.json を補正して template.html に流し込み、上の2ファイルを書き出す |
| `src/template.html` | 画面のHTML・CSS・スクリプト本体。`__DATA__` がデータの差し込み口 |
| `src/check.js` | 生成物を最小DOMスタブ上で実行して全画面を描画し、崩れ・数の不一致を検出する |
| `src/serve.js` | `index.html` をそのまま配信する確認用サーバ（http://127.0.0.1:8791） |

## 更新のしかた

```
cd src
node build.js
node check.js      # 「問題なし」が出ればOK
```

`node check.js` は最後に `問題なし` を出す。問題が出た場合は内容を直してから公開する。
公開は `index.html` を含めて commit → push するだけ（GitHub Pages が main の / を配信）。

## データの補正

元データの誤りは `src/build.js` の中で直している（理由もコメントに書いてある）。

- ふぶき姫の合成素材が自分自身になっていた → ゆきおんな
- 合成素材のリンク先IDのずれ（あっそう山 など）
- 「男女三人海物語」のメンバーに報酬のワカメ☆スターが混ざっていた
- わすれんぼう → わすれん帽（図鑑表記に統一）

魂は効果の系統17分類に振り分け、完全な上位互換がある15種は一覧から省いて「一覧から省いた魂」表に対応を残している。
