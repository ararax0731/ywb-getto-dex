# -*- coding: utf-8 -*-
"""ゲームの匠(src/qr-modules.json)と動画(src/qr-video.json)を統合して qr/qr-modules.json を作る。

極玉・1つ星・アイテム・ブーストは対象外。動画由来のQRは題名からカテゴリを推定する。
id は「使用済み」の保存キーなので再ビルドしても変わってはいけない。
ゲームの匠はサイト側のidをそのまま、動画由来は payload のハッシュから導出する
(連番だと動画を1本足すだけで後続のidが全部ずれ、保存済みの「使用済み」が別のQRを指す)。
カテゴリidは保存に使われていないので、体系を組み替えてよい。
"""
import hashlib, json, os, re

import numpy as np, segno

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'qr')

# id → (表示名, グループ)。表示順は id 昇順。
CAT = {
    1: ('赤コイン', 'カラーコイン'),
    2: ('黄色コイン', 'カラーコイン'),
    3: ('オレンジコイン', 'カラーコイン'),
    4: ('桃コイン', 'カラーコイン'),
    5: ('緑コイン', 'カラーコイン'),
    6: ('青コイン', 'カラーコイン'),
    7: ('紫コイン', 'カラーコイン'),
    8: ('水色コイン', 'カラーコイン'),
    21: ('赤コインG', 'カラーコインG'),
    22: ('黄色コインG', 'カラーコインG'),
    23: ('オレンジコインG', 'カラーコインG'),
    24: ('桃コインG', 'カラーコインG'),
    25: ('緑コインG', 'カラーコインG'),
    26: ('青コインG', 'カラーコインG'),
    27: ('紫コインG', 'カラーコインG'),
    28: ('水色コインG', 'カラーコインG'),
    31: ('5つ星コイン', '貴重なコイン'),
    32: ('福ガシャコイン', '貴重なコイン'),
    33: ('スペシャルコイン', '貴重なコイン'),
    39: ('分類不明', '貴重なコイン'),
}
GREAT = 20              # カラーコインid + GREAT = グレート版のid
UNKNOWN = 39
# 色名の正規表現(オレンジは「橙」表記も拾う)。互いに部分文字列にならないので順序は問わない。
# 英語題名の動画があるので英名も見る。水色(Light Blue)は青(Blue)より先に置く。
COLOR = [(r'赤|Red', 1), (r'黄色|Yellow', 2), (r'オレンジ|橙|Orange', 3), (r'桃|Pink', 4),
         (r'緑|Green', 5), (r'水色|Light[ 　]*Blue', 8), (r'青|Blue', 6), (r'紫|Purple', 7)]
G_TAIL = r'[ 　]*[GgＧｇ]'      # 「コインG」「コイン　G」「コインＧ」
DROP = {9, 10, 12, 13}          # 極玉 / 1つ星 / アイテム / ブースト

# 動画由来で実機NGが確定したコードブロック（コード先頭3文字＝コインの種類）。
# 54O: 「スペシャルコインのQRコード100枚」由来の101件。3DS実機で2〜4枚目が読み取れず、
#      5〜6枚目はブーストコインだった（2026-08-20 検証）。匠の 54OI48 だけは名前付きの
#      正解データなので残す（除外するのは動画由来のみ）。
BAD_BLOCK = {'54O'}

# 出典が信用できない動画。ここにしか出てこないコードだけを落とす
# (他の動画にも載っているコードは、その動画の信頼度で判断するので残す)。
BAD_VIDEO = {
    'hvedSnrlUBM',   # 妖怪ウォッチ ポカポカ族（緑コイン）QRコード13枚
    '3Sx7BPWR9MU',   # 妖怪ウォッチ：緑コインQRコード100枚
}


def color_of(text, tail):
    """text から「色名 + コイン(Coin) + tail」を探して色番号(1〜8)を返す。無ければ None。"""
    for pat, c in COLOR:
        if re.search(r'(?:' + pat + r')(?:コイン|[ 　]*Coin)' + tail, text, re.I):
            return c
    return None


def precious_of(text):
    """貴重なコインの種別を返す。判別できなければ None。"""
    if re.search(r'[5５]つ?星|五つ?星', text):   # 「5星コイン」表記の動画もある
        return 31
    if re.search(r'[福副]ガシャ', text):        # 「副ガシャ」表記の動画が実在する
        return 32
    if 'スペシャル' in text:
        return 33
    return None


def guess_cat(text):
    """動画の題名からカテゴリを推定する。グレート → 貴重 → 通常色 の順に見る。"""
    c = color_of(text, G_TAIL)
    if c:
        return GREAT + c
    p = precious_of(text)
    if p:
        return p
    c = color_of(text, '')
    return c if c else UNKNOWN


