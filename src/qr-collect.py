# -*- coding: utf-8 -*-
"""ゲームの匠の QR 画像から**モジュール行列だけ**を抜き出して src/qr-modules.json に保存する。

画像そのものは保存しない(容量対策)。行列は行ごとに MSB 先頭で詰めた16進文字列にする。
既に qr-modules.json にある ID は再取得しないので、途中で止めても再実行で続きから走る。
抽出に失敗した ID は src/qr-failed.json に理由付きで残し、処理は止めない。"""
import importlib.util, json, math, os, sys, time, urllib.error, urllib.request
import cv2, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

# qr-matrix.py はハイフン入りで普通に import できないため直接読み込む
_spec = importlib.util.spec_from_file_location('qr_matrix', os.path.join(HERE, 'qr-matrix.py'))
qr_matrix = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(qr_matrix)

IMG = 'https://busters.g-takumi.com/images/qr/%d.png'
UA = {'User-Agent': 'Mozilla/5.0'}
WAIT = 0.3          # 相手サイトへの間隔
SAVE_EVERY = 100    # 中間保存の間隔
LOG_EVERY = 50      # 進捗表示の間隔

DATA = os.path.join(HERE, 'qr-data.json')
OUT = os.path.join(HERE, 'qr-modules.json')
FAILED = os.path.join(HERE, 'qr-failed.json')

# 対象カテゴリ。11(貴重なコイン)は下の名前に一致するものだけ拾う。
FULL_CATS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 14]
RARE_CAT = 11
RARE_NAMES = {'5つ星コイン', '福ガシャコイン', 'スペシャルコイン'}
ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14]


def encode_rows(m):
    """n×n の 0/1 行列を、行ごと MSB 先頭で詰めた16進文字列の配列にする。"""
    return [np.packbits(row).tobytes().hex() for row in m]


def decode_rows(rows, n):
    """encode_rows の逆。"""
    return np.array([np.unpackbits(np.frombuffer(bytes.fromhex(r), np.uint8))[:n]
                     for r in rows], np.uint8)


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save(items, failed):
    items.sort(key=lambda x: x['id'])
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'items': items}, f, ensure_ascii=False, separators=(',', ':'))
    with open(FAILED, 'w', encoding='utf-8') as f:
        json.dump({'items': sorted(failed.values(), key=lambda x: x['id'])},
                  f, ensure_ascii=False, indent=1)


def _bbox(img):
    """暗画素の外接矩形で切る。画像に余白が入っている個体向け。"""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    b = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    ys, xs = np.where(b < 128)
    if not len(xs):
        return None
    c = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return c if min(c.shape[:2]) >= 21 else None


def _snap(img, n):
    """n×n に面積平均で縮めてから二値化し、1モジュール=8px で描き直す。

    原本は 300px に対しモジュール数が割り切れないため、中心1点のサンプリングだと
    アンチエイリアスの中間色を拾って化ける。平均を取ってから決めると安定する。"""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(g, (n, n), interpolation=cv2.INTER_AREA)
    b = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    return cv2.cvtColor(np.kron(b, np.ones((8, 8), np.uint8)), cv2.COLOR_GRAY2BGR)


def extract_hard(img):
    """まず素で試し、駄目なら余白除去と再サンプリングを順に試す。

    qr-matrix.py は編集禁止なので、通らない個体は入力側を作り直して渡す。
    採否の判定(ファインダ/タイミング/再描画して復号)は毎回 extract に任せる。"""
    cands = [img]
    c = _bbox(img)
    if c is not None:
        cands.append(c)
    for v in cands:
        m, payload = qr_matrix.extract(v)
        if m is not None:
            return m, payload
    for v in cands:
        for n in range(21, 78, 4):
            m, payload = qr_matrix.extract(_snap(v, n))
            if m is not None:
                return m, payload
    return None, ''


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def select(data, only=None):
    """対象 1,858 件をカテゴリ順に並べて返す。only を渡すとそのカテゴリだけに絞る(試走用)。"""
    by_cat = {}
    for it in data['items']:
        if it['cat'] in FULL_CATS:
            by_cat.setdefault(it['cat'], []).append(it)
        elif it['cat'] == RARE_CAT and it['name'] in RARE_NAMES:
            by_cat.setdefault(it['cat'], []).append(it)
    out = []
    for cid in ORDER:
        if only and cid not in only:
            continue
        out += sorted(by_cat.get(cid, []), key=lambda x: x['id'])
    return out


def main():
    data = load_json(DATA, None)
    if data is None:
        sys.exit('qr-data.json が無い')
    cname = {c['id']: c['name'] for c in data['categories']}

    items = load_json(OUT, {'items': []})['items']
    failed = {f['id']: f for f in load_json(FAILED, {'items': []})['items']}
    done = {it['id'] for it in items}

    only = {int(a) for a in sys.argv[1:]} or None   # 引数でカテゴリを絞れる(試走用)
    targets = select(data, only)
    todo = [t for t in targets if t['id'] not in done]
    print('対象 %d 件 / 取得済み %d 件 / 今回 %d 件' % (len(targets), len(done), len(todo)))

    added = 0
    cur_cat = None
    seen_in_cat = 0
    total_in_cat = 0
    for t in todo:
        if t['cat'] != cur_cat:
            cur_cat = t['cat']
            seen_in_cat = 0
            total_in_cat = sum(1 for x in todo if x['cat'] == cur_cat)
        seen_in_cat += 1

        tid = t['id']
        img = None
        try:
            raw = fetch(IMG % tid)
            img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError('画像をデコードできない')
            m, payload = extract_hard(img)
            if m is None:
                raise ValueError('モジュール行列を抽出できない')
            items.append({'id': tid, 'cat': t['cat'], 'name': t['name'], 'date': t['date'],
                          'payload': payload, 'n': int(m.shape[0]), 'rows': encode_rows(m)})
            failed.pop(tid, None)
            added += 1
        except Exception as e:
            failed[tid] = {'id': tid, 'cat': t['cat'], 'name': t['name'],
                           'reason': '%s: %s' % (type(e).__name__, e)}
            try:
                # 行列は駄目でも中身は読めることが多いので控えておく
                text = qr_matrix.decode(img) if img is not None else ''
                if text:
                    failed[tid]['payload'] = text
            except Exception:
                pass
            print('  失敗 id=%d (%s) %s' % (tid, cname.get(t['cat'], t['cat']), failed[tid]['reason']))

        if seen_in_cat % LOG_EVERY == 0 or seen_in_cat == total_in_cat:
            print('%s %d/%d' % (cname.get(cur_cat, cur_cat), seen_in_cat, total_in_cat))
        if added and added % SAVE_EVERY == 0:
            save(items, failed)
        time.sleep(WAIT)

    save(items, failed)
    print('保存 %d 件 / 失敗 %d 件 / %.2f MB'
          % (len(items), len(failed), os.path.getsize(OUT) / 1048576))


if __name__ == '__main__':
    main()
