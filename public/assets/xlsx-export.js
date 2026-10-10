/* Shared Excel (.xlsx) writer for the MSR and DSR exports.
   No external libraries: builds the workbook XML and a stored (uncompressed) zip in the browser.
   Sheets: [{ name, rows:[{ kind:'title'|'note'|'head'|'data'|'total'|'blank', tint?, cells:[...] }] }]
   A cell is a plain value, or { v, fill?, bold?, fmt? } where fill is a hex colour (e.g. product colour). */
(function () {
  'use strict';
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var colName = function (i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  var hex = function (h) { var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); return m ? m[1].toUpperCase() : null; };
  var rgb = function (h) { var x = hex(h); if (!x) return null; var n = parseInt(x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  var luma = function (h) { var c = rgb(h); if (!c) return 1; return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; };
  // Light tint of a colour (mixed with white) for row banding
  var tint = function (h, amt) {
    var c = rgb(h); if (!c) return null; var a = amt == null ? 0.8 : amt;
    return c.map(function (v) { return Math.round(v + (255 - v) * a).toString(16).padStart(2, '0'); }).join('').toUpperCase();
  };
  var textLen = function (v) {
    if (typeof v === 'number') { var s = String(Number.isInteger(v) ? v : Math.round(v)); return s.length + Math.floor(s.length / 3) + (Number.isInteger(v) ? 0 : 3); }
    return String(v).length;
  };

  // Styles registry (fonts, fills, number formats and cell formats are added as they are used)
  function Styles() {
    this.fonts = ['<font><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.fmts = {}; this.nextFmt = 164;
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.map = {};
  }
  Styles.prototype.add = function (list, xml) { var i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1; } return i; };
  Styles.prototype.get = function (o) {
    var key = JSON.stringify(o); if (this.map[key] != null) return this.map[key];
    var fontId = this.add(this.fonts, '<font>' + (o.b ? '<b/>' : '') + '<sz val="' + (o.sz || 11) + '"/><color rgb="FF' + (o.color || '0F172A') + '"/><name val="Calibri"/></font>');
    var fillId = o.fill ? this.add(this.fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + o.fill + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
    var fmtId = 0;
    if (o.fmt === 'int') fmtId = 3;
    else if (o.fmt === '2dp') { if (!this.fmts['#,##0.00']) this.fmts['#,##0.00'] = this.nextFmt++; fmtId = this.fmts['#,##0.00']; }
    var align = (o.align || o.wrap) ? '<alignment' + (o.align ? ' horizontal="' + o.align + '"' : '') + (o.wrap ? ' wrapText="1"' : '') + ' vertical="center"/>' : '';
    this.xfs.push('<xf numFmtId="' + fmtId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"' + (align ? ' applyAlignment="1">' + align + '</xf>' : '/>'));
    this.map[key] = this.xfs.length - 1; return this.map[key];
  };
  Styles.prototype.xml = function () {
    var fm = Object.keys(this.fmts).map(function (c) { return '<numFmt numFmtId="' + this.fmts[c] + '" formatCode="' + esc(c) + '"/>'; }, this).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (fm ? '<numFmts count="' + Object.keys(this.fmts).length + '">' + fm + '</numFmts>' : '') +
      '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts>' +
      '<fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  };

  // Zip (stored, no compression)
  var crcTable = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  var crc32 = function (u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  var zip = function (files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 33, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 33, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (a, p) { return a + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]);
    var total = all.reduce(function (a, p) { return a + p.length; }, 0), out = new Uint8Array(total), o = 0;
    all.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  };

  function build(sheets) {
    var st = new Styles(), sheetXml = [], names = [];
    sheets.forEach(function (sh, si) {
      var widths = [], xmlRows = '';
      (sh.rows || []).forEach(function (r, ri) {
        var cells = r.cells || []; if (!cells.length) return;
        var cs = '';
        cells.forEach(function (c0, ci) {
          var c = (c0 && typeof c0 === 'object') ? c0 : { v: c0 };
          var v = c.v; if (v === null || v === undefined || v === '') return;
          var ref = colName(ci) + (ri + 1), kind = r.kind || 'data', o;
          if (kind === 'title') o = { b: true, sz: 13, color: '0F172A' };
          else if (kind === 'note') o = { color: '64748B' };
          else if (kind === 'head') o = { b: true, color: 'FFFFFF', fill: '0F172A', wrap: true, align: 'left' };
          else if (kind === 'total') o = { b: true, fill: 'E2E8F0', color: '0F172A' };
          else { o = { color: '0F172A' }; var t = r.tint ? tint(r.tint) : null; if (t) o.fill = t; }
          if (c.fill && hex(c.fill)) { o.fill = hex(c.fill); o.color = luma(c.fill) < 0.55 ? 'FFFFFF' : '0F172A'; }
          if (c.bold) o.b = true;
          if (typeof v === 'number' && (kind === 'data' || kind === 'total')) o.fmt = Number.isInteger(v) ? 'int' : '2dp';
          if (kind === 'data' && c.align) o.align = c.align;
          var s = st.get(o);
          if (kind !== 'title' && kind !== 'note' && kind !== 'blank') widths[ci] = Math.max(widths[ci] || 0, textLen(v) * 1.1 + 3);
          if (typeof v === 'number') cs += '<c r="' + ref + '" s="' + s + '"><v>' + v + '</v></c>';
          else cs += '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
        });
        if (cs) xmlRows += '<row r="' + (ri + 1) + '">' + cs + '</row>';
      });
      var cols = '';
      widths.forEach(function (w, i) { if (w) cols += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.min(60, Math.max(9, w)).toFixed(1) + '" customWidth="1"/>'; });
      sheetXml.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+'<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16"/>' + (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + xmlRows + '</sheetData>'+'<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/></worksheet>');
      names.push(String(sh.name || ('Sheet' + (si + 1))).replace(/[\\\/\?\*\[\]:]/g, '').slice(0, 31) || ('Sheet' + (si + 1)));
    });
    var files = [{ name: '[Content_Types].xml', data: '' }];
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    sheetXml.forEach(function (_, i) { ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; });
    ct += '</Types>';
    files[0].data = ct;
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    names.forEach(function (n, i) { wb += '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; });
    wb += '</sheets></workbook>';
    files.push({ name: 'xl/workbook.xml', data: wb });
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    names.forEach(function (_, i) { rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; });
    rels += '<Relationship Id="rId' + (names.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: rels });
    sheetXml.forEach(function (x, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: x }); });
    files.push({ name: 'xl/styles.xml', data: st.xml() });
    return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  window.XlsxExport = { build: build, download: download, tint: tint, hex: hex };
})();