def great_cat(name):
    """ゲームの匠のグレート(cat 14)を、アイテム名の色でグレート各色へ振り分ける。"""
    c = color_of(name, G_TAIL) or color_of(name, '')
    return GREAT + c if c else UNKNOWN


def regen(payload, n):
    """payload から QR を作り直して rows を返す。

    ゲームの匠の画像は QR の中央にロゴが焼き込まれていて(全1852枚で共通の
    101モジュール)、誤り訂正で読めているだけなので、そのまま保存すると
    訂正余力を食ったまま配ることになる。元と同じ version 6 / ECC H になる
    ことを確かめてから差し替える(違えば元の行列をそのまま使う)。"""
    m = segno.make(payload, error='h').matrix
    if len(m) != n:
        return None
    return [np.packbits(np.array(row, np.uint8)).tobytes().hex() for row in m]


def load(name):
    p = os.path.join(SRC, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None


def payload_id(payload, used):
    """payload から動画由来QRのidを作る。衝突したら payload に連番を足して振り直す
    (取り合いにしないので、他の項目の有無に関わらず同じ payload は同じ id になる)。"""
    for k in range(1000):
        key = payload if k == 0 else '%s#%d' % (payload, k)
        i = 100000 + int(hashlib.md5(key.encode('utf-8')).hexdigest()[:10], 16) % 900000000
        if i not in used:
            return i
    raise RuntimeError('id衝突: ' + payload)


def main():
    items, seen, n_regen_ng = [], set(), 0
    for it in load('qr-modules.json')['items']:
        key = it['payload'].upper()             # 大小違いは同じコイン(符号化方式の違い)
        if it['cat'] in DROP or key in seen:
            continue
        seen.add(key)
        name = it.get('name', '')
        if it['cat'] == 14:
            cat = great_cat(name)
        elif it['cat'] == 11:
            cat = precious_of(name) or UNKNOWN
        else:
            cat = it['cat']
        # 名前・日付は画面に出さない(ラベルは通し番号)ので出力には載せない
        rows = regen(it['payload'], it['n'])
        if rows is None:
            rows, n_regen_ng = it['rows'], n_regen_ng + 1
        items.append({'id': it['id'], 'cat': cat, 'n': it['n'], 'rows': rows})
    ng = len(items)
    if n_regen_ng:
        print('※ 作り直せず元の行列のまま: %d 件' % n_regen_ng)

    v, vs = load('qr-video.json'), []
    if v:
        title = {x['id']: x['title'] for x in v.get('videos', [])}
        for it in v['items']:
            key = it['payload'].upper()
            if key in seen:
                continue
            src = it.get('sources') or []
            t = it.get('title') or (title.get(src[0], '') if src else '')
            if '極玉' in t:
                continue
            if key[20:23] in BAD_BLOCK:
                continue
            if src and not (set(src) - BAD_VIDEO):
                continue
            seen.add(key)
            vs.append((key, guess_cat(t), it['n'], it['rows']))

    im = load('qr-image.json')            # 動画が落とせないコインを画像から補った分
    if im:
        by_name = {name: c for c, (name, _) in CAT.items()}
        for it in im['items']:
            key = it['payload'].upper()
            if key in seen:
                continue
            if it['cat'] not in by_name:  # フォルダ名の綴り違いを黙って分類不明にしない
                raise SystemExit('qr-images に未知のコイン名フォルダ: ' + it['cat'])
            seen.add(key)
            vs.append((key, by_name[it['cat']], it['n'], it['rows']))
    vs.sort()
    used_id = set(x['id'] for x in items)
    for p, c, n, r in vs:
        i = payload_id(p, used_id)              # 他の項目が増減してもidは動かない
        used_id.add(i)
        items.append({'id': i, 'cat': c, 'n': n, 'rows': r})

    items.sort(key=lambda x: (x['cat'], x['id']))
    cats = [{'id': c, 'name': CAT[c][0], 'group': CAT[c][1]}
            for c in sorted(CAT) if any(x['cat'] == c for x in items)]

    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, 'qr-modules.json')
    json.dump({'categories': cats, 'items': items}, open(dst, 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print('ゲームの匠 %d件 + 動画 %d件 = %d件  %.2f MB' %
          (ng, len(vs), len(items), os.path.getsize(dst) / 1048576))
    g = None
    for c in cats:
        if c['group'] != g:
            g = c['group']
            print('[%s] %d件' % (g, sum(1 for x in items
                                        if CAT.get(x['cat'], ('', ''))[1] == g)))
        print('  %-16s %5d' % (c['name'], sum(1 for x in items if x['cat'] == c['id'])))


if __name__ == '__main__':
    main()
