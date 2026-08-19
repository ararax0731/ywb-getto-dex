# -*- coding: utf-8 -*-
"""ゲームの匠(src/qr-modules.json)と動画(src/qr-video.json)を統合して qr/qr-modules.json を作る。

極玉・1つ星・アイテム・ブーストは対象外。動画由来のQRは題名からカテゴリを推定する。
id は「使用済み」の保存キーなので再ビルドしても変わってはいけない。
ゲームの匠はサイト側のidをそのまま、動画由来は payload 順に 100000+ を振る。
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'qr')

CAT = {1: '赤コイン', 2: '黄色コイン', 3: 'オレンジコイン', 4: '桃コイン', 5: '緑コイン',
       6: '青コイン', 7: '紫コイン', 8: '水色コイン', 11: '貴重なコイン', 14: 'グレートコイン'}
COLOR = [('赤', 1), ('黄色', 2), ('オレンジ', 3), ('桃', 4), ('緑', 5), ('青', 6), ('紫', 7), ('水色', 8)]
DROP = {9, 10, 12, 13}          # 極玉 / 1つ星 / アイテム / ブースト

def guess_cat(title):
    """動画の題名からカテゴリを推定する。判別できなければ貴重なコイン扱い。"""
    if re.search(r'コインG|コイン　G|グレート', title):
        return 14
    for w, c in COLOR:
        if re.search(w + r'コイン', title):
            return c
    return 11

def load(name):
    p = os.path.join(SRC, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None

def main():
    items, seen = [], set()
    for it in load('qr-modules.json')['items']:
        if it['cat'] in DROP or it['payload'] in seen:
            continue
        seen.add(it['payload'])
        items.append({'id': it['id'], 'cat': it['cat'], 'name': it.get('name', ''),
                      'date': it.get('date', ''), 'n': it['n'], 'rows': it['rows']})
    ng = len(items)

    v, vs = load('qr-video.json'), []
    if v:
        title = {x['id']: x['title'] for x in v.get('videos', [])}
        for it in v['items']:
            if it['payload'] in seen:
                continue
            t = it.get('title') or title.get((it.get('sources') or [''])[0], '')
            if '極玉' in t:
                continue
            seen.add(it['payload'])
            vs.append((it['payload'], guess_cat(t), it['n'], it['rows']))
    vs.sort()                                   # payload順 = 再ビルドしてもidが動かない
    for k, (p, c, n, r) in enumerate(vs):
        items.append({'id': 100000 + k, 'cat': c, 'name': '', 'date': '', 'n': n, 'rows': r})

    items.sort(key=lambda x: (x['cat'], x['id']))
    cats = [{'id': c, 'name': CAT[c]} for c in sorted(CAT) if any(x['cat'] == c for x in items)]

    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, 'qr-modules.json')
    json.dump({'categories': cats, 'items': items}, open(dst, 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print('ゲームの匠 %d件 + 動画 %d件 = %d件  %.2f MB' %
          (ng, len(vs), len(items), os.path.getsize(dst) / 1048576))
    for c in cats:
        print('  %-12s %5d' % (c['name'], sum(1 for x in items if x['cat'] == c['id'])))

if __name__ == '__main__':
    main()
