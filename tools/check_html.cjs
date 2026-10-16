const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const stack = [];
const re = /<\/?([a-zA-Z0-9]+)([^>]*?)>/g;
let m;
const selfClosing = new Set(['link', 'meta', 'br', 'hr', 'img', 'input', 'polygon', 'path', 'circle', 'rect']);
let line = 1;
let lastIndex = 0;
let errors = 0;
while ((m = re.exec(html)) !== null) {
  const isClose = m[0].startsWith('</');
  const tag = m[1].toLowerCase();
  const raw = m[0];
  const isSelf = raw.endsWith('/>') || selfClosing.has(tag);
  const upTo = html.slice(lastIndex, m.index);
  line += (upTo.match(/\n/g) || []).length;
  lastIndex = m.index;
  if (isClose) {
    if (!stack.length) {
      console.log('Extra closing tag </' + tag + '> at line ' + line);
      errors++;
    } else {
      const top = stack.pop();
      if (top.tag !== tag) {
        console.log('Mismatch at line ' + line + ': expected </' + top.tag + ' (opened at line ' + top.line + ' ' + top.id + ')>, found </' + tag + '>');
        errors++;
      }
    }
  } else if (!isSelf) {
    const idM = raw.match(/id=["']([^"']+)["']/);
    stack.push({ tag, line, id: idM ? '#' + idM[1] : '' });
  }
}
console.log('Unclosed tags at end:', stack.map(s => s.tag + ' ' + s.id + ' (line ' + s.line + ')'));
if (stack.length) errors += stack.length;
if (errors) { console.error('HTML CHECK FAILED (' + errors + ' issue(s))'); process.exit(1); }
console.log('HTML CHECK PASSED');
