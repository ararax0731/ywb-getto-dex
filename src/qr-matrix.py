# -*- coding: utf-8 -*-
"""QR画像からモジュール行列を抽出し、再描画して原本と同じ文字列に復号できるか検証する。"""
import re
import cv2, numpy as np

_det = cv2.QRCodeDetector()

def decode(img):
    """白枠を足して復号(ゲームの匠の画像はクワイエットゾーンが無い)。"""
    p = cv2.copyMakeBorder(img, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    return _decode_img(p)

def _sample(b, n):
    px = b.shape[0] / n
    return np.array([[1 if b[int((y + .5) * px), int((x + .5) * px)] < 128 else 0
                      for x in range(n)] for y in range(n)], np.uint8)

FINDER = np.array([[1,1,1,1,1,1,1],[1,0,0,0,0,0,1],[1,0,1,1,1,0,1],
                   [1,0,1,1,1,0,1],[1,0,1,1,1,0,1],[1,0,0,0,0,0,1],[1,1,1,1,1,1,1]], np.uint8)

def _plausible(m):
    n = m.shape[0]
    for y, x in ((0, 0), (0, n - 7), (n - 7, 0)):
        if not np.array_equal(m[y:y+7, x:x+7], FINDER):
            return False
    # タイミングパターンは黒白交互
    t = m[6, 8:n-8]
    return np.array_equal(t, np.arange(t.size) % 2 ^ 1) or np.array_equal(t, np.arange(t.size) % 2)

URL = re.compile(r'^https?://YW\.B-BOYS\.JP/[0-9A-Z]+$', re.I)

def extract(img):
    """QR画像から (matrix, payload) を返す。失敗時は (None, '')。

    原本はクワイエットゾーンが無く cv2 が直接読めないことがあるため、
    格子から抜いた行列を綺麗に再描画して復号し、それを正とする。
    原本も読めた場合は一致を確認する。"""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, b = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    direct = decode(img)
    for n in range(21, 78, 4):          # version 1..15
        m = _sample(b, n)
        if not _plausible(m):
            continue
        got = render_decode(m)
        if not URL.match(got or ''):
            continue
        if direct and direct != got:    # 原本と食い違ったら採用しない
            continue
        return m, got
    return None, ''  

try:
    from pyzbar.pyzbar import decode as _zbar
except Exception:                       # pyzbar が無くても動く
    _zbar = None

def _decode_img(img):
    """cv2 で読めない模様が稀にあるため pyzbar を併用する。"""
    t, _, _ = _det.detectAndDecode(img)
    if t:
        return t
    if _zbar is not None:
        got = _zbar(img)
        if got:
            return got[0].data.decode('utf-8', 'replace')
    return ''

def render_decode(m, scale=8, quiet=4):
    n = m.shape[0]
    big = np.kron(1 - m, np.ones((scale, scale), np.uint8)) * 255
    q = quiet * scale
    img = cv2.copyMakeBorder(big, q, q, q, q, cv2.BORDER_CONSTANT, value=255)
    img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    return _decode_img(img)
