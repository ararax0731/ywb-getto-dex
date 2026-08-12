const fs = require('fs'), path = require('path');
const D = __dirname;
const tpl = fs.readFileSync(path.join(D, 'template.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(D, 'data.json'), 'utf8'));

// 表示に使わないフィールドを落として出力サイズを抑える
for (const y of data.youkai) delete y.icons;

// ソース側の誤リンク修正: ふぶき姫(197)の合成素材が自分自身になっている。
// 正しくは ゆきおんな(196)＋白銀のかみどめ（複数ソースで確認済み）
{
  const fu = data.youkai.find(y => y.id === 197);
  if (fu && fu.fuse && fu.fuse.a.id === 197) {
    fu.fuse.a = { kind: 'youkai', id: 196, name: 'ゆきおんな' };
  } else if (fu) {
    throw new Error('197 の合成データが想定と違う: ' + JSON.stringify(fu.fuse));
  }
}
// ソース側の誤リンク修正: 素材名は正しいがリンク先IDがずれている（例: あそっ火山 の素材 あっそう山 が115を指す）
{
  // 同名の妖怪（USAピョン等）は特定できないので、名前が一意のものだけ直す
  const byName = new Map();
  for (const y of data.youkai) byName.set(y.name, byName.has(y.name) ? null : y);
  const byId = new Map(data.youkai.map(y => [y.id, y]));
  for (const y of data.youkai) {
    if (!y.fuse) continue;
    for (const s of ['a', 'b']) {
      const m = y.fuse[s];
      if (m.kind !== 'youkai') continue;
      const cur = byId.get(m.id);
      if (cur && cur.name === m.name) continue;          // 既に正しい
      const t = byName.get(m.name);
      if (t && t.id !== m.id) { console.log('素材リンク修正:', y.name, '/', m.name, m.id, '→', t.id); m.id = t.id; }
    }
  }
}
// ソース側の誤り修正: 「男女三人海物語」のメンバーに報酬のワカメ☆スターが混ざっている。
// 攻略大百科・Hrs-Game はどちらもメンバー3体（ワカメくん／コンブさん／メカブちゃん）、
// ワカメ☆スターは輪の報酬。輪の解説文「男女3匹の海藻妖怪グループ」とも合う。
{
  const r = data.rings.find(x => x.name === '男女三人海物語');
  const before = r.members.length;
  r.members = r.members.filter(m => m.name !== r.reward);
  if (r.members.length !== 3 || before !== 4) throw new Error('海物語のメンバー補正が想定と違う: ' + before + '→' + r.members.length);
}
// 報酬妖怪がメンバー欄に混ざっている輪が他にないか確認
for (const r of data.rings) {
  const dup = r.members.filter(m => m.name === r.reward);
  if (dup.length) console.log('※ 報酬と同名のメンバー:', r.name, '/', r.reward);
}

// ソース側の表記ゆれ修正: このサイトだけ「わすれんぼう」表記。他シリーズ・他サイトはすべて
// 「わすれん帽」（読みが「わすれんぼう」）なので図鑑名に合わせる。
{
  const y = data.youkai.find(v => v.id === 56);
  if (!y || y.name !== 'わすれんぼう') throw new Error('56 が わすれんぼう ではない: ' + (y && y.name));
  y.name = 'わすれん帽';
  for (const r of data.rings) for (const m of r.members) if (m.id === 56) m.name = 'わすれん帽';
  for (const s of data.souls) for (const f of s.from) if (f.id === 56) f.name = 'わすれん帽';
  for (const v of data.youkai) {
    if (v.evolve && v.evolve.fromId === 56) v.evolve.from = 'わすれん帽';
    if (v.fuse) for (const k of ['a', 'b']) if (v.fuse[k].kind === 'youkai' && v.fuse[k].id === 56) v.fuse[k].name = 'わすれん帽';
  }
}

// 魂を効果の系統で分類する（元データは入手区分しか持っていない）
const SOUL_GROUPS = [
  ['ちから・ようりょく', [10,41,42,48,53,58,92,93,101,103,106,121]],
  ['まもり',             [25,26,32,51]],
  ['すばやさ',           [1,9,17,28,31,100,109]],
  ['全ステータス',       [20,38,46,54,63,78,104,113,120]],
  ['HP回復・粘り',       [3,5,6,23,27,29,33,35,36,44,47,49,55,60,62,86,94,107]],
  ['クリティカル',       [4,8,65,79,87,119,125]],
  ['わざ・必殺技',       [13,21,56,105,112,115,116]],
  ['わざゲージ・妖気ゲージ', [14,24,34,39,66,67,111,114]],
  ['与ダメージ・敵弱体', [11,45,50,57,81,96,117,118]],
  ['属性を与える',       [72,73,74,75,76,77]],
  ['属性に耐える',       [7,16,19,22,37,43,59,61,68,69]],
  ['とりつき',           [2,30,64,88,110]],
  ['ガード・回避・耐久', [12,52,80,84,85,91,99,122]],
  ['昇天・復活',         [18,70,102]],
  ['トラップ',           [15,89,108,124]],
  ['入手・ともだちチャンス', [71,90,97,98]],
  ['立ち回り・その他',   [40,82,83,95,123]],
];
{
  const soulById = new Map(data.souls.map(s => [s.id, s]));
  const seen = new Set();
  for (const [name, ids] of SOUL_GROUPS) for (const id of ids) {
    const s = soulById.get(id);
    if (!s) throw new Error('分類の魂IDが存在しない: ' + id);
    if (seen.has(id)) throw new Error('魂が2つの分類に入っている: ' + id);
    seen.add(id); s.group = name;
  }
  const rest = data.souls.filter(s => !seen.has(s.id));
  if (rest.length) throw new Error('未分類の魂: ' + rest.map(s => s.id + ' ' + s.name).join(', '));
  data.soulGroups = SOUL_GROUPS.map(([n]) => n);

  // 効果がかぶる魂の対応。same=文言が同一、up=[下位, 上位]
  const SAME = [[52,99],[46,104],[24,111],[13,112],[70,102],[33,62],[117,118]];
  const UP = [
    [56,105],[15,108],[34,114],[21,115],[36,94],[17,100],[33,107],[62,107],[3,33],[3,62],
    [59,43],[19,43],[19,69],[7,68],[7,69],[16,68],[22,61],[37,61],[37,69],
  ];
  for (const s of data.souls) s.rel = [];
  const add = (id, t, other) => soulById.get(id).rel.push({ t, id: other });
  for (const [a, b] of SAME) { add(a, 'same', b); add(b, 'same', a); }

  // 完全な上位互換がある魂は一覧から省く（対応は「省いた魂」表に残す）
  const upOf = new Map();
  for (const [lo, hi] of UP) { if (!upOf.has(lo)) upOf.set(lo, []); upOf.get(lo).push(hi); }
  const dropIds = new Set(upOf.keys());
  // 実用魂リストの方針: 妖怪ガッツKなどが作る「すばやさアップ」は、
  // つられたろう丸のB魂の下位でも用途があるため一覧へ残す。
  dropIds.delete(17);
  // 上位そのものが省かれる場合（HP回復の 3→33/62→107 など）はさらに上へたどって、残る魂を代わりにする
  const resolve = (id, seen) => {
    const out = [];
    for (const hi of upOf.get(id) || []) {
      if (!dropIds.has(hi)) { if (!out.includes(hi)) out.push(hi); continue; }
      if (seen.has(hi)) continue;
      seen.add(hi);
      for (const x of resolve(hi, seen)) if (!out.includes(x)) out.push(x);
    }
    return out;
  };
  data.soulDropped = [...dropIds].sort((a, b) => a - b).map(id => {
    const s = soulById.get(id), to = resolve(id, new Set([id]));
    if (!to.length) throw new Error('代わりの魂が決まらない: ' + id + ' ' + s.name);
    return { id, name: s.name, cat: s.cat, group: s.group, effect: s.effect, to };
  });
  data.souls = data.souls.filter(s => !dropIds.has(s.id));
  // 利用者が実用性の観点から一覧から外すと指定した魂。
  const userDropIds = new Set([
    1,5,6,9,10,12,18,23,26,28,31,32,35,38,41,42,45,47,50,51,52,58,70,78,80,81,83,84,85,86,89,90,95,98,102,108,124,
  ]);
  const unknownUserDrops = [...userDropIds].filter(id => !soulById.has(id));
  if (unknownUserDrops.length) throw new Error('指定削除の魂IDが存在しない: ' + unknownUserDrops.join(', '));
  data.souls = data.souls.filter(s => !userDropIds.has(s.id));
  const allDropIds = new Set([...dropIds, ...userDropIds]);
  for (const s of data.souls) s.rel = s.rel.filter(r => !allDropIds.has(r.id));
  // 一覧に残るペアだけ（33=62 は両方 107 の下位なので、そろって消える）
  data.soulRel = { same: SAME.filter(([a, b]) => !allDropIds.has(a) && !allDropIds.has(b)) };
  console.log('上位互換で省略', dropIds.size, '種 / 指定削除', userDropIds.size, '種 / 残り', data.souls.length, '種');
}

// 自己参照が他に残っていないか確認
for (const y of data.youkai) {
  if (y.fuse && y.fuse.a.kind === 'youkai' && y.fuse.a.id === y.id) throw new Error('自己参照合成: ' + y.name);
  if (y.fuse && y.fuse.b.kind === 'youkai' && y.fuse.b.id === y.id) throw new Error('自己参照合成: ' + y.name);
  if (y.evolve && y.evolve.fromId === y.id) throw new Error('自己参照進化: ' + y.name);
}

// <script> の中に安全に埋め込めるようエスケープ
const json = JSON.stringify(data).replace(new RegExp('[<>\u2028\u2029]','g'),
  c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const out = tpl.replace('__DATA__', () => json);
if (out.includes('__DATA__')) throw new Error('placeholder not replaced');
const R = path.join(D, '..');

// Artifact 用: 公開時に doctype/head/body が付くので中身だけを書き出す
fs.writeFileSync(path.join(R, 'artifact.html'), out, 'utf8');

// GitHub Pages 用: 単体で完結する HTML。Artifact のラッパと同じ土台を自前で持たせる
const title = /<title>([^<]+)<\/title>/.exec(out)[1];
const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="88">🌙</text></svg>';
const page = '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<meta name="robots" content="noindex, nofollow">\n' +   // URL を知っている人だけが開く前提
  '<meta name="theme-color" content="#EDEFF5" media="(prefers-color-scheme:light)">\n' +
  '<meta name="theme-color" content="#11131A" media="(prefers-color-scheme:dark)">\n' +
  '<meta name="apple-mobile-web-app-title" content="月兎組 図鑑">\n' +
  '<link rel="icon" href="data:image/svg+xml,' + encodeURIComponent(icon) + '">\n' +
  '<title>' + title + '</title>\n' +
  '<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>\n' +
  '</head>\n<body>\n' + out.replace(/^<title>[^<]*<\/title>\s*/, '') + '\n</body>\n</html>\n';
fs.writeFileSync(path.join(R, 'index.html'), page, 'utf8');
console.log('wrote index.html', (Buffer.byteLength(page) / 1024).toFixed(1) + ' KB / artifact.html',
  (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB');
