/*
 * Self-contained PDF generator (no external dependencies).
 * Parses a markdown subset and renders a styled, multi-page A4 PDF
 * using the standard 14 PDF fonts (Helvetica, Helvetica-Bold, Courier).
 */
const fs = require("fs");

const SRC = process.argv[2] || "fullstack-production-guide.md";
const OUT = process.argv[3] || "Fullstack-Production-Guide.pdf";

// ---------- Adobe AFM glyph widths (units / 1000 em) for ASCII 32..126 ----------
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
function widthOf(ch, bold, mono) {
  if (mono) return 600;
  const c = ch.charCodeAt(0);
  if (c < 32 || c > 126) return bold ? 556 : 556;
  return (bold ? HELVB : HELV)[c - 32];
}
function textWidth(str, size, bold, mono) {
  let w = 0;
  for (const ch of str) w += widthOf(ch, bold, mono);
  return (w / 1000) * size;
}

// ---------- ASCII sanitize + PDF string escape ----------
function sanitize(s) {
  return s
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2026]/g, "...")
    .replace(/[\u2192\u21D2]/g, "->")
    .replace(/[\u2022\u00B7]/g, "-")
    .replace(/[\u00A0]/g, " ")
    .replace(/[^\x20-\x7E]/g, "");
}
function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function stripInline(s) {
  // remove markdown emphasis / code markers, keep text
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

// ---------- Markdown subset parser ----------
function parse(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "para", text: stripInline(para.join(" ")).trim() });
      para = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushPara();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "code", lines: code });
      continue;
    }
    if (/^#\s+/.test(line)) { flushPara(); blocks.push({ type: "title", text: stripInline(line.replace(/^#\s+/, "")).trim() }); i++; continue; }
    if (/^##\s+/.test(line)) { flushPara(); blocks.push({ type: "h1", text: stripInline(line.replace(/^##\s+/, "")).trim() }); i++; continue; }
    if (/^###\s+/.test(line)) { flushPara(); blocks.push({ type: "h2", text: stripInline(line.replace(/^###\s+/, "")).trim() }); i++; continue; }
    if (/^---\s*$/.test(line)) { flushPara(); blocks.push({ type: "rule" }); i++; continue; }
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      const level = Math.floor(bullet[1].length / 2) + 1;
      blocks.push({ type: "bullet", level, text: stripInline(bullet[2]).trim() });
      i++;
      continue;
    }
    if (line.trim() === "") { flushPara(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flushPara();
  return blocks;
}

// ---------- Layout engine ----------
const PAGE_W = 595.28, PAGE_H = 841.89;
const M_LEFT = 56, M_RIGHT = 56, M_TOP = 64, M_BOTTOM = 58;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const ACCENT = [0.04, 0.35, 0.55];   // teal-blue
const ACCENT2 = [0.85, 0.34, 0.10];  // orange (subsection)
const CODE_BG = [0.96, 0.96, 0.94];
const CODE_FG = [0.12, 0.12, 0.12];
const RULE_C = [0.8, 0.8, 0.8];
const MUTED = [0.42, 0.42, 0.42];

const docTitle = "Production Fullstack Guide";

function wrap(text, size, bold, mono, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, size, bold, mono) <= maxW || !cur) {
      // if a single word is too long, hard-break it
      if (!cur && textWidth(w, size, bold, mono) > maxW) {
        let chunk = "";
        for (const ch of w) {
          if (textWidth(chunk + ch, size, bold, mono) > maxW && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        cur = chunk;
      } else {
        cur = test;
      }
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Each page collects an array of drawing ops as content-stream strings.
const pages = [];
let page = null;
let y = 0;

function newPage() {
  page = { ops: [], isCover: false };
  pages.push(page);
  y = PAGE_H - M_TOP;
}
function ensure(h) {
  if (y - h < M_BOTTOM) newPage();
}
function drawTextLine(str, x, yy, size, font, color) {
  const [r, g, b] = color;
  page.ops.push(
    `BT /${font} ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg 1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm (${esc(sanitize(str))}) Tj ET`
  );
}
function fillRect(x, yy, w, h, color) {
  const [r, g, b] = color;
  page.ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
}

function renderParagraph(text, opts = {}) {
  const size = opts.size || 10.5;
  const lead = opts.lead || 15;
  const bold = opts.bold || false;
  const font = bold ? "F2" : "F1";
  const color = opts.color || [0.1, 0.1, 0.1];
  const indent = opts.indent || 0;
  const maxW = CONTENT_W - indent;
  const lines = wrap(text, size, bold, false, maxW);
  for (const ln of lines) {
    ensure(lead);
    drawTextLine(ln, M_LEFT + indent, y - size, size, font, color);
    y -= lead;
  }
}

function renderBullet(text, level) {
  const size = 10.5, lead = 14.5;
  const indent = 14 + (level - 1) * 16;
  const maxW = CONTENT_W - indent;
  const lines = wrap(text, size, false, false, maxW);
  for (let k = 0; k < lines.length; k++) {
    ensure(lead);
    if (k === 0) {
      // marker dot
      fillRect(M_LEFT + indent - 9, y - size + 2.5, 3, 3, ACCENT);
    }
    drawTextLine(lines[k], M_LEFT + indent, y - size, size, "F1", [0.12, 0.12, 0.12]);
    y -= lead;
  }
}

function renderCode(codeLines) {
  const size = 9, lead = 12.4, padX = 8, padY = 6;
  // expand tabs, sanitize
  const flat = codeLines.map((l) => sanitize(l.replace(/\t/g, "  ")));
  // wrap long code lines to content width
  const maxChars = Math.floor((CONTENT_W - padX * 2) / ((600 / 1000) * size));
  const out = [];
  for (const l of flat) {
    if (l.length <= maxChars) out.push(l);
    else {
      for (let p = 0; p < l.length; p += maxChars) out.push(l.slice(p, p + maxChars));
    }
  }
  const boxH = out.length * lead + padY * 2;
  // keep block together if it fits a page; else allow break
  if (boxH <= PAGE_H - M_TOP - M_BOTTOM) ensure(boxH + 6);
  // draw background (may span; redraw per page if it breaks)
  let idx = 0;
  while (idx < out.length) {
    const remaining = out.length - idx;
    const avail = Math.floor((y - M_BOTTOM - padY * 2) / lead);
    const take = Math.max(1, Math.min(remaining, avail));
    const segH = take * lead + padY * 2;
    fillRect(M_LEFT, y - segH, CONTENT_W, segH, CODE_BG);
    // left accent bar
    fillRect(M_LEFT, y - segH, 2.5, segH, ACCENT);
    let yy = y - padY - size;
    for (let k = 0; k < take; k++) {
      drawTextLine(out[idx + k], M_LEFT + padX, yy, size, "F3", CODE_FG);
      yy -= lead;
    }
    idx += take;
    y -= segH;
    if (idx < out.length) {
      newPage();
    }
  }
  y -= 8;
}

function renderH1(text) {
  ensure(46);
  y -= 12;
  const size = 16;
  ensure(size + 14);
  drawTextLine(text, M_LEFT, y - size, size, "F2", ACCENT);
  y -= size + 5;
  fillRect(M_LEFT, y, CONTENT_W, 1.4, ACCENT);
  y -= 12;
}

function renderH2(text) {
  ensure(30);
  y -= 8;
  const size = 12.5;
  ensure(size + 8);
  drawTextLine(text, M_LEFT, y - size, size, "F2", ACCENT2);
  y -= size + 7;
}

function renderRule() {
  ensure(12);
  y -= 4;
  fillRect(M_LEFT, y, CONTENT_W, 0.6, RULE_C);
  y -= 10;
}

// ---------- Cover + Contents ----------
function buildCover(title, sections) {
  newPage();
  page.isCover = true;
  // top accent band
  fillRect(0, PAGE_H - 150, PAGE_W, 150, ACCENT);
  drawTextLine("PRODUCTION REFERENCE", M_LEFT, PAGE_H - 78, 12, "F2", [1, 1, 1]);
  // title (may wrap)
  const tlines = wrap(title, 30, true, false, CONTENT_W);
  let ty = PAGE_H - 112;
  for (const ln of tlines) {
    drawTextLine(ln, M_LEFT, ty, 30, "F2", [1, 1, 1]);
    ty -= 34;
  }
  // subtitle block
  let sy = PAGE_H - 210;
  const subs = [
    "Django backend + Next.js / TypeScript frontend",
    "What actually matters when you ship to real users.",
  ];
  for (const s of subs) {
    drawTextLine(s, M_LEFT, sy, 13, "F1", [0.15, 0.15, 0.15]);
    sy -= 20;
  }
  drawTextLine("Generated: May 2026", M_LEFT, sy - 4, 10, "F1", MUTED);
  // contents
  let cy = PAGE_H - 300;
  drawTextLine("Contents", M_LEFT, cy, 15, "F2", ACCENT);
  cy = cy - 26;
  for (const sec of sections) {
    if (cy < M_BOTTOM + 20) break;
    fillRect(M_LEFT + 1, cy + 1.5, 3, 3, ACCENT2);
    drawTextLine(sec, M_LEFT + 14, cy, 11, "F1", [0.18, 0.18, 0.18]);
    cy -= 18;
  }
}

// ---------- Build ----------
const md = fs.readFileSync(SRC, "utf8");
const blocks = parse(md);
const title = (blocks.find((b) => b.type === "title") || {}).text || docTitle;
const sections = blocks.filter((b) => b.type === "h1").map((b) => b.text);

buildCover(title, sections);
newPage(); // first content page

for (const b of blocks) {
  switch (b.type) {
    case "title": break; // used on cover
    case "h1": renderH1(b.text); break;
    case "h2": renderH2(b.text); break;
    case "para": renderParagraph(b.text); y -= 5; break;
    case "bullet": renderBullet(b.text, b.level); break;
    case "code": renderCode(b.lines); break;
    case "rule": renderRule(); break;
  }
}

// ---------- Headers / footers (second pass) ----------
const total = pages.length;
pages.forEach((p, idx) => {
  const n = idx + 1;
  if (!p.isCover) {
    // header
    const [r, g, bl] = MUTED;
    p.ops.unshift(`BT /F1 8.5 Tf ${r} ${g} ${bl} rg 1 0 0 1 ${M_LEFT} ${PAGE_H - 40} Tm (${esc(sanitize(docTitle))}) Tj ET`);
    p.ops.unshift(`${RULE_C[0]} ${RULE_C[1]} ${RULE_C[2]} rg ${M_LEFT} ${PAGE_H - 46} ${CONTENT_W} 0.5 re f`);
  }
  // footer page number (all pages)
  const label = `${n} / ${total}`;
  const fw = textWidth(label, 9, false, false);
  p.ops.push(`BT /F1 9 Tf ${MUTED[0]} ${MUTED[1]} ${MUTED[2]} rg 1 0 0 1 ${(PAGE_W - fw) / 2} ${M_BOTTOM - 22} Tm (${esc(label)}) Tj ET`);
});

// ---------- Assemble PDF ----------
const objects = []; // string bodies, 1-indexed by position
function addObj(body) { objects.push(body); return objects.length; }

// Fonts
const fontHel = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
const fontHelB = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
const fontCour = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");

const resources = `<< /Font << /F1 ${fontHel} 0 R /F2 ${fontHelB} 0 R /F3 ${fontCour} 0 R >> >>`;

const pagesObjId = objects.length + 1; // reserve: we'll add pages tree after page objs
// Create content + page objects
const pageObjIds = [];
const contentObjIds = [];
// Placeholder for Pages object index; compute later. We'll add page objects first.
// To reference Pages parent we need its id; assign now.
const PAGES_ID_PLACEHOLDER = "__PAGES__";

for (const p of pages) {
  const stream = p.ops.join("\n");
  const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  contentObjIds.push(contentId);
  const pageId = addObj(
    `<< /Type /Page /Parent ${PAGES_ID_PLACEHOLDER} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${contentId} 0 R >>`
  );
  pageObjIds.push(pageId);
}

const kids = pageObjIds.map((id) => `${id} 0 R`).join(" ");
const pagesId = addObj(`<< /Type /Pages /Count ${pageObjIds.length} /Kids [ ${kids} ] >>`);
// patch placeholders
for (let i = 0; i < objects.length; i++) {
  objects[i] = objects[i].split(PAGES_ID_PLACEHOLDER).join(String(pagesId));
}
const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

// Serialize with xref
let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
const offsets = [];
for (let i = 0; i < objects.length; i++) {
  offsets[i] = Buffer.byteLength(pdf, "latin1");
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefStart = Buffer.byteLength(pdf, "latin1");
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";
for (let i = 0; i < objects.length; i++) {
  pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

fs.writeFileSync(OUT, Buffer.from(pdf, "latin1"));
console.log(`OK: wrote ${OUT}`);
console.log(`Pages: ${pages.length}, Objects: ${objects.length}, Bytes: ${Buffer.byteLength(pdf, "latin1")}`);
