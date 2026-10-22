import { unzipSync } from "fflate";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MAX_FILE_BYTES, MAX_TEXT, splitPassages, type Source } from "./study";

export async function extractFile(
  file: File,
  report: (text: string) => void,
): Promise<Source> {
  if (!file.size) throw new Error("This file is empty.");
  if (file.size > MAX_FILE_BYTES)
    throw new Error("Files must be 20 MB or smaller.");
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx", "txt", "md"].includes(ext || ""))
    throw new Error(
      "Use a text-based PDF, DOCX, TXT, or Markdown file. Scans and images need OCR, which is not included yet.",
    );
  const buffer = await file.arrayBuffer();
  const id = crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const source: Source = {
    id,
    name: file.name,
    type: ext === "md" ? "txt" : (ext as Source["type"]),
    role: "material",
    passages: [],
    warnings: [],
    pageCount: 0,
    addedAt: new Date().toISOString(),
    fingerprint: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
  if (ext === "pdf") {
    if (new TextDecoder().decode(buffer.slice(0, 5)) !== "%PDF-")
      throw new Error("This file does not contain a valid PDF header.");
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({ data: buffer, useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 200)
        throw new Error("Use a PDF with 200 pages or fewer.");
      source.pageCount = pdf.numPages;
      const emptyPages: number[] = [];
      let size = 0;
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        report(`Reading ${file.name} · page ${pageNo} of ${pdf.numPages}`);
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("")
          .trim();
        size += text.length;
        if (size > MAX_TEXT)
          throw new Error(
            "This PDF has more than 80,000 characters. Upload a shorter chapter or excerpt.",
          );
        if (text.length < 20) emptyPages.push(pageNo);
        else
          source.passages.push(
            ...splitPassages(text, `${id}:p${pageNo}`, `Page ${pageNo}`),
          );
        page.cleanup();
      }
      if (emptyPages.length)
        source.warnings.push(
          `No usable text on PDF page${emptyPages.length === 1 ? "" : "s"} ${emptyPages.slice(0, 20).join(", ")}${emptyPages.length > 20 ? " and more" : ""}. These pages are not included. Scanned pages require OCR.`,
        );
      source.warnings.push(
        "PDF page numbers refer to file pages. Check the preview for reading-order or table extraction errors.",
      );
    } finally {
      await task.destroy();
    }
  } else {
    let text = "";
    if (ext === "docx") {
      let total = 0,
        entries = 0;
      const validated = unzipSync(new Uint8Array(buffer), {
        filter: (entry) => {
          total += entry.originalSize;
          entries++;
          if (total > 30 * 1024 * 1024 || entries > 1500)
            throw new Error(
              "This DOCX expands beyond the safe import limit. Export it as plain text.",
            );
          return entry.name === "word/document.xml";
        },
      });
      if (!validated["word/document.xml"])
        throw new Error("This file is not a supported Word document.");
      const mammoth = await import("mammoth/mammoth.browser");
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      text = result.value;
      if (result.messages.length)
        source.warnings.push(
          "Some Word formatting may not be represented. Check the extracted text before generating.",
        );
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (text.includes("\u0000"))
        throw new Error("This file is not UTF-8 plain text.");
    }
    if (text.length > MAX_TEXT)
      throw new Error(
        "This material exceeds 80,000 characters. Use a shorter excerpt.",
      );
    source.passages = splitPassages(text, id, "Text");
  }
  if (
    !source.passages.length ||
    source.passages.reduce((n, p) => n + p.text.length, 0) < 50
  )
    throw new Error(
      "Not enough readable text was found. Try a text-based document or paste at least 50 characters of notes.",
    );
  if (source.passages.length > 300)
    throw new Error("Too many passages. Use a shorter excerpt.");
  return source;
}
