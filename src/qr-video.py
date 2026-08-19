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
FPS = 0.5          # フレーム展開のレート
FPS_SHORT = 2      # SHORT_SEC 秒に満たない短い動画はこちらで細かく見る
SHORT_SEC = 60
WARP = 512         # QR を切り出すときの正方形サイズ
FORMAT = 'bv*[height<=720][ext=mp4]/bv*[height<=720]/best[height<=720]/best'
# これが無いと既定クライアントが android_vr に落ちて全動画 403 になる
CLIENT = ['--extractor-args', 'youtube:player_client=android']
PAYLOAD = re.compile(r'^https?://YW\.B-BOYS\.JP/', re.I)


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
    cmd = ([sys.executable, '-m', 'yt_dlp', '-q', '--no-warnings', '-f', FORMAT,
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


def crop(img, pts):
    """検出した四隅で QR を正方形に起こす(クワイエットゾーン無しの素の格子にする)。"""
    p = np.asarray(pts, np.float32).reshape(4, 2)
    dst = np.array([[0, 0], [WARP, 0], [WARP, WARP], [0, WARP]], np.float32)
    M = cv2.getPerspectiveTransform(p, dst)
    return cv2.warpPerspective(img, M, (WARP, WARP))


def scan(img):
    """1枚の画像から YW の {payload: matrix} を返す。"""
    got = {}
    det = cv2.QRCodeDetector()
    try:
        ok, texts, pts, _ = det.detectAndDecodeMulti(img)
    except cv2.error:
        ok, pts = False, None
    if ok and pts is not None:
        for i in range(len(pts)):
            try:
                m, payload = qr_matrix.extract(crop(img, pts[i]))
            except cv2.error:
                m, payload = None, ''
            if m is not None and PAYLOAD.match(payload) and payload not in got:
                got[payload] = m
    if not got:                       # 切り出しが効かないときは画面全体で試す
        m, payload = qr_matrix.extract(img)
        if m is not None and PAYLOAD.match(payload):
            got[payload] = m
    return got


def read_texts(img):
    """cv2 が素直に読めた payload の一覧(読めなかった QR は '' で混ざる)。"""
    det = cv2.QRCodeDetector()
    try:
        ok, texts, _, _ = det.detectAndDecodeMulti(img)
    except cv2.error:
        return []
    return list(texts) if ok else []


def skippable(texts, found):
    """写っているのが「もう行列を取れた YW コード」と「別ゲームの QR」だけなら飛ばす。"""
    return bool(texts) and all(t and (not PAYLOAD.match(t) or t in found) for t in texts)


def add(state, payload, m, vid, title):
    for it in state['items']:
        if it['payload'] == payload:
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
    fps = FPS_SHORT if 0 < sec < SHORT_SEC else FPS
    found = {}      # payload -> matrix

    img = thumbnail(vid)
    if img is not None:
        found.update(scan(img))

    frames = os.path.join(WORK, vid)
    path, err = None, ''
    try:
        path, err = download(vid)
        if path:
            os.makedirs(frames, exist_ok=True)
            r = run(['ffmpeg', '-v', 'error', '-i', path, '-vf', 'fps=%g' % fps,
                     os.path.join(frames, 'f%06d.png')])
            if r.returncode != 0:
                print('  フレーム展開失敗 %s: %s' % (vid, r.stderr.strip()[-200:]), flush=True)
            names = sorted(os.listdir(frames)) if os.path.isdir(frames) else []
            for i, name in enumerate(names, 1):
                f = cv2.imread(os.path.join(frames, name))
                if f is None:
                    continue
                # 既に行列を取れた QR しか写っていないフレームは飛ばす
                if not skippable(read_texts(f), found):
                    for p, m in scan(f).items():
                        found.setdefault(p, m)
                if i % 200 == 0:
                    print('    %d/%d フレーム / QR %d 件' % (i, len(names), len(found)), flush=True)
    finally:
        cleanup(vid, frames)

    new = sum(add(state, p, m, vid, title) for p, m in found.items())
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
