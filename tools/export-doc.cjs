const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'DOKUMEN_PENJELASAN_KARYA_LOMBA.html');
const docPath = path.join(__dirname, '..', 'DOKUMEN_PENJELASAN_KARYA_LOMBA.doc');

const html = fs.readFileSync(htmlPath, 'utf8');
const headIndex = html.indexOf('<head>');
const docHtml = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">\n' + html.slice(headIndex);

fs.writeFileSync(docPath, docHtml, 'utf8');
console.log('Successfully updated DOKUMEN_PENJELASAN_KARYA_LOMBA.doc');
