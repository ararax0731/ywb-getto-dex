// GitHub Pages と同じ条件（index.html をそのまま配信）で確認するためのサーバ
const http = require('http'), fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'index.html');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
}).listen(8791, '127.0.0.1', () => console.log('serving on http://127.0.0.1:8791'));
