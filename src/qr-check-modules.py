# -*- coding: utf-8 -*-
"""qr-modules.json / qr-video.json の往復検証。

保存済みの全件について rows → 行列 → 再描画 → 復号 が payload と一致するか確かめる。
行列そのものを再エンコードして rows と一致するか(可逆か)も見る。"""
import importlib.util, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('qr_matrix', os.path.join(HERE, 'qr-matrix.py'))
qr_matrix = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(qr_matrix)


def decode_rows(rows, n):
    return np.array([np.unpackbits(np.frombuffer(bytes.fromhex(r), np.uint8))[:n]
                     for r in rows], np.uint8)


def encode_rows(m):
    return [np.packbits(row).tobytes().hex() for row in m]


def check(path, label):
    if not os.path.exists(path):
        print('%s: 無し(スキップ)' % label)
        return True
    with open(path, encoding='utf-8') as f:
        items = json.load(f)['items']
    ok = bad = 0
    for it in items:
        n, rows, payload = it['n'], it['rows'], it['payload']
        tag = it.get('id', payload)
        if len(rows) != n or any(len(r) != math.ceil(n / 8) * 2 for r in rows):
            print('  NG %s: rows の形が n=%d と合わない' % (tag, n))
            bad += 1
            continue
        m = decode_rows(rows, n)
        if encode_rows(m) != rows:
            print('  NG %s: 再エンコードが一致しない' % tag)
            bad += 1
            continue
        got = qr_matrix.render_decode(m)
        if got != payload:
            print('  NG %s: 復号結果が payload と違う (%r != %r)' % (tag, got, payload))
            bad += 1
            continue
        ok += 1
    print('%s: %d 件 / OK %d / NG %d' % (label, len(items), ok, bad))
    return bad == 0


def main():
    a = check(os.path.join(HERE, 'qr-modules.json'), 'qr-modules.json')
    b = check(os.path.join(HERE, 'qr-video.json'), 'qr-video.json')
    if not (a and b):
        sys.exit(1)
    print('往復検証 すべて一致')


if __name__ == '__main__':
    main()
