const fs = require('fs');
const path = require('path');

const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'DOKUMEN_PENJELASAN_KARYA_LOMBA.html'), 'utf8');

const wordXml = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>Dokumen Penjelasan Karya - VITA</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
</head>
<body>
${htmlContent}
</body>
</html>
`;

const outputPath = path.join(__dirname, '..', 'DOKUMEN_PENJELASAN_KARYA_LOMBA.doc');
fs.writeFileSync(outputPath, wordXml, 'utf8');
console.log('SUCCESS: Word DOC generated at', outputPath, 'size:', fs.statSync(outputPath).size);
