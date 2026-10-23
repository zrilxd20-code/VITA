const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const bin = fs.existsSync(edgePath) ? edgePath : (fs.existsSync(chromePath) ? chromePath : null);

if (!bin) {
  console.error('No Chromium browser found');
  process.exit(1);
}

const inputHtml = 'file:///' + path.resolve(__dirname, '..', 'DOKUMEN_PENJELASAN_KARYA_LOMBA.html').replace(/\\/g, '/');
const outputPdf = path.resolve(__dirname, '..', 'DOKUMEN_PENJELASAN_KARYA_LOMBA_FINAL.pdf');

const cmd = `"${bin}" --headless --disable-gpu --print-to-pdf="${outputPdf}" --no-pdf-header-footer "${inputHtml}"`;
console.log('Generating PDF...');
execSync(cmd);
console.log('PDF successfully generated at:', outputPdf);
