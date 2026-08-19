# -*- coding: utf-8 -*-
"""YouTube 動画から QR のモジュール行列を抜き出して src/qr-video.json に保存する。

ゲームの匠に無いコイン(黄色/緑/水色のコインG など)を補うための経路。
対象は src/qr-video-targets.json に並べた動画だけ(プレイリストは辿らない)。
1本を全編・打ち切り無しで見る。動画は1本ずつ処理し、mp4 とフレーム PNG は
終わったそばから消す(ディスク対策)。payload で重複排除し、処理し終えた動画 ID を
記録するので、途中で止めても再実行すれば続きから走る。

別ゲームの QR が混ざる動画があるので、payload が http://YW.B-BOYS.JP/... の
ものだけを採る。"""
import importlib.util, json, os, re, shutil, subprocess, sys, urllib.request
import cv2, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('qr_matrix', os.path.join(HERE, 'qr-matrix.py'))
qr_matrix = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(qr_matrix)

OUT = os.path.join(HERE, 'qr-video.json')
TARGETS = os.path.join(HERE, 'qr-video-targets.json')
WORK = (r'C:\Users\doubl\AppData\Local\Temp\claude\C--Users-doubl-OneDrive--1--projects'
        r'\0cffe046-c03b-4154-8477-f032818281fc\scratchpad\qrwork')

WATCH = 'https://www.youtube.com/watch?v='
UA = {'User-Agent': 'Mozilla/5.0'}
FPS = float(os.environ.get('QR_FPS') or 0.5)   # フレーム展開のレート(QR_FPS で上書き)
FPS_SHORT = 2      # SHORT_SEC 秒に満たない短い動画はこちらで細かく見る
SHORT_SEC = 60
WARP = 512         # QR を切り出すときの正方形サイズ
UPSCALE = 3        # 低解像度の一覧動画向け。等倍だと zbar も cv2 も何も読めない
LONG_SIDE = 1400   # 拡大後の長辺の目安(720p を 3 倍すると 1 フレームが遅すぎる)
FORMAT = 'bv*[height<=720][ext=mp4]/bv*[height<=720]/best[height<=720]/best'
# これが無いと既定クライアントが android_vr に落ちて全動画 403 になる
CLIENT = ['--extractor-args', 'youtube:player_client=android']
PAYLOAD = re.compile(r'^https?://YW\.B-BOYS\.JP/', re.I)

try:
    from pyzbar.pyzbar import decode as _zbar
except Exception:                    # pyzbar が無くても cv2 経路だけで動く
    _zbar = None


def encode_rows(m):
    return [np.packbits(row).tobytes().hex() for row in m]


def load():
    if not os.path.exists(OUT):
        return {'videos': [], 'items': []}
    with open(OUT, encoding='utf-8') as f:
        return json.load(f)


def save(state):
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, separators=(',', ':'))


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')


def num(s):
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return 0


def targets():
    """対象リストを (id, title) の並びで返す。"""
    with open(TARGETS, encoding='utf-8') as f:
        return [(v['id'], v['title']) for v in json.load(f)['videos']]


def duration(vid):
    """尺(秒)を返す。取れなければ 0。"""
    r = run([sys.executable, '-m', 'yt_dlp', '-q', '--no-warnings', '--skip-download',
             '--print', '%(duration)s'] + CLIENT + [WATCH + vid])
    return num(r.stdout.strip()) if r.returncode == 0 else 0


def media(vid):
    """yt-dlp が実際に置いたファイルを探す(コンテナが mp4 以外になることがある)。"""
    for name in sorted(os.listdir(WORK)):
        if name.startswith(vid + '.') and not name.endswith('.part'):
            return os.path.join(WORK, name)
    return None


def download(vid):
    """動画を落として (パス, エラー文) を返す。落とせなければ (None, エラー文)。"""
    cmd = ([sys.executable, '-m', 'yt_dlp', '-q', '--no-warnings', '--no-part', '-f', FORMAT,
            '-o', os.path.join(WORK, vid + '.%(ext)s')] + CLIENT + [WATCH + vid])
    r = run(cmd)
    path = media(vid)
    if r.returncode == 0 and path:
        return path, ''
    return None, (r.stderr or r.stdout).strip()[-300:]


