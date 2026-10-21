import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { textPdf } from '../dist/tests/tests/fixture.js';
import { validatePdf } from '../dist/server/pdf.js';

// Synthetic metadata only: no existing library records or original files are read.
const source = textPdf('').toString().replace('/Title () /Author (Ada Lovelace; Alan Turing)', '/Title () /Subject () /Author () /Creator (LaTeX with hyperref)');
const objects = [...source.matchAll(/\d+ 0 obj\n([\s\S]*?)\nendobj/g)].map(match => match[1]);
let pdf = '%PDF-1.7\n';
const offsets = [0];
objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const bytes = Buffer.from(pdf);
const pdfinfo = await new Promise((resolve, reject) => {
  const child = execFile('pdfinfo', ['-'], { timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  child.stdin.on('error', reject); child.stdin.end(bytes);
});
const parsed = await validatePdf(bytes);
assert.equal(parsed.title, undefined);
assert.equal(parsed.authors, undefined);
console.log(JSON.stringify({ fixture: 'Empty Title, Subject and Author; Creator LaTeX with hyperref', pdfinfo, parsed }, null, 2));
