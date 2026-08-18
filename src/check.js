// 公開する index.html のスクリプトを最小DOMスタブ上で実行し、全レンダーパスを踏む
const fs = require('fs'), path = require('path'), vm = require('vm');
const D = __dirname;
const html = fs.readFileSync(path.join(D, '..', 'index.html'), 'utf8');
const rawBaseMaterials = JSON.parse(fs.readFileSync(path.join(D, 'equipment-base-materials.json'), 'utf8'));
const rawEquipmentRecipes = JSON.parse(fs.readFileSync(path.join(D, 'equipment-recipes.json'), 'utf8'));
const { normalizeAcquisition } = require('./equipment-utils');

if (normalizeAcquisition('黒鬼・極・中当たり でドロップ ') !== '黒鬼・極モード・中当たり') {
  throw new Error('素材入手方法の正規化後に末尾空白が残る');
}
// 出典に当たり枠が書かれていないものは「当たり枠不明」と出し、他の枠と粒度を揃える。
if (normalizeAcquisition('ビッグボスがドロップ：白古魔（赤猫団限定）・極・ドロップ でドロップ') !== '白古魔（赤猫団限定）・極モード・枠不明') {
  throw new Error('当たり枠のない入手方法が「枠不明」にならない');
}
if (/・ドロップ$/.test(normalizeAcquisition('黒鬼・ノーマル・ドロップ'))) {
  throw new Error('当たり枠として「ドロップ」がそのまま残っている');
}

for (const [name, acquisition] of Object.entries(rawBaseMaterials)) {
  if (!acquisition?.location?.trim() || !acquisition?.source?.trim()) {
    throw new Error('強化元素材の入手場所・出典が空: ' + name);
  }
}
for (const [equipment, recipe] of Object.entries(rawEquipmentRecipes)) {
  for (const requirement of recipe.requirements) {
    if (requirement.method !== requirement.method.trim()) {
      throw new Error('装備素材の入手方法に前後空白がある: ' + equipment + ' → ' + requirement.name);
    }
  }
  if (!recipe.requirements.length && recipe.acquisition && (recipe.acquisition.method !== recipe.acquisition.method.trim() ||
      recipe.acquisition.url !== recipe.acquisition.url.trim())) {
    throw new Error('装備自体の入手方法・出典に前後空白がある: ' + equipment);
  }
}

// 正本同士に表記揺れがあれば、生成時の統合で隠れる前に検出する。
const rawMethodsByMaterial = new Map();
const addRawMethod = (name, method) => {
  if (!rawMethodsByMaterial.has(name)) rawMethodsByMaterial.set(name, new Set());
  rawMethodsByMaterial.get(name).add(normalizeAcquisition(method));
};
for (const [name, acquisition] of Object.entries(rawBaseMaterials)) addRawMethod(name, acquisition.location);
for (const recipe of Object.values(rawEquipmentRecipes)) {
  for (const requirement of recipe.requirements) addRawMethod(requirement.name, requirement.method);
}
for (const [name, methods] of rawMethodsByMaterial) {
  if (methods.size > 1) throw new Error('正本内で同じ素材の入手方法が不一致: ' + name + ' → ' + [...methods].join(' / '));
}

