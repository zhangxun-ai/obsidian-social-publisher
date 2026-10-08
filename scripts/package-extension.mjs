import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Fixed allowlist: never package vaults, settings, developer files or credentials.
const files = ['manifest.json', 'background.js', 'popup.html', 'popup.css', 'popup.js', 'account.js', 'adapter.js', ...[16,32,48,128].map(size=>`icons/icon-${size}.png`)];
const manifest=JSON.parse(await readFile('extension/manifest.json','utf8'));
assert.equal(manifest.manifest_version,3);
assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=data=>{let crc=0xffffffff;for(const byte of data)crc=table[(crc^byte)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;};
const local=[],central=[];let offset=0;
for(const name of [...files,'LICENSE']){
  const data=await readFile(name==='LICENSE'?'LICENSE':`extension/${name}`);
  const filename=Buffer.from(name);const crc=crc32(data);
  // Deterministic ZIP entries (stored, UTF-8, 1980-01-01), readable without build tools.
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
  local.push(header,filename,data);central.push(entry,filename);offset+=header.length+filename.length+data.length;
}
const directory=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length+1,8);end.writeUInt16LE(files.length+1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await mkdir('dist',{recursive:true});
const path=`dist/social-publisher-browser-${manifest.version}.zip`;
await writeFile(path,Buffer.concat([...local,directory,end]));
console.log(`Chrome Web Store 提交包：${path}`);
