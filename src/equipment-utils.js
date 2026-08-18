function normalizeAcquisition(value) {
  return value
    .replace(/^ビッグボスがドロップ：/, '')
    .replace(/\s*でドロップ\s*$/, '')
    .replace(/・(ノーマル|超|極)・/g, '・$1モード・')
    .trim()
    // 出典に当たり枠の記載が無いものは「ドロップ」とだけ書かれる。
    // 大当たり〜ハズレと並べたときに調べ漏れに見えないよう、枠が不明だと明示する。
    // 「当たり枠不明」だと390px幅で折り返す行が出るうえ、実機のフォント差で増えるので「枠不明」に縮めている。
    .replace(/・ドロップ$/, '・枠不明');
}

module.exports = { normalizeAcquisition };
