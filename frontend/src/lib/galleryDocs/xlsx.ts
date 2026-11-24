/**
 * 아주 작은 엑셀(.xlsx) 만들기 (2026-11-24, 규칙 92) — 작품 리스트 한 장.
 *
 * CSV 를 쓰지 않은 까닭: 한국어 엑셀에서 BOM·구분자 문제로 글자가 깨지거나 한 칸에 몰리는 일이 흔하고,
 * 가격을 숫자 칸으로 넘길 수 없다. .xlsx 는 ZIP 안의 XML 몇 장이라 이미 쓰는 JSZip 으로 만든다(새 라이브러리 없음).
 *  - 글자는 셀 안 문자열(inlineStr) — '=' 로 시작해도 수식이 되지 않는다(수식 주입 없음)
 *  - 첫 줄 고정 · 자동 필터 · 머리 굵게 · 숫자는 1,000 단위 쉼표
 */
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** XML 에 넣을 수 없는 문자 제거 + 이스케이프 */
export function xmlText(s: unknown): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 0 → A, 25 → Z, 26 → AA */
export function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** 시트 이름 — 31자 · []:*?/\ 금지 */
export function sheetName(s: string): string {
  return (s.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet1').slice(0, 31);
}

/** sheet1.xml 본문 — 순수 함수(테스트가 XML 로 읽는다) */
export function sheetXml(head: string[], rows: (string | number | null)[][], widths: number[]): string {
  const cell = (r: number, c: number, v: string | number | null, style: number) => {
    const ref = `${colName(c)}${r}`;
    if (v == null || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style === 1 ? 1 : 2}"><v>${v}</v></c>`;
    const t = xmlText(v);
    const space = /^\s|\s$/.test(t) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t${space}>${t}</t></is></c>`;
  };
  const lastCol = colName(head.length - 1);
  const lastRow = rows.length + 1;
  const xmlRows = [
    `<row r="1">${head.map((h, c) => cell(1, c, h, 1)).join('')}</row>`,
    ...rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(i + 2, c, v, 0)).join('')}</row>`),
  ].join('');
  return XML_HEAD
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<dimension ref="A1:${lastCol}${lastRow}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="18"/>'
    + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${xmlRows}</sheetData>`
    + `<autoFilter ref="A1:${lastCol}${lastRow}"/>`
    + '</worksheet>';
}

const STYLES = XML_HEAD
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/** .xlsx Blob — 시트 하나 */
export async function buildXlsx(name: string, head: string[], rows: (string | number | null)[][], widths: number[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', XML_HEAD
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels', XML_HEAD
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  zip.file('xl/workbook.xml', XML_HEAD
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${xmlText(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets>`
    + `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xmlText(sheetName(name)).replace(/'/g, "''")}'!$A$1:$${colName(head.length - 1)}$${rows.length + 1}</definedName></definedNames>`
    + '</workbook>');
  zip.file('xl/_rels/workbook.xml.rels', XML_HEAD
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>');
  zip.file('xl/styles.xml', STYLES);
  zip.file('xl/worksheets/sheet1.xml', sheetXml(head, rows, widths));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
