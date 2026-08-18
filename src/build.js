const fs = require('fs'), path = require('path');
const D = __dirname;
const tpl = fs.readFileSync(path.join(D, 'template.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(D, 'data.json'), 'utf8'));
const availability = JSON.parse(fs.readFileSync(path.join(D, 'availability.json'), 'utf8'));
const equipmentRecipes = JSON.parse(fs.readFileSync(path.join(D, 'equipment-recipes.json'), 'utf8'));
const equipmentBaseRecipes = JSON.parse(fs.readFileSync(path.join(D, 'equipment-base-recipes.json'), 'utf8'));
const equipmentBaseMaterials = JSON.parse(fs.readFileSync(path.join(D, 'equipment-base-materials.json'), 'utf8'));

// 選定済みの実用装備25種。TSVを正本にしてサイトと一覧の食い違いを防ぐ。
const equipmentLines = fs.readFileSync(path.join(D, 'equipment.tsv'), 'utf8').trim().split(/\r?\n/);
// 入手困難データやDOM参照を別の装備へずらさないため、削除前61種で使っていたIDを維持する。
const EQUIPMENT_ID_ORDER = [
  '鬼砕き・天','月光一文字','月影丸','ギヤマンリング','月読みの杖','月光の杖','創造主の杖',
  '月下の黒犬根付','月下の赤猫根付','太古の魔犬根付','妖魔の鬼猫根付','ルナゴールドシールド','ルナホワイトシールド',
  '大傘「桜吹雪」','常闇のフタ','導きのおまもり','光明のおまもり','太陽神のうでわ','積乱雲のうでわ','魔王のうでわ',
  '剛力アーム','桃源郷のうでわ','鬼砕き・絶','オーガブレイカー','幻水龍刀','アルティメットビーム','グレネードサンダー',
  '天界の杖','殺意のまなざし','大妖魔ぬらリング','碧玉のぬらリング','聖人のゆびわ','天狗のうちわ','極合金シールド',
  '天下泰平おまもり','白犬魔王のおまもり','赤猫魔王のまわし','除霊のこぶくろ','冥土の根付','レジェンドチャーム',
  '赤き禍の根付','白き災いの根付','森羅万象まわし','高潔の帯','四葉のおまもり','吸魂花の根付','Bラビットランチャー',
  'ベイダーチップ','勇ましき王のうでわ','優しき王のうでわ','賢き王のうでわ','ニャンダフルな鈴','白古魔の根付',
  '赤魔寝鬼の根付','絶縁のフタ','大漁祈願の根付','氷河の根付','山神の魔よけ','黄泉の根付','破魔のこぶくろ','伝説の盾',
];
const EQUIPMENT_IDS = new Map(EQUIPMENT_ID_ORDER.map((name, index) => [name, index + 1]));

// 同じ素材は同じリンク・入手方法を表示し、機械取得データの重複語を整える。
const canonicalMaterials = new Map();
for (const recipe of Object.values(equipmentRecipes)) for (const requirement of recipe.requirements) {
  requirement.method = requirement.method
    .replace(/^ビッグボスがドロップ：/, '')
    .replace(/でドロップ$/, '');
  const current = canonicalMaterials.get(requirement.name);
  if (!current || (current.url.includes('?search=') && !requirement.url.includes('?search='))) {
    canonicalMaterials.set(requirement.name, { url:requirement.url, method:requirement.method });
  }
}
for (const recipe of Object.values(equipmentRecipes)) for (const requirement of recipe.requirements) {
  const canonical = canonicalMaterials.get(requirement.name);
  requirement.url = canonical.url;
  requirement.method = canonical.method;
  if (requirement.name === '月光石') {
    requirement.url = 'https://youkai.gamepedia.jp/busters/materials/16366';
    requirement.method = '真チャレンジミッションで金評価';
  }
}
equipmentRecipes['賢き王のうでわ'].acquisition = {
  method:'ぬらりひょん（極モード・赤猫団が多いほど確率アップ）',
  url:'https://youkaiwatch2.blog.jp/archives/50155718.html',
};

const EQUIPMENT_DEDICATED = {
  'Bラビットランチャー':'B-USAピョン',
  'ベイダーチップ':'USAピョン',
  '勇ましき王のうでわ':'エンマ大王',
  '優しき王のうでわ':'エンマ大王',
  '賢き王のうでわ':'エンマ大王',
};
function equipmentUse(name, type, effect, power, magic) {
  if (EQUIPMENT_DEDICATED[name]) return '専用ビルド';
  if (name === 'ニャンダフルな鈴') return '仲間集め';
  if (/ぞくせいのダメージを軽減|ドレイン系/.test(effect)) return '属性・技対策';
  if (['月光の杖','天界の杖','聖人のゆびわ','白犬魔王のおまもり','赤猫魔王のまわし'].includes(name)) return 'ヒーラー・支援';
  if (['盾','おまもり'].includes(type) || /ねらわれやすく|まもりがアップ|クリティカルを受けない|よろけなく|スタン状態/.test(effect)) return 'タンク・耐久';
  if (magic > power) return '妖術アタッカー';
  if (type === 'チャーム' || type === 'ベルト') return '汎用・耐久';
  if (/回復/.test(effect)) return 'ヒーラー・支援';
  if (['杖','ゆびわ'].includes(type) || /ようりょく/.test(effect)) return '妖術アタッカー';
  return '物理アタッカー';
}
data.equipment = equipmentLines.map((line, index) => {
  const p = line.split('|');
  if (p.length !== 9) throw new Error('装備TSVの列数が不正: ' + (index + 1));
  const [name,type,rank,hp,power,magic,defense,effect,source] = p;
  const id = EQUIPMENT_IDS.get(name);
  if (!id) throw new Error('装備の固定IDがありません: ' + name);
  const e = { id, name, type, rank:+rank, hp:+hp, power:+power, magic:+magic, defense:+defense, effect, source };
  e.use = equipmentUse(name, type, effect, e.power, e.magic);
  e.dedicated = EQUIPMENT_DEDICATED[name] || '';
  e.recipe = equipmentRecipes[name];
  if (!e.recipe || (!e.recipe.requirements.length && !e.recipe.acquisition)) throw new Error('装備素材がありません: ' + name);
  for (const requirement of e.recipe.requirements) {
    if (!requirement.name || !requirement.count || !requirement.url || !requirement.method) {
      throw new Error('装備素材の項目が不足: ' + name);
    }
    if (requirement.kind === 'equipment') {
      const base = equipmentBaseRecipes[requirement.name];
      if (!base || !base.method || !base.requirements.length || base.requirements.some(r => !r.name || !r.count)) {
        throw new Error('強化元装備の作り方が不足: ' + name + ' → ' + requirement.name);
      }
      const baseRequirements = base.requirements.map(baseRequirement => {
        if (baseRequirement.kind === 'equipment') {
          return { ...baseRequirement, location:'前段の装備' };
        }
        const acquisition = equipmentBaseMaterials[baseRequirement.name];
        if (!acquisition || !acquisition.location || !acquisition.source) {
          throw new Error('強化元装備の素材入手場所が不足: ' + requirement.name + ' → ' + baseRequirement.name);
        }
        return { ...baseRequirement, location:acquisition.location, source:acquisition.source };
      });
      requirement.baseRecipe = { method:base.method, requirements:baseRequirements };
    }
  }
  if (!e.recipe.requirements.length && (!e.recipe.acquisition.method || !e.recipe.acquisition.url)) {
    throw new Error('装備の入手方法が不足: ' + name);
  }
  if (availability.equipment[String(e.id)]) e.unavailable = availability.equipment[String(e.id)];
  return e;
});
if (data.equipment.length !== 25 || new Set(data.equipment.map(e => e.name)).size !== 25) {
  throw new Error('装備は重複なし25種である必要があります');
}
data.availability = { asOf:availability.asOf, criteria:availability.criteria };
for (const y of data.youkai) if (availability.youkai[String(y.id)]) y.unavailable = availability.youkai[String(y.id)];

// B魂は同名の通常妖怪ではなく、入手元のビッグボスへ明示的にリンクする。
// 名前が省略されるB魂（Pブレイカー等）や形態違いがあるため、名前による推測はしない。
const B_SOUL_BOSS_IDS = new Map([
  [91,423], [92,424], [93,425], [94,416], [95,417], [96,418], [97,414], [98,415],
  [99,426], [100,419], [101,420], [102,427], [103,421], [104,422], [105,431],
  [106,430], [107,428], [108,432], [109,436], [110,434], [111,433], [112,439],
  [113,438], [114,440], [115,441], [116,429], [117,442], [118,443], [119,459],
  [120,461], [121,464], [122,467], [123,466], [124,468], [125,469],
]);
{
  const byId = new Map(data.youkai.map(y => [y.id, y]));
  const bSouls = data.souls.filter(s => s.cat === 'b');
  for (const s of bSouls) {
    const bossId = B_SOUL_BOSS_IDS.get(s.id), boss = byId.get(bossId);
    if (!bossId || !boss || !boss.boss) {
      throw new Error('B魂のビッグボス対応が不正: ' + s.id + ' ' + s.name + ' → ' + bossId);
    }
    s.bossId = bossId;
  }
  if (B_SOUL_BOSS_IDS.size !== bSouls.length) {
    throw new Error('B魂対応数が不一致: 対応表' + B_SOUL_BOSS_IDS.size + ' / データ' + bSouls.length);
  }
  const eighth = data.souls.find(s => s.id === 101);
  if (!eighth) throw new Error('第八三途丸のB魂が見つからない');
  eighth.name = '第八三途丸のB魂';

  // 同じ効果の赤魔寝鬼・白古魔は、入手元を両方残した1項目として表示する。
  const red = data.souls.find(s => s.id === 117), white = data.souls.find(s => s.id === 118);
  if (!red || !white || red.effect !== white.effect) throw new Error('赤魔寝鬼・白古魔のB魂を統合できない');
  red.name = '赤魔寝鬼／白古魔のB魂';
  red.bossIds = [red.bossId, white.bossId];
}

// 通常魂は、実用候補としてユーザーが指定した妖怪だけを入手元欄に表示する。
// 魂変化そのもののデータは変更せず、一覧上の候補表示だけを絞る。
const SOUL_SOURCE_NAMES = new Map([
  [4,  ['あつガルル', 'デビビラン']],
  [8,  ['しょうブシ', 'フユニャン']],
  [14, ['アライ魔将']],
  [17, ['妖怪ガッツK', 'ばくそく']],
  [20, ['こえんら', 'サンタク老師', 'ふくろじじい']],
  [30, ['さとりちゃん', 'アゲアゲハ', '心オバア']],
  [39, ['えんらえんら', '虫歯伯爵', 'イザナミ']],
  [40, ['わすれんぼう', 'U.S.O.', 'ゴルニャン', 'ナガバナ']], // 後段で図鑑名「わすれん帽」に補正
  [46, ['モノマネキン', 'あまのじゃく', 'のらりくらり']],
  [48, ['ジンギスギスカン']],
  [49, ['百鬼姫', 'ガブニャン']],
  [53, ['ひつま武士']],
  [54, ['ヒョウヘンヌ', 'ヒョウヘンナ', 'ドンヨリーヌ']],
  [60, ['麒麟', 'イッカク']],
  [63, ['コマさん', 'ししコマ']],
  [64, ['キュン太郎', 'ズキュキュン太', '不怪']],
]);
{
  const soulById = new Map(data.souls.map(s => [s.id, s]));
  for (const [soulId, names] of SOUL_SOURCE_NAMES) {
    const soul = soulById.get(soulId);
    if (!soul || soul.cat !== 'normal') throw new Error('通常魂の候補指定が不正: ' + soulId);
    soul.sourceOwnerIds = names.map(name => {
      const matches = data.youkai.filter(y => y.name === name && y.soul && y.soul.id === soulId);
      if (matches.length !== 1) {
        throw new Error('通常魂の表示妖怪を特定できない: ' + soul.name + ' / ' + name + ' (' + matches.length + '件)');
      }
      return matches[0].id;
    });
  }
}

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
    1,2,5,6,9,10,12,18,23,24,25,26,27,28,29,31,32,35,38,41,42,44,45,47,50,51,52,55,58,66,67,70,78,79,80,81,83,84,85,86,89,90,95,98,102,108,124,125,
    11,13,17,20,39,46,48,53,54,57,63,92,93,94,103,109,111,112,114,116,
    30,87,113,118,120,
    96,105,115,117,
  ]);
  const unknownUserDrops = [...userDropIds].filter(id => !soulById.has(id));
  if (unknownUserDrops.length) throw new Error('指定削除の魂IDが存在しない: ' + unknownUserDrops.join(', '));
  data.souls = data.souls.filter(s => !userDropIds.has(s.id));
  // 魂が残っていない分類は「0種」の見出しごと一覧から外す。
  data.soulGroups = data.soulGroups.filter(group => data.souls.some(s => s.group === group));
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