def cleanup(vid, frames):
    """1本終わるごとに動画本体とフレームを消す(rm は使わない)。"""
    for name in os.listdir(WORK):
        if name.startswith(vid + '.'):
            try:
                os.remove(os.path.join(WORK, name))
            except OSError:
                pass
    shutil.rmtree(frames, ignore_errors=True)


def zbar_hits(img):
    """3倍に拡大して zbar で読む。(payload, 四隅) の一覧を返す。

    QR を一覧表示する動画は 360p 程度で、cv2 の検出器は 1 枚も見つけられない。
    拡大してから zbar に渡すと 1 フレームで 20 枚以上読めるので、これを主経路にする。"""
    if _zbar is None:
        return []
    k = min(UPSCALE, max(1.0, LONG_SIDE / max(img.shape[:2])))   # 元から大きい絵は拡大しない
    up = img if k <= 1.01 else cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    hits = []
    try:
        found = _zbar(up)
    except Exception:
        return []
    for d in found:
        if d.type != 'QRCODE':
            continue
        text = d.data.decode('utf-8', 'replace')
        pts = [[pt.x, pt.y] for pt in d.polygon]
        hits.append((text, pts if len(pts) == 4 else None, up))
    return hits


def crop(img, pts):
    """検出した四隅で QR を正方形に起こす(クワイエットゾーン無しの素の格子にする)。"""
    p = np.asarray(pts, np.float32).reshape(4, 2)
    dst = np.array([[0, 0], [WARP, 0], [WARP, WARP], [0, WARP]], np.float32)
    M = cv2.getPerspectiveTransform(p, dst)
    return cv2.warpPerspective(img, M, (WARP, WARP))


def scan(img, hits=None):
    """1枚の画像から YW の {payload: matrix} を返す。"""
    got = {}
    for text, pts, up in (hits if hits is not None else zbar_hits(img)):
        if not PAYLOAD.match(text) or text in got or pts is None:
            continue
        try:
            m, payload = qr_matrix.extract(crop(up, pts))
        except (cv2.error, IndexError):
            m, payload = None, ''
        if m is not None and payload.upper() == text.upper():
            got[text] = m
    det = cv2.QRCodeDetector()
    try:
        ok, texts, pts, _ = det.detectAndDecodeMulti(img)
    except cv2.error:
        ok, pts = False, None
    if ok and pts is not None:
        for i in range(len(pts)):
            try:
                m, payload = qr_matrix.extract(crop(img, pts[i]))
            except (cv2.error, IndexError):
                m, payload = None, ''
            if m is not None and PAYLOAD.match(payload) and payload not in got:
                got[payload] = m
    if not got:                       # 切り出しが効かないときは画面全体で試す
        try:
            m, payload = qr_matrix.extract(img)
        except (cv2.error, IndexError):
            m, payload = None, ''
        if m is not None and PAYLOAD.match(payload):
            got[payload] = m
    return got


def read_texts(img, hits=None):
    """写っている payload の一覧(読めなかった QR は '' で混ざる)。"""
    det = cv2.QRCodeDetector()
    try:
        ok, texts, _, _ = det.detectAndDecodeMulti(img)
    except cv2.error:
        ok, texts = False, []
    out = list(texts) if ok else []
    out += [t for t, _, _ in (hits if hits is not None else zbar_hits(img))]
    return out


def skippable(texts, found):
    """写っているのが「もう行列を取れた YW コード」と「別ゲームの QR」だけなら飛ばす。

    found のキーは大文字。同じコインでも符号化方式で大小が変わるため揃えて比べる。"""
    return bool(texts) and all(t and (not PAYLOAD.match(t) or t.upper() in found) for t in texts)


def add(state, payload, m, vid, title):
    for it in state['items']:
        if it['payload'].upper() == payload.upper():   # 大小違いは同じコイン
            if vid not in it['sources']:
                it['sources'].append(vid)
            return False
    state['items'].append({'payload': payload, 'n': int(m.shape[0]), 'rows': encode_rows(m),
                           'sources': [vid], 'title': title})
    return True


