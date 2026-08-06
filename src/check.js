// 公開する index.html のスクリプトを最小DOMスタブ上で実行し、全レンダーパスを踏む
const fs = require('fs'), path = require('path'), vm = require('vm');
const D = __dirname;
const html = fs.readFileSync(path.join(D, '..', 'index.html'), 'utf8');

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

const dataJson = /<script id="ywb-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
const code = /<script>\n\(function\(\)\{([\s\S]*)\}\)\(\);\n<\/script>/.exec(html);
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

// 全タブを描画
for (const tab of ['ring', 'legend', 'recipe', 'soul', 'dex']) fire({ tab });
console.log('タブ描画 OK / innerHTML書き込み回数', renderCount);

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
  ...[...new Set(D_.youkai.map(y=>y.tribe).filter(Boolean))].map(v => ({ fg:'tribe', fv:v })),
  ...['アタッカー','タンク','ヒーラー','レンジャー'].map(v => ({ fg:'role', fv:v })),
  ...['legend','rare','boss','koten','aka','shiro','tsuki','evo','fuse','gasha',
      'u_ring','u_lgnd','u_evo','u_fuse','u_soul'].map(v => ({ fg:'tag', fv:v })),
  ...[...new Set(D_.youkai.flatMap(y=>y.patrol))].map(v => ({ fg:'area', fv:v })),
];
for (const f of F) { fire(f); fire(f); }   // on → off
fire({}); // no-op
console.log('フィルタ往復', F.length, '種 OK');

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
  for (const s of D_.souls) for (const f of s.from) if (byId.has(f.id)) exp.soul.add(f.id);
  fire({ tab: 'dex' });
  const got = {};
  for (const [k, set] of Object.entries(exp)) {
    fire({ fg:'tag', fv:'u_' + k });
    const m = /<b class="num">(\d+)<\/b> 体/.exec(getEl('resultline').innerHTML);
    const n = m ? +m[1] : -1;
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

// 魂タブ: 分類がすべて出ていて残った魂が漏れていないか、省いた魂が一覧に混ざっていないか
{
  fire({ tab: 'soul' });
  const sh = getEl('main').innerHTML;
  const cut = sh.indexOf('効果べつ 魂一覧');
  if (cut < 0) throw new Error('魂一覧の見出しが出ていない');
  const head = sh.slice(0, cut), list = sh.slice(cut);   // head=省いた魂の対応表 / list=効果べつ一覧
  for (const g of D_.soulGroups) if (!list.includes('>' + g + '</h3>')) problems.push('魂の分類が出ていない: ' + g);
  const miss = D_.souls.filter(s => !list.includes('>' + s.name + '</span>'));
  if (miss.length) problems.push('魂が一覧にない: ' + miss.map(s => s.name).join(', '));
  const sum = [...list.matchAll(/<span class="n">(\d+)種<\/span>/g)].reduce((a, m) => a + +m[1], 0);
  if (sum !== D_.souls.length) problems.push('分類の合計が ' + sum + '（' + D_.souls.length + 'のはず）');

  // 省いた魂は一覧に出ず対応表にだけ出る。代わりの魂は必ず一覧に残っているもの
  const ids = new Set(D_.souls.map(s => s.id));
  const shown = new Set([...list.matchAll(/<span style="font-weight:600">([^<]+)<\/span>/g)].map(m => m[1]));
  for (const d of D_.soulDropped) {
    if (shown.has(d.name)) problems.push('省いたはずの魂が一覧にある: ' + d.name);
    if (!head.includes(d.name)) problems.push('省いた魂が対応表にない: ' + d.name);
    for (const t of d.to) if (!ids.has(t)) problems.push('代わりの魂が一覧にない: ' + d.name + ' → ' + t);
  }
  // 残った魂の rel が、消えた魂を指していないか
  for (const s of D_.souls) for (const r of s.rel || []) if (!ids.has(r.id)) problems.push('魂 ' + s.name + ' の関連が一覧外を指す: ' + r.id);
  const drop = [...head.matchAll(/<span class="n">(\d+)種<\/span>/g)].reduce((a, m) => a + +m[1], 0);
  const pairs = [...head.matchAll(/<span class="n">(\d+)組<\/span>/g)].reduce((a, m) => a + +m[1], 0);
  if (drop !== D_.soulDropped.length) problems.push('省いた魂 ' + drop + '種 / 期待 ' + D_.soulDropped.length);
  if (pairs !== D_.soulRel.same.length) problems.push('同じ効果 ' + pairs + '組 / 期待 ' + D_.soulRel.same.length);
  console.log('魂タブ 分類' + D_.soulGroups.length + ' 一覧' + sum + '種 / 省いた' + drop + '種 / 同効果' + pairs + '組 OK');
}

console.log(problems.length ? '\n--- 問題 ' + problems.length + ' 件 ---\n' + [...new Set(problems)].slice(0, 40).join('\n') : '\n問題なし');
