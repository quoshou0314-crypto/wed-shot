// 打包 dist/ 成 Chrome Web Store 上傳用 zip:release/wed-shot-<version>.zip
// 自己組 zip(deflate),避免 Windows Compress-Archive 寫出反斜線路徑被商店拒收
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const out = `release/wed-shot-${version}.zip`;

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const locals = [];
const centrals = [];
let offset = 0;
for (const file of walk('dist')) {
  const name = Buffer.from(relative('dist', file).split('\\').join('/'));
  const raw = readFileSync(file);
  const data = deflateRawSync(raw, { level: 9 });
  const crc = crc32(raw);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0x0800, 6); // UTF-8 檔名
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt32LE(0x21, 10); // 時間/日期:1980-01-01,讓產物可重現
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(data.length, 18);
  head.writeUInt32LE(raw.length, 22);
  head.writeUInt16LE(name.length, 26);
  locals.push(head, name, data);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(0x21, 12);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(data.length, 20);
  cen.writeUInt32LE(raw.length, 24);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(offset, 42);
  centrals.push(cen, name);
  offset += head.length + name.length + data.length;
}
const cenSize = centrals.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(cenSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync('release', { recursive: true });
writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${out}  (${centrals.length / 2} files)`);
