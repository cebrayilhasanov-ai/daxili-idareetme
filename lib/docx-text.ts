// Reads the paragraphs of a Word (.docx) file in the browser, without a library: a .docx is a zip archive whose
// word/document.xml holds the text. Only text is kept — tabs and line breaks, not formatting, tables or list numbering.

async function inflateRaw(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const decode = (value: string) => value
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&");

function paragraphs(xml: string) {
  const body = xml.slice(Math.max(0, xml.indexOf("<w:body")));
  return (body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || []).map((p) => {
    let text = "";
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>/g)) text += m[1] !== undefined ? decode(m[1]) : m[0].startsWith("<w:tab") ? "\t" : "\n";
    return text.replace(/\s+$/g, "");
  });
}

export async function docxParagraphs(buffer: ArrayBuffer): Promise<string[]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("Şablon faylı .docx formatında deyil (köhnə .doc faylını Word-da .docx kimi saxlayın).");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let n = 0; n < count && view.getUint32(at, true) === 0x02014b50; n++) {
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (name === "word/document.xml") {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      const xml = method === 0 ? new TextDecoder().decode(data) : await inflateRaw(data);
      return paragraphs(xml);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("Word faylında mətn tapılmadı.");
}
