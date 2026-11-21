'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const viewFiles = [
  'dashboard.ejs',
  'users.ejs',
  'masters.ejs',
  'categories.ejs',
  'tracks.ejs',
  'subscriptions.ejs',
  'transactions.ejs',
];

const tokensPath = path.join(root, 'public', 'css', 'admin-tokens.css');
const componentsPath = path.join(root, 'public', 'css', 'admin-components.css');
const formsPath = path.join(root, 'public', 'css', 'admin-forms.css');
const dashboardPath = path.join(root, 'public', 'css', 'admin-dashboard.css');
const shellPath = path.join(root, 'public', 'css', 'admin-shell.css');
const loginPath = path.join(root, 'public', 'css', 'admin-login.css');
const outPath = path.join(root, 'public', 'css', 'admin.css');

let pageCss = '';
for (const file of viewFiles) {
  const full = path.join(root, 'views', file);
  let content = fs.readFileSync(full, 'utf8');
  const styles = [];
  const re = /<style>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    styles.push(m[1].trim());
  }
  if (styles.length) {
    pageCss += `\n/* ---- ${file} ---- */\n` + styles.join('\n') + '\n';
    content = content.replace(re, '');
    fs.writeFileSync(full, content, 'utf8');
    console.log(`Stripped ${styles.length} style block(s) from ${file}`);
  }
}

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const tokens = readIf(tokensPath);
const components = readIf(componentsPath);
const forms = readIf(formsPath);
const dashboardCss = readIf(dashboardPath);
const shell = readIf(shellPath);
const loginCss = readIf(loginPath);

fs.writeFileSync(
  outPath,
  `/* iTorus Admin — consolidated design system */\n${tokens}\n${shell}\n${forms}\n${components}\n${dashboardCss}\n${loginCss}\n${pageCss}`,
  'utf8'
);
console.log('Wrote', outPath);