def thumbnail(vid):
    url = 'https://i.ytimg.com/vi/%s/maxresdefault.jpg' % vid
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except Exception:
        return None
    return cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)


def process(state, vid, title):
    """1本を全編処理する。動画を取得できなかったときは None を返し、処理済みに記録しない。"""
    sec = duration(vid)
    # QR_FPS を明示したときは短尺の既定(FPS_SHORT)より優先する
    fps = FPS if os.environ.get('QR_FPS') else (FPS_SHORT if 0 < sec < SHORT_SEC else FPS)
    found = {}      # payload(大文字) -> (実際の payload, matrix)

    img = thumbnail(vid)
    if img is not None:
        for p, m in scan(img).items():
            found.setdefault(p.upper(), (p, m))

    frames = os.path.join(WORK, vid)
    path, err, ok = None, '', True
    try:
        path, err = download(vid)
        if path:
            os.makedirs(frames, exist_ok=True)
            r = run(['ffmpeg', '-v', 'error', '-i', path, '-vf', 'fps=%g' % fps,
                     os.path.join(frames, 'f%06d.png')])
            if r.returncode != 0:
                print('  フレーム展開失敗 %s: %s' % (vid, r.stderr.strip()[-200:]), flush=True)
                ok = False
            names = sorted(os.listdir(frames)) if os.path.isdir(frames) else []
            for i, name in enumerate(names, 1):
                f = cv2.imread(os.path.join(frames, name))
                if f is None:
                    continue
                # 既に行列を取れた QR しか写っていないフレームは飛ばす
                hits = zbar_hits(f)         # 1フレームにつき1回だけ拡大して読む
                if not skippable(read_texts(f, hits), found):
                    for p, m in scan(f, hits).items():
                        found.setdefault(p.upper(), (p, m))
                if i % 200 == 0:
                    print('    %d/%d フレーム / QR %d 件' % (i, len(names), len(found)), flush=True)
    finally:
        cleanup(vid, frames)

    new = sum(add(state, p, m, vid, title) for p, m in found.values())
    if path and not ok:
        # フレーム展開に失敗した本は 0 件で確定させず、再実行で拾い直す
        print('  未完了 %s: フレーム展開に失敗したので処理済みにしない' % vid, flush=True)
        return None
    if not path:
        # サムネイルから拾えた分は残すが、処理済みにはしない(再実行で拾い直す)
        print('  取得失敗 %s: %s' % (vid, err), flush=True)
        return None
    state['videos'].append({'id': vid, 'title': title, 'found': len(found)})
    print('  %s : QR %d 件 (新規 %d) / %d 秒 %gfps' % (vid, len(found), new, sec, fps), flush=True)
    return len(found)


def main():
    os.makedirs(WORK, exist_ok=True)
    state = load()
    done = {v['id'] for v in state['videos']}

    order = targets()
    only = set(sys.argv[1:])             # 引数で動画 ID を絞ると試走できる
    if only:
        order = [t for t in order if t[0] in only]
        done -= only                                     # ID 指定なら処理済みでもやり直す
        state['videos'] = [v for v in state['videos'] if v['id'] not in only]
    todo = [t for t in order if t[0] not in done]
    print('対象 %d 本 / 処理済み %d 本 / 今回 %d 本'
          % (len(order), len(order) - len(todo), len(todo)), flush=True)

    for i, (vid, title) in enumerate(todo, 1):
        print('[%d/%d] %s %s' % (i, len(todo), vid, title), flush=True)
        try:
            process(state, vid, title)
        except Exception as e:
            print('  エラー %s: %s: %s' % (vid, type(e).__name__, e), flush=True)
        save(state)

    print('動画 %d 本 / ユニーク QR %d 件 / %.2f MB'
          % (len(state['videos']), len(state['items']), os.path.getsize(OUT) / 1048576), flush=True)


if __name__ == '__main__':
    main()