// スマホで正しい幅になるか（Artifact のラッパが無いぶん自前で持っている必要がある）
for (const [label, re] of [
  ['doctype', /^<!doctype html>/i],
  ['lang', /<html lang="ja">/],
  ['charset', /<meta charset="utf-8">/],
  ['viewport', /<meta name="viewport" content="width=device-width/],
  ['title', /<head>[\s\S]*<title>[^<]+<\/title>[\s\S]*<\/head>/],
  ['favicon', /<link rel="icon"/],
  ['noindex', /<meta name="robots" content="noindex/],
  ['reset', /box-sizing:border-box/],
]) if (!re.test(html)) throw new Error('index.html に ' + label + ' が無い');
if ((html.match(/<title>/g) || []).length !== 1) throw new Error('title が重複している');
if (!/nav\.tabs\{display:grid; grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/.test(html)) {
  throw new Error('5ページのナビが横スクロールなしの5列グリッドではない');
}
if (!/\.tab\[data-tab="legend"\]\{font-size:7px\}/.test(html)) {
  throw new Error('モバイルのレジェンド解放タブが1行用の文字サイズではない');
}
if (!/class="searchalways"[\s\S]*id="q"[\s\S]*id="filterToggle"/.test(html)) {
  throw new Error('妖怪名検索が折りたたみの外に常時表示されていない');
}

const dataJson = /<script id="ywb-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
const code = /<script>\r?\n\(function\(\)\{([\s\S]*)\}\)\(\);\r?\n<\/script>/.exec(html);
if (!code) throw new Error('main script not found');
const src = '(function(){' + code[1] + '})();';

let renderCount = 0;
class El {
  constructor(id) {
    this.id = id || ''; this.className = ''; this.dataset = {}; this.style = {};
    this._html = ''; this.textContent = ''; this.hidden = false; this.value = '';
    this.classList = {
      _s: new Set(),
      add: (...c) => c.forEach(x => this.classList._s.add(x)),
      remove: (...c) => c.forEach(x => this.classList._s.delete(x)),
      contains: c => this.classList._s.has(c),
      toggle: (c, f) => { const on = f === undefined ? !this.classList._s.has(c) : f;
        on ? this.classList._s.add(c) : this.classList._s.delete(c); return on; },
    };
  }
  set innerHTML(v) { this._html = v; renderCount++; checkHtml(v, 'innerHTML of #' + this.id); }
  get innerHTML() { return this._html; }
  set outerHTML(v) { checkHtml(v, 'outerHTML'); }
  setAttribute() {} getAttribute() { return null; }
  addEventListener() {} removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  insertAdjacentHTML(pos, v) { checkHtml(v, 'insertAdjacentHTML'); }
  closest() { return null; }
  scrollIntoView() {} focus() {} select() {} remove() {} click() {}
  get offsetWidth() { return 0; }
}

const problems = [];
function checkHtml(v, where) {
  if (v == null) return;
  const s = String(v);
  if (/undefined|NaN|\[object Object\]/.test(s)) {
    const m = /.{0,90}(undefined|NaN|\[object Object\]).{0,90}/.exec(s);
    problems.push(where + ' → ' + m[0].replace(/\s+/g, ' '));
  }
  // 開きタグ/閉じタグの数がざっくり合っているか（div, span, tr, td, li, button, table）
  for (const tag of ['div', 'span', 'tr', 'td', 'li', 'button', 'table', 'tbody', 'thead', 'ul', 'article', 'p', 'h2', 'h3']) {
    const o = (s.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
    const c = (s.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    if (o !== c) problems.push(where + ' → <' + tag + '> ' + o + ' 開 / ' + c + ' 閉');
  }
}

const els = new Map();
const getEl = id => { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); };
els.set('ywb-data', Object.assign(new El('ywb-data'), { textContent: dataJson }));

const handlers = { click: [], input: [], change: [], keydown: [] };
const document = {
  getElementById: getEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (t, f) => { (handlers[t] = handlers[t] || []).push(f); },
  execCommand: () => true,
};
const store = {};
const sandbox = {
  document, console,
  window: { addEventListener(){}, scrollTo(){}, scrollY: 0 },
  localStorage: { getItem: k => store[k] || null, setItem: (k, v) => store[k] = v },
  navigator: {}, JSON, Math, Number, String, Array, Set, Map, Object, RegExp, Date,
  setTimeout: (f) => { try { f(); } catch (e) { problems.push('setTimeout: ' + e.message); } return 0; },
  clearTimeout: () => {}, confirm: () => true, alert: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'ywb-inline.js' });

// --- 疑似クリック ---
const fire = ds => {
  const t = new El(); t.dataset = ds;
  const ev = { target: { closest: () => t } };
  for (const h of handlers.click) h(ev);
};
const D_ = JSON.parse(dataJson);
const dexRowCount = () => (getEl('listwrap').innerHTML.match(/class="row(?:\s|")/g) || []).length;

// 全タブを描画
for (const tab of ['ring', 'legend', 'recipe', 'soul', 'dex']) fire({ tab });
console.log('タブ描画 OK / innerHTML書き込み回数', renderCount);

// B魂の入手元リンクは、同名の通常妖怪ではなく必ずビッグボスを指す
{
  fire({ tab: 'soul' });
  const combinedHtml = getEl('main').innerHTML;
  const equipmentStart = combinedHtml.indexOf('<h2>装備一覧</h2>');
  const soulHtml = equipmentStart < 0 ? combinedHtml : combinedHtml.slice(0, equipmentStart);
  if (/\d+\/\d+体/.test(soulHtml)) problems.push('魂一覧に入手済み数／対象数の表記が残っている');
  if (/\d+種を効果の系統でまとめました/.test(soulHtml)) problems.push('魂一覧に不要な説明文が残っている');
  if (/class="soulnav"|href="#sg\d+"/.test(soulHtml)) problems.push('魂一覧に分類リンクが残っている');
  for (const removed of [
    'つやつや魂', 'ブシ王のB魂', 'わるいとりつき継続ターンアップ', 'わざゲージ減少率ダウン',
    '回復時まもりアップ', 'ピンチ時HP自然回復', '敵に見つかっていない間HP自然回復',
    '土俵際', 'ガード時妖気ゲージアップ', 'わざゲージ回復速度アップ',
  ]) {
    if (soulHtml.includes(removed)) problems.push('削除指定の魂が残っている: ' + removed);
  }
  const sourceExpect = new Map([
    ['クリティカル威力アップ', ['あつガルル', 'デビビラン']],
    ['クリティカル率アップ', ['フユニャン', 'まさむね']],
    ['HP吸収', ['百鬼姫', 'むらまさ']],
  ]);
  for (const [soulName, names] of sourceExpect) {
    const s = D_.souls.find(v => v.name === soulName);
    const byYoukaiId = new Map(D_.youkai.map(y => [y.id, y]));
    const gotNames = ((s && s.sourceOwnerIds) || []).map(id => byYoukaiId.get(id)?.name).filter(Boolean);
    if (gotNames.join('|') !== names.join('|')) {
      problems.push('通常魂の表示妖怪が不一致: ' + soulName + ' → ' + gotNames.join('、'));
    }
  }
  const byId = new Map(D_.youkai.map(y => [y.id, y]));
  for (const s of D_.souls.filter(s => s.cat === 'b')) {
    for (const bossId of s.bossIds || [s.bossId]) {
      const boss = byId.get(bossId);
      if (!boss || !boss.boss) problems.push('B魂の入手元がビッグボスではない: ' + s.id + ' ' + s.name);
      else if (!soulHtml.includes('data-goto="' + boss.id + '"')) {
        problems.push('B魂のビッグボスリンクが描画されていない: ' + s.name + ' → ' + boss.name);
      }
    }
  }
  console.log('B魂の入手元リンク', D_.souls.filter(s => s.cat === 'b').length, '種 OK');
}

// 全妖怪の詳細を生成（data-open）
let opened = 0;
for (const y of D_.youkai) {
  const li = new El('y' + y.id);
  const t = new El(); t.dataset = { open: String(y.id) };
  t.closest = () => li;
  const ev = { target: { closest: sel => sel.includes('data-open') || sel.includes('[data-tab]') ? t : null } };
  try { for (const h of handlers.click) h(ev); opened++; }
  catch (e) { problems.push('detail #' + y.id + ' ' + y.name + ': ' + e.message); }
}
console.log('詳細生成', opened, '/', D_.youkai.length);

// フィルタ・検索・ソートを一通り
const F = [
  ...['S','A','B','C','D','E'].map(v => ({ fg:'rank', fv:v })),
  ...['アタッカー','タンク','ヒーラー','レンジャー'].map(v => ({ fg:'role', fv:v })),
  ...['unavailable','aka','shiro','tsuki','gasha',
      'u_ring','u_lgnd','u_evo','u_fuse','u_soul'].map(v => ({ fg:'tag', fv:v })),
  ...[...new Set(D_.youkai.flatMap(y=>y.patrol))].map(v => ({ fg:'area', fv:v })),
];
for (const f of F) { fire(f); fire(f); }   // on → off
fire({}); // no-op
console.log('フィルタ往復', F.length, '種 OK');

// 検索は初期状態で妖怪名・読みに限定し、指定時だけその他項目も対象にする
{
  fire({ tab: 'dex' });
  const search = value => {
    for (const h of handlers.input) h({ target:{ id:'q', value }, isComposing:false });
  };
  const shown = () => {
    return dexRowCount();
  };
  search('アタッカー');
  if (shown() !== 0) problems.push('通常検索で妖怪名以外の役割がヒットしている: ' + shown());
  fire({ searchAll:'1' });
  if (shown() <= 0) problems.push('その他の項目を指定しても役割がヒットしない');
  fire({ searchAll:'1' });
  if (shown() !== 0) problems.push('その他の項目を解除しても役割がヒットしている: ' + shown());
  search('ぶようじん');
  if (shown() <= 0) problems.push('通常検索で妖怪名・読みがヒットしない');
  search('');
  console.log('検索対象 妖怪名のみ／その他項目を指定 OK');
}

// 大辞典の妖怪・ボス切り替え
{
  fire({ tab: 'dex' });
  const expectedYoukai = D_.youkai.filter(y => !y.boss).length;
  const expectedBoss = D_.youkai.filter(y => y.boss).length;
  const shown = () => {
    return dexRowCount();
  };
  if (shown() !== expectedYoukai) problems.push('妖怪表示 ' + shown() + ' / 期待 ' + expectedYoukai);
  fire({ dexKind: 'boss' });
  if (shown() !== expectedBoss) problems.push('ボス表示 ' + shown() + ' / 期待 ' + expectedBoss);
  const bossMain = getEl('main').innerHTML;
  if (/<span class="chiplabel">(?:やくわり|区分)<\/span>/.test(bossMain)) problems.push('ボスのやくわり・区分フィルタが残っている');
  if (/option value="(?:rank|tribe)"/.test(bossMain)) problems.push('ボスの並び順にランク順・種族順が残っている');
  if (/class="tag role"/.test(getEl('listwrap').innerHTML)) problems.push('ボス行にやくわりが残っている');
  fire({ dexKind: 'youkai' });
  console.log('大辞典切替 妖怪' + expectedYoukai + '体 / ボス' + expectedBoss + '体 OK');
}

// 逆引き（何に必要か）を、データから独立に数え直して突き合わせる
{
  const byId = new Map(D_.youkai.map(y => [y.id, y]));
  const exp = { ring:new Set(), lgnd:new Set(), evo:new Set(), fuse:new Set(), soul:new Set() };
  for (const r of D_.rings) for (const m of r.members) if (byId.has(m.id)) exp.ring.add(m.id);
  for (const v of D_.youkai) {
    if (v.legendNeeds) for (const n of v.legendNeeds) if (byId.has(n.id)) exp.lgnd.add(n.id);
    if (v.evolve && byId.has(v.evolve.fromId)) exp.evo.add(v.evolve.fromId);
    if (v.fuse) for (const k of ['a','b']) if (v.fuse[k].kind === 'youkai' && byId.has(v.fuse[k].id)) exp.fuse.add(v.fuse[k].id);
  }
  for (const s of D_.souls) {
    if (s.cat === 'fusion') for (const f of s.from) if (byId.has(f.id)) exp.soul.add(f.id);
    if (s.cat === 'normal') {
      const ids = s.sourceOwnerIds || D_.youkai.filter(y => y.soul && y.soul.id === s.id).map(y => y.id);
      for (const id of ids) if (byId.has(id)) exp.soul.add(id);
    }
  }
  fire({ tab: 'dex' });
  const got = {};
  for (const [k, set] of Object.entries(exp)) {
    fire({ fg:'tag', fv:'u_' + k });
    const n = dexRowCount();
    got[k] = n;
    if (n !== set.size) problems.push('用途フィルタ u_' + k + ': 表示 ' + n + ' / 期待 ' + set.size);
    fire({ fg:'tag', fv:'u_' + k });
  }
  // 行バッジの総数 = 各用途の該当数の合計
  const badges = (getEl('listwrap').innerHTML.match(/class="use"/g) || []).length;
  const total = Object.values(exp).reduce((a, s) => a + s.size, 0);
  if (badges !== total) problems.push('行バッジ ' + badges + ' 個 / 期待 ' + total);
  console.log('逆引き 輪' + got.ring + ' 解' + got.lgnd + ' 進' + got.evo + ' 合' + got.fuse + ' 魂' + got.soul +
    ' / バッジ' + badges + '個 OK');
}

// チェック操作
for (const id of [1, 131, 383, 250]) { fire({ check: String(id) }); }
console.log('チェック保存', JSON.parse(store['ywb-getto-dex-v1'] || '{}').got);

// 魂・装備タブ: 選定した11種、やくわり順、素材、チェックなし、入手困難表示の整合
{
  if (D_.equipment.length !== 11 || new Set(D_.equipment.map(e => e.name)).size !== 11) problems.push('装備が重複なし11種ではない');
  for (const [name,id] of [['鬼砕き・天',1],['月読みの杖',5],['常闇のフタ',15],['碧玉のぬらリング',31]]) {
    if (D_.equipment.find(e => e.name === name)?.id !== id) problems.push('既存チェック用の装備IDが変わった: ' + name);
  }
  if (D_.equipment.some(e => !e.recipe || (!e.recipe.requirements.length && !e.recipe.acquisition))) problems.push('素材・入手方法のない装備がある');
  fire({ tab:'soul' });
  let eh = getEl('main').innerHTML;
  if (!eh.includes('<h2>魂一覧</h2>') || !eh.includes('<h2>装備一覧</h2>')) problems.push('魂と装備が同じタブに描画されていない');
  if ((eh.match(/class="equipitem/g) || []).length !== 11) problems.push('装備一覧の描画件数が11ではない');
  for (const name of ['鬼砕き・天','月光一文字','常闇のフタ','碧玉のぬらリング']) if (!eh.includes(name)) problems.push('装備一覧にない: ' + name);
  for (const name of ['四葉のおまもり','天狗のうちわ','高潔の帯','桃源郷のうでわ','グレネードサンダー','白き災いの根付','赤き禍の根付','レジェンドチャーム','冥土の根付','天下泰平おまもり','聖人のゆびわ','ルナホワイトシールド','月下の赤猫根付','月下の黒犬根付','月光の杖','ギヤマンリング','太陽神のうでわ','積乱雲のうでわ','魔王のうでわ','幻水龍刀','創造主の杖','白古魔の根付','赤魔寝鬼の根付','絶縁のフタ','大漁祈願の根付','氷河の根付','山神の魔よけ','黄泉の根付','破魔のこぶくろ','鬼砕き・絶','吸魂花の根付','伝説の盾','殺意のまなざし','光明のおまもり','オーガブレイカー','極合金シールド','除霊のこぶくろ','森羅万象まわし','Bラビットランチャー','ベイダーチップ','太古の魔犬根付','妖魔の鬼猫根付','剛力アーム','大妖魔ぬらリング','白犬魔王のおまもり','赤猫魔王のまわし','勇ましき王のうでわ','優しき王のうでわ','賢き王のうでわ','ニャンダフルな鈴']) {
    if (eh.includes(name)) problems.push('削除対象の装備が残っている: ' + name);
  }
  for (const name of ['月光一文字','月影丸']) if (!eh.includes(name) || !eh.includes('現在入手困難')) problems.push('入手困難装備の表示がない: ' + name);
  // 版限定素材は「正規手段が消滅した入手困難」とは別の理由なので、並びは変えず弱いマークだけで示す。
  // 期待値はレシピ全体の文字列から取る。build.js の detectOtherVersion（method / location のみ）より
  // 広い範囲を見ているので、あちらの走査漏れがこちら側との不一致として出る。同じ走査を再実装すると
  // 同じ見落としを共有して相互検証にならない。
  // 逆に入手方法以外のフィールド（素材名など）も含むので、build.js が正しくてもここが落ちることはある。
  // 落ちたときは、まず recipe のどこに版限定表記が入ったかを見ること。
  const otherVersionExpected = D_.equipment
    .filter(e => /（赤猫団限定）|（白犬隊限定）/.test(JSON.stringify(e.recipe)))
    .map(e => e.name).sort();
  // 対象装備の名前は固定しない。一覧の入れ替えでこの検証が落ちても直し方が「期待値の書き換え」しかなく、
  // それを繰り返すうちに実物に追従するだけの空の検証になるため。
  // 現在は該当0件（太古の魔犬根付・妖魔の鬼猫根付・ニャンダフルな鈴が装備一覧から外れたので、
  // レシピ側には残っているが表示対象ではない）。該当が戻れば下のマーク検証がそのまま働く。
  for (const e of D_.equipment) {
    if (((e.otherVersion || []).length > 0) !== otherVersionExpected.includes(e.name)) {
      problems.push('版限定素材のマークが素材と一致しない: ' + e.name);
    }
    if ((e.otherVersion || []).length && e.unavailable) problems.push('版限定素材のマークが入手困難と混ざっている: ' + e.name);
  }
  const markCount = (eh.match(/限定の素材が必要<\/span>/g) || []).length;
  const markExpected = D_.equipment.reduce((n, e) => n + (e.otherVersion || []).length, 0);
  if (markCount !== markExpected) problems.push('版限定素材のマークの描画数が合わない: ' + markCount + ' / ' + markExpected);
  for (const tag of [{ key:'aka', label:'赤猫団' }, { key:'shiro', label:'白犬隊' }]) {
    const text = '<span class="tag ' + tag.key + '">' + tag.label + '限定の素材が必要</span>';
    const need = D_.equipment.some(e => (e.otherVersion || []).some(v => v.key === tag.key));
    if (need !== eh.includes(text)) problems.push('版限定素材のマークの色分けが合わない: ' + text);
  }
  // 出典に当たり枠が書かれていない素材の「枠不明」表示。件数だけ見ると別の素材と入れ替わっても
  // 通ってしまうので、埋め込みデータ側の文字列そのものと突き合わせる。
  // タグ直後（`>`）から拾うのは、埋め込み JSON にも同じ文字列があり、全文に当てると丸ごと飲み込むため。
  const unknownSlotExpected = [...new Set((JSON.stringify(D_.equipment).match(/[^"]*・枠不明/g) || []))].sort();
  const unknownSlots = [...new Set([...eh.matchAll(/>([^<>]*・枠不明)</g)].map(m => m[1]))].sort();
  if (unknownSlots.join('|') !== unknownSlotExpected.join('|')) {
    problems.push('当たり枠不明の表示がデータと合わない: 描画 ' + unknownSlots.join('|') + ' / データ ' + unknownSlotExpected.join('|'));
  }
  if (/・ドロップ</.test(eh)) problems.push('当たり枠が「ドロップ」のまま描画されている');
  for (const text of ['推奨度','採用理由：','注意：','能力・効果の出典','現在入手困難：月光一文字','Excelで選定した全']) {
    if (eh.includes(text)) problems.push('装備一覧に削除対象の文言が残っている: ' + text);
  }
  const equipItems = [...eh.matchAll(/<article class="equipitem[^>]*>[\s\S]*?<span class="equipname">([^<]+)<\/span>/g)].map(m => m[1]);
  if (equipItems.slice(-2).join('|') !== '月光一文字|月影丸') problems.push('現在入手困難な装備が一覧末尾にない');
  for (const id of ['exportBtn','importBtn','eqResetBtn']) if (eh.includes('id="' + id + '"')) problems.push('装備一覧に不要な操作ボタンが残っている: ' + id);
  const useOrder = ['アタッカー','タンク','ヒーラー','周回用','現在入手困難'];
  let lastUse = -1;
  for (const use of useOrder) {
    const pos = eh.indexOf('<h3>' + use + '</h3>');
    if (pos < 0 || pos <= lastUse) problems.push('装備の用途順が不正: ' + use);
    lastUse = pos;
  }
  if ((eh.match(/data-equip-open=/g) || []).length !== 11 || (eh.match(/class="equipdetail"/g) || []).length !== 11) problems.push('装備素材の開閉UIが21件ない');
  if (/class="equiptoggle"[^>]*aria-label=/.test(eh)) problems.push('装備の開閉ボタンがaria-labelで内容を上書きしている');
  if ((eh.match(/class="equiptoggle"[^>]*aria-expanded="false"[^>]*aria-controls="equip-detail-/g) || []).length !== 11) problems.push('装備の開閉状態・対象の関連付けが21件ない');
  for (const text of ['必要素材','強化元の作り方・主な入手場所を表示','強化元：真鬼砕き・黒','作り方（新規）','黒鬼・ノーマルモード・大当たり']) if (!eh.includes(text)) problems.push('装備詳細の表示がない: ' + text);
  const baseRequirements = D_.equipment.flatMap(e => e.recipe.requirements).filter(r => r.kind === 'equipment' && r.baseRecipe).flatMap(r => r.baseRecipe.requirements);
  if ((eh.match(/class="basepart"/g) || []).length !== baseRequirements.length) problems.push('強化元装備の素材入手場所が全件描画されていない');
  if (baseRequirements.some(r => r.kind === 'material' && (!r.location?.trim() || !r.source?.trim()))) problems.push('強化元装備の素材入手場所・出典が不足している');
  if (!eh.includes('<span class="howlabel">入手：</span>') || /content:'入手：'/.test(html)) problems.push('「入手：」が実テキストで統一されていない');
  if (!eh.includes('装備：巨大釜のフタ') || !eh.includes('（さらに前段の装備が必要）') || eh.includes('入手：前段の装備')) problems.push('前段装備の案内が不明瞭');
  if (!/\.reciperow\s*,\s*\.basepart\s*\{[^}]*grid-template-columns\s*:\s*1fr\s*;[^}]*gap\s*:\s*0\s*[;}]/.test(html)) problems.push('スマホで強化元素材が1列表示になっていない');
  const methodsByMaterial = new Map();
  for (const equipment of D_.equipment) {
    for (const requirement of equipment.recipe.requirements) {
      if (!methodsByMaterial.has(requirement.name)) methodsByMaterial.set(requirement.name, new Set());
      methodsByMaterial.get(requirement.name).add(requirement.method);
      for (const base of requirement.baseRecipe?.requirements || []) {
        if (base.kind !== 'material') continue;
        if (!methodsByMaterial.has(base.name)) methodsByMaterial.set(base.name, new Set());
        methodsByMaterial.get(base.name).add(base.location);
      }
    }
  }
  for (const [name, methods] of methodsByMaterial) if (methods.size > 1) problems.push('同じ素材の入手方法が不一致: ' + name);
  for (const equipment of D_.equipment) {
    for (const requirement of equipment.recipe.requirements) {
      if (requirement.method !== requirement.method.trim()) problems.push('生成後の素材入手方法に前後空白がある: ' + equipment.name + ' → ' + requirement.name);
      for (const base of requirement.baseRecipe?.requirements || []) {
        if (base.kind === 'material' && base.location !== base.location.trim()) problems.push('生成後の強化元素材の入手場所に前後空白がある: ' + base.name);
      }
    }
    if (equipment.recipe.acquisition && (equipment.recipe.acquisition.method !== equipment.recipe.acquisition.method.trim() ||
        equipment.recipe.acquisition.url !== equipment.recipe.acquisition.url.trim())) {
      problems.push('生成後の装備入手方法・出典に前後空白がある: ' + equipment.name);
    }
  }
  if (/class="recipename"><a\s/.test(eh)) problems.push('装備素材に外部リンクが残っている');
  if (/素材名から出典を開けます|レシピ補完：/.test(eh)) problems.push('装備素材に外部遷移を促す文言が残っている');
  for (const use of ['アタッカー','タンク','ヒーラー','周回用']) {
    if (eh.includes('<span class="tag">' + use + '</span>')) problems.push('装備行に用途タグが残っている: ' + use);
  }
  if (/data-echeck=|class="vstamp"|入手済み/.test(eh)) problems.push('装備一覧にチェックUIまたは入手済み表記が残っている');
  if (/実用性の高い装備|能力・効果とともに一覧|入手済み\s*\d+\/\d+/.test(eh)) problems.push('装備一覧に不要な説明文が残っている');
  const unavailable = D_.youkai.filter(y => y.unavailable);
  const expectedUnavailable = ['妖怪ガッツK','妖怪ガッツF','赤鬼','青鬼','ツチノコパンダ','ニャン騎士','ニャン魔女','レッドJ','マイティードッグ'];
  if (unavailable.map(y => y.name).join('|') !== expectedUnavailable.join('|')) problems.push('現在入手困難な妖怪が想定の9体ではない');
  fire({ tab:'dex' });
  const dh = getEl('listwrap').innerHTML;
  for (const y of unavailable) if (!dh.includes('id="y' + y.id + '"') || !dh.includes('現在入手困難')) problems.push('入手困難妖怪のグレー表示がない: ' + y.name);
  console.log('魂・装備タブ／装備11種・やくわり順・素材・チェックなし・入手困難 妖怪9体／装備2種 OK');
}

// 入手状態フィルタ（すべて・未入手だけ・入手済みだけ）
{
  fire({ tab: 'dex' });
  const dexMain = getEl('main').innerHTML;
  const resultLine = getEl('resultline').innerHTML;
  if (/体を表示|うち入手済み/.test(resultLine)) problems.push('妖怪大辞典に表示数・入手済み数が残っている');
  for (const id of ['exportBtn','importBtn','resetBtn']) if (!resultLine.includes('id="' + id + '"')) problems.push('妖怪の操作ボタンが元の位置にない: ' + id);
  if (!/id="filterPanel"[\s\S]*?<div class="resultline" id="resultline"><\/div>/.test(dexMain)) problems.push('妖怪の操作ボタンが絞り込みの下にない');
  if (/data-fg="tribe"/.test(dexMain)) problems.push('種族の絞り込みが残っている');
  for (const tag of ['legend','rare','koten']) if (dexMain.includes('data-fv="' + tag + '"')) problems.push('削除対象の区分が残っている: ' + tag);
  for (const tag of ['evo','fuse']) if (dexMain.includes('data-fv="' + tag + '"')) problems.push('削除対象の絞り込みが残っている: ' + tag);
  if (!/<span class="chiplabel">やくわり<\/span>[\s\S]*?<\/div><div class="chips"><span class="chiplabel">区分<\/span>/.test(dexMain)) {
    problems.push('やくわりと区分が別の行になっていない');
  }
  if (dexMain.includes('ほかの妖怪・輪・魂をそろえるのに要る妖怪')) problems.push('用途フィルタの削除対象文言が残っている');
  const dexHtml = getEl('listwrap').innerHTML;
  if (!/class="rowbody"[\s\S]*class="namecell"[\s\S]*class="metacell"/.test(dexHtml)) {
    problems.push('妖怪行が名前→No.・ランク等の2段構成ではない');
  }
  if (/class="tag tribe"/.test(dexHtml)) problems.push('妖怪行に族表記が残っている');
  fire({ owned: 'got' });
  const gotShown = dexRowCount();
  if (gotShown !== 4) problems.push('入手済みだけ: 表示 ' + gotShown + ' / 期待 4');
  fire({ owned: 'missing' });
  const missingShown = dexRowCount();
  const expectedMissing = D_.youkai.filter(y => !y.boss).length - 4;
  if (missingShown !== expectedMissing) problems.push('未入手だけ: 表示 ' + missingShown + ' / 期待 ' + expectedMissing);
  fire({ owned: 'all' });
  console.log('入手状態フィルタ OK');
}

// 輪・レジェンドは縦のプルダウン。完成した輪には「済」を表示
{
  const saved = new Set(JSON.parse(store['ywb-getto-dex-v1'] || '{}').got || []);
  for (const m of D_.rings[0].members) if (!saved.has(m.id)) fire({ check: String(m.id) });
  fire({ tab: 'ring' });
  const ringHtml = getEl('main').innerHTML;
  if (/\d+\/\d+ 達成|メンバーを全員なかまにすると、エントランスで報酬がもらえます/.test(ringHtml)) problems.push('ようかいの輪の見出しに不要な説明・達成数が残っている');
  if ((ringHtml.match(/class="accitem/g) || []).length !== D_.rings.length) problems.push('ようかいの輪のプルダウン数が不一致');
  if (!/class="accside done"[^>]*>済<\/button>/.test(ringHtml)) problems.push('完成したようかいの輪に済ボタンがない');
  if (!/<div class="acchead"><button class="accside/.test(ringHtml)) problems.push('ようかいの輪の進捗が左側にない');
  if (/class="accmeta"/.test(ringHtml)) problems.push('ようかいの輪の名称下に進捗表記が残っている');
  if (!/class="acctitle">[\s\S]*?class="accreward">報酬 /.test(ringHtml)) problems.push('ようかいの輪の報酬が名称右にない');
  const ringDoneOrder = [...ringHtml.matchAll(/class="accitem( done)?" data-ring-id=/g)].map(m => Boolean(m[1]));
  if (ringDoneOrder.some((done, i) => done && ringDoneOrder.slice(i + 1).includes(false))) problems.push('完成したようかいの輪より下に未完成の輪がある');
  fire({ tab: 'legend' });
  const legendHtml = getEl('main').innerHTML;
  if (/\d+\/\d+ 解放|必要な8体をすべてなかまにすると、妖怪大辞典の光るページから入手できます/.test(legendHtml)) problems.push('レジェンド見出しに不要な説明・解放数が残っている');
  if ((legendHtml.match(/class="accitem/g) || []).length !== D_.youkai.filter(y => y.legend).length) problems.push('レジェンドのプルダウン数が不一致');
  if (!/<div class="acchead"><button class="accside/.test(legendHtml)) problems.push('レジェンドの進捗が左側にない');
  if (/必要な妖怪 \d+体|\d+体入手済み|class="accmeta"/.test(legendHtml)) problems.push('レジェンドの名称下に必要数表記が残っている');
  const legendDoneOrder = [...legendHtml.matchAll(/class="accitem( done)?" data-legend-id=/g)].map(m => Boolean(m[1]));
  if (legendDoneOrder.some((done, i) => done && legendDoneOrder.slice(i + 1).includes(false))) problems.push('入手済みレジェンドより下に未入手レジェンドがある');
  console.log('輪・レジェンド 済を末尾へ移動 OK');
}

// 進化・合成は縦一覧。No.・ランク・鬼玉・tableを出さない
{
  if (!JSON.parse(store['ywb-getto-dex-v1'] || '{}').got.includes(2)) fire({ check: '2' });
  fire({ tab: 'recipe' });
  const recipeHtml = getEl('main').innerHTML;
  if (/<table[\s>]/.test(recipeHtml)) problems.push('進化・合成にtableが残っている');
  if (/No\.|鬼玉|class="rank"/.test(recipeHtml)) problems.push('進化・合成に削除対象（No.・ランク・鬼玉）が残っている');
  if ((recipeHtml.match(/class="vitem/g) || []).length !== D_.youkai.filter(y => y.evolve || y.fuse).length) problems.push('進化・合成の縦一覧件数が不一致');
  if ((recipeHtml.match(/class="vline"/g) || []).length !== D_.youkai.filter(y => y.evolve || y.fuse).length) problems.push('進化・合成が1行構成になっていない');
  if (/class="vtitle"|class="vformula"|→/.test(recipeHtml)) problems.push('進化・合成に旧2行構成が残っている');
  if (!/えんらえんら[\s\S]*?←[\s\S]*?こえんら[\s\S]*?（LV32）/.test(recipeHtml)) problems.push('進化の1行表記が指定形式ではない');
  if (!/デビビラン[\s\S]*?←[\s\S]*?デビビル[\s\S]*?＋[\s\S]*?邪神のかたまり/.test(recipeHtml)) problems.push('合成の1行表記が指定形式ではない');
  const recipeParts = recipeHtml.split('<div class="secthead"><h2>合成</h2>');
  for (const [label, part] of [['進化', recipeParts[0]], ['合成', recipeParts[1] || '']]) {
    const gotOrder = [...part.matchAll(/class="vitem( got)?" data-recipe-id=/g)].map(m => Boolean(m[1]));
    if (gotOrder.some((got, i) => got && gotOrder.slice(i + 1).includes(false))) problems.push('入手済みの' + label + '妖怪より下に未入手妖怪がある');
  }
  console.log('進化・合成 1行一覧・済を末尾へ移動 OK');
}

// 魂タブ: 分類がすべて出ていて残った魂が漏れていないか。
// 「一覧から省いた魂」「代わりはB魂／ふつうの魂」は表示しない。
{
  fire({ tab: 'soul' });
  const sh = getEl('main').innerHTML;
  const cut = sh.indexOf('魂一覧');
  if (cut < 0) throw new Error('魂一覧の見出しが出ていない');
  const equipCut = sh.indexOf('<h2>装備一覧</h2>', cut);
  if (equipCut < 0) throw new Error('魂・装備タブに装備一覧の見出しが出ていない');
  const list = sh.slice(cut, equipCut);
  for (const g of D_.soulGroups) if (!list.includes('>' + g + '</h3>')) problems.push('魂の分類が出ていない: ' + g);
  const miss = D_.souls.filter(s => !list.includes('>' + s.name + '</span>'));
  if (miss.length) problems.push('魂が一覧にない: ' + miss.map(s => s.name).join(', '));
  const sum = [...list.matchAll(/<span class="n">(\d+)種<\/span>/g)].reduce((a, m) => a + +m[1], 0);
  if (sum !== D_.souls.length) problems.push('分類の合計が ' + sum + '（' + D_.souls.length + 'のはず）');
  for (const text of ['一覧から省いた魂','代わりはＢ魂','代わりはふつうの魂']) {
    if (sh.includes(text)) problems.push('削除対象の記載が残っている: ' + text);
  }
  const removedSoulNames = [
    'わざ溜め時すばやさアップ','HP満タン時すばやさアップ','回復時すばやさアップ','気絶回復時HP回復','気絶回復時全ステータスアップ',
    'よびよせ魂','PブレイカーのB魂','職人魂','覚醒日ノ神のB魂','ガシャどくろGのB魂','おのぼり黒トンのB魂',
    'おすそわけ魂','いのちとりのB魂','味方全員の昇天ゲージ減少速度ダウン','気絶回復速度アップ','しっかり魂','スパイク魂',
    'はがねの魂','ガード効果アップ','攻撃カウンター','ウィルス魂','ピンチ相手へのダメージアップ','ボス以外へのダメージアップ',
    'アイテム・鬼玉入手時ちからアップ','回復時ちからアップ','回復時ようりょくアップ','ピンチ時まもりアップ','わざ溜め時まもりアップ',
    'HP満タン時まもりアップ','敵撃破時ちからアップ','ピンチ時すばやさアップ','のろわれ魂','アイテム・鬼玉入手時HP回復',
    '敵撃破時HP回復','ドレイン吸収率アップ','自分のHP回復率アップ','かげろう魂',
    'ピンチ時ちからアップ','HP満タン時ちからアップ','青鬼のB魂','ミツマタノヅチのB魂','黒鬼のB魂',
    'すばやさアップ','イカカモネ議長のB魂','妖気ゲージ満タン時全ステータスアップ','HP満タン時全ステータスアップ',
    'ピンチ時全ステータスアップ','孤独時全ステータスアップ','ガシャどくろのB魂','わざをためる速度アップ',
    'ロボニャン28号のB魂','レッドJのB魂','妖気ゲージ上昇率アップ','ウィスマロのB魂','あやとりさまのB魂',
    '鬼系へのダメージアップ','氷ぞくせいのダメージアップ',
    'R3000のB魂','カブキロイドのB魂','忍の魂','自分にかかったよいとりつき継続ターンアップ',
    '赤魔寝鬼のB魂','白古魔のB魂','赤魔寝鬼／白古魔のB魂','ウバウネのB魂',
    '日ノ神のB魂','どんどろのB魂','地獄大山椒のB魂',
    'ぬらりひょんのB魂','白古魔GのB魂',
    '火の魂','水の魂','雷の魂','氷の魂','土の魂','風の魂',
    '火・氷耐性アップ','土・風耐性アップ','雷・水耐性アップ','水・氷・風耐性アップ',
    '挑発','赤鬼のB魂','鬼食いのB魂','聖なる魂','自分がかけるよいとりつき継続ターンアップ',
  ];
  const stillPresent = removedSoulNames.filter(name => D_.souls.some(s => s.name === name));
  if (stillPresent.length) problems.push('指定削除の魂が残っている: ' + stillPresent.join(', '));
  const hpAbsorb = D_.souls.find(s => s.name === 'HP吸収');
  if (hpAbsorb?.effect !== '攻撃で与えたダメージの10%分、HPを回復する（魂レベル10時）。') problems.push('HP吸収の説明が指定文言ではない');
  if (!D_.souls.some(s => s.name === 'ギヤマンどくろのB魂')) problems.push('ギヤマンどくろのB魂が一覧にない');
  if (!list.includes('class="soulbottom"')) problems.push('魂一覧が2行構成になっていない');
  for (const group of ['まもり','全ステータス','属性を与える','属性に耐える','昇天・復活','トラップ','ガード・回避・耐久','入手・ともだちチャンス','立ち回り・その他','とりつき','クリティカル','与ダメージ・敵弱体','すばやさ','わざゲージ・妖気ゲージ','ちから・ようりょく']) {
    if (D_.soulGroups.includes(group) || list.includes('>' + group + '</h3>')) problems.push('0種の魂分類が残っている: ' + group);
  }
  if (/<table[\s>]/.test(sh)) problems.push('魂タブに横スクロールの原因となるtableが残っている');
  console.log('魂タブ 分類' + D_.soulGroups.length + ' 一覧' + sum + '種 / 省いた魂の記載なし OK');
}

console.log(problems.length ? '\n--- 問題 ' + problems.length + ' 件 ---\n' + [...new Set(problems)].slice(0, 40).join('\n') : '\n問題なし');
