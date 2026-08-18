function normalizeAcquisition(value) {
  return value
    .replace(/^ビッグボスがドロップ：/, '')
    .replace(/\s*でドロップ\s*$/, '')
    .replace(/・(ノーマル|超|極)・/g, '・$1モード・')
    .trim();
}

module.exports = { normalizeAcquisition };
