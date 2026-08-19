# -*- coding: utf-8 -*-
"""手元の画像から QR のモジュール行列を抜き出して src/qr-image.json に保存する。

動画が消えている・年齢確認で落とせない等でスクリーンショットしか無いコイン用の経路。
src/qr-images/<コイン名>/*.jpg|png に置く。フォルダ名がそのままカテゴリになるので、
qr-build.py の CAT の表示名(例: スペシャルコイン, 福ガシャコイン, 赤コインG)と綴りを合わせること。
1枚に複数の QR が写っていても全部拾う。payload が http://YW.B-BOYS.JP/... のものだけ。
"""
import importlib.util, json, os

import cv2, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGES, OUT = os.path.join(HERE, 'qr-images'), os.path.join(HERE, 'qr-image.json')

_spec = importlib.util.spec_from_file_location('qr_video', os.path.join(HERE, 'qr-video.py'))
qv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(qv)          # scan() を動画側と共用する(__main__ ではないので走らない)

EXT = ('.jpg', '.jpeg', '.png')


def imread(path):
    """cv2.imread は非ASCIIパスを開けない(コイン名フォルダが日本語)ので自前で読む。"""
    try:
        with open(path, 'rb') as f:
            return cv2.imdecode(np.frombuffer(f.read(), np.uint8), cv2.IMREAD_COLOR)
    except OSError:
        return None


def main():
    items, seen = [], {}
    for cat in sorted(os.listdir(IMAGES)) if os.path.isdir(IMAGES) else []:
        d = os.path.join(IMAGES, cat)
        if not os.path.isdir(d):
            continue
        files = sorted(os.path.join(d, f) for f in os.listdir(d)
                       if os.path.splitext(f)[1].lower() in EXT)
        n_new = 0
        for f in files:
            img = imread(f)
            if img is None:
                print('  読めない: ' + os.path.basename(f), flush=True)
                continue
            got = qv.scan(img)
            if not got:
                print('  QR無し: ' + os.path.basename(f), flush=True)
            for p, m in got.items():
                key = p.upper()           # 大小違いは同じコイン(符号化方式の違い)
                if key in seen:
                    continue
                seen[key] = cat
                items.append({'payload': p, 'cat': cat, 'n': int(m.shape[0]),
                              'rows': qv.encode_rows(m), 'file': os.path.basename(f)})
                n_new += 1
        print('%s: 画像 %d 枚 / QR %d 件' % (cat, len(files), n_new), flush=True)
    items.sort(key=lambda x: (x['cat'], x['payload'].upper()))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'items': items}, f, ensure_ascii=False, separators=(',', ':'))
    print('計 %d 件 -> %s' % (len(items), os.path.basename(OUT)))


if __name__ == '__main__':
    main()
