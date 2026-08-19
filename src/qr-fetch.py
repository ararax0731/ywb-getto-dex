# -*- coding: utf-8 -*-
"""ゲームの匠から QR コードの一覧(メタデータ)を取得して src/qr-data.json に書き出す。
画像の取得は qr-images.py が担当する。"""
import json, os, re, sys, time, urllib.request

BASE = 'https://busters.g-takumi.com'
UA = {'User-Agent': 'Mozilla/5.0'}
HERE = os.path.dirname(os.path.abspath(__file__))
WAIT = 0.3  # 相手サイトへの間隔

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')

def categories():
    h = get(BASE + '/qr.php')
    pat = re.compile(r'([^<>]*?)のQRコード\s*\((\d+)種類\)</[^>]+>(.*?)category_id=(\d+)"', re.S)
    return [{'id': int(cid), 'name': name.strip(), 'count': int(n)}
            for name, n, _, cid in pat.findall(h)]

def page(cid, p):
    url = '%s/qr_list.php?category_id=%d&page=%d' % (BASE, cid, p)
    h = get(url)
    out = []
    for qid, body in re.findall(r'<li id="q(\d+)">(.*?)</li>', h, re.S):
        ps = [t.strip() for t in re.findall(r'<p>([^<]*)</p>', body)]
        # 色コイン・1つ星コインは名前を持たず、公開日だけの <p> が並ぶ
        date = ''
        name = ''
        for t in ps:
            m = re.match(r'公開：(.+)', t)
            if m:
                date = m.group(1).strip()
            elif t and not name:
                name = t
        out.append({'id': int(qid), 'cat': cid, 'name': name, 'date': date})
    return out

def main():
    cats = categories()
    total = sum(c['count'] for c in cats)
    print('カテゴリ %d 件 / 合計 %d 件' % (len(cats), total))
    items, seen = [], set()
    for c in cats:
        pages = (c['count'] + 49) // 50
        for p in range(1, pages + 1):
            got = page(c['id'], p)
            for it in got:
                if it['id'] in seen:
                    continue
                seen.add(it['id'])
                items.append(it)
            print('  %s %d/%d (%d件)' % (c['name'], p, pages, len(got)))
            time.sleep(WAIT)
    items.sort(key=lambda x: x['id'])
    data = {'source': BASE + '/qr.php', 'categories': cats, 'items': items}
    with open(os.path.join(HERE, 'qr-data.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('書き出し %d 件 (重複除去前 合計 %d)' % (len(items), total))

main()
