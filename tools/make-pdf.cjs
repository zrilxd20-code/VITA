const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const htmlFile = path.resolve(__dirname, '..', 'DOKUMEN_PENJELASAN_KARYA_LOMBA.html');
const pdfFile = path.resolve(__dirname, '..', 'DOKUMEN_PENJELASAN_KARYA_LOMBA.pdf');

const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];

const edge = edgePaths.find(p => fs.existsSync(p));
if (!edge) {
    console.error('No Edge or Chrome browser found');
    process.exit(1);
}

console.log('Using browser:', edge);
const args = [
    '--headless',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfFile}`,
    `file:///${htmlFile.replace(/\\/g, '/')}`
];

try {
    execFileSync(edge, args, { stdio: 'inherit' });
    if (fs.existsSync(pdfFile)) {
        console.log('SUCCESS: PDF created at', pdfFile, 'size:', fs.statSync(pdfFile).size);
    } else {
        console.error('PDF file was not created');
    }
} catch (e) {
    console.error('Error generating PDF:', e.message);
}
