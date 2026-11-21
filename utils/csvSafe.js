'use strict';

function csvEscape(value) {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells) {
  return (cells || []).map(csvEscape).join(',');
}

function csvWithBom(rows) {
  return `\uFEFF${rows.join('\n')}\n`;
}

module.exports = { csvEscape, csvRow, csvWithBom };