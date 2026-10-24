import type { AnnotationColumnSearchResult, DatasetItem } from "../../types";
import type { DisplayColumn, HeatmapMetric, PartitionShape, TreeLayoutNode, TreeViewMode, VisibleRow } from "./resultTypes";
import { clamp, isHeatmapDisplayColumn, rowCellKey } from "./resultVisualUtils";

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function quoteNewickLabel(label: string) {
  const cleaned = label.trim() || "unnamed";
  if (/^[A-Za-z0-9_.-]+$/.test(cleaned)) return cleaned;
  return `'${cleaned.replace(/'/g, "''")}'`;
}

export function sanitizeFilePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "export";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function svgDimensions(svg: string) {
  const width = Number(svg.match(/<svg[^>]*\bwidth="([\d.]+)/i)?.[1] ?? 1);
  const height = Number(svg.match(/<svg[^>]*\bheight="([\d.]+)/i)?.[1] ?? 1);
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

async function renderSvgToCanvas(svg: string, pixelRatio = 2) {
  if (typeof document === "undefined") throw new Error("图形导出需要浏览器环境。\nGraphics export requires a browser.");
  const { width, height } = svgDimensions(svg);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建图形画布。\nUnable to create an export canvas.");
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("SVG 渲染失败。\nSVG rendering failed."));
      image.src = url;
    });
    context.drawImage(image, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return { canvas, width, height };
}

export async function svgToPngBlob(svg: string, pixelRatio = 2) {
  const { canvas } = await renderSvgToCanvas(svg, pixelRatio);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 编码失败。\nPNG encoding failed.")), "image/png");
  });
}

function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  parts.forEach((part) => { result.set(part, offset); offset += part.length; });
  return result;
}

/** Encode the rendered figure as a self-contained PDF without a runtime dependency. */
export async function svgToPdfBlob(svg: string) {
  const { canvas, width, height } = await renderSvgToCanvas(svg, 2);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
  const jpeg = Uint8Array.from(atob(dataUrl.split(",", 2)[1] ?? ""), (char) => char.charCodeAt(0));
  const encoder = new TextEncoder();
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
  ];
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0].length;
  const pushObject = (index: number, body: Uint8Array) => {
    offsets[index] = length;
    const header = encoder.encode(`${index} 0 obj\n`);
    const footer = encoder.encode("\nendobj\n");
    chunks.push(header, body, footer);
    length += header.length + body.length + footer.length;
  };
  pushObject(1, encoder.encode(objects[0]));
  pushObject(2, encoder.encode(objects[1]));
  pushObject(3, encoder.encode(objects[2]));
  pushObject(4, concatBytes([encoder.encode(`${objects[3]}\nstream\n`), jpeg, encoder.encode("\nendstream") ]));
  const contentBytes = encoder.encode(content);
  pushObject(5, concatBytes([encoder.encode(`<< /Length ${contentBytes.length} >>\nstream\n`), contentBytes, encoder.encode("\nendstream") ]));
  const xrefOffset = length;
  const xref = [`xref\n0 6\n0000000000 65535 f \n`, ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`), `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`].join("");
  chunks.push(encoder.encode(xref));
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function writeUint16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

export function writeUint32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

export function makeZipBlob(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const checksum = crc32(data);
    const local: number[] = [];
    writeUint32(local, 0x04034b50);
    writeUint16(local, 20);
    writeUint16(local, 0x0800);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint32(local, checksum);
    writeUint32(local, data.length);
    writeUint32(local, data.length);
    writeUint16(local, nameBytes.length);
    writeUint16(local, 0);
    const localHeader = new Uint8Array([...local, ...nameBytes]);
    chunks.push(localHeader, data);

    const central: number[] = [];
    writeUint32(central, 0x02014b50);
    writeUint16(central, 20);
    writeUint16(central, 20);
    writeUint16(central, 0x0800);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, checksum);
    writeUint32(central, data.length);
    writeUint32(central, data.length);
    writeUint16(central, nameBytes.length);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, 0);
    writeUint32(central, offset);
    centralChunks.push(new Uint8Array([...central, ...nameBytes]));
    offset += localHeader.length + data.length;
  });
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const end: number[] = [];
  writeUint32(end, 0x06054b50);
  writeUint16(end, 0);
  writeUint16(end, 0);
  writeUint16(end, files.length);
  writeUint16(end, files.length);
  writeUint32(end, centralSize);
  writeUint32(end, offset);
  writeUint16(end, 0);
  const blobParts = [...chunks, ...centralChunks, new Uint8Array(end)].map((chunk) => {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy.buffer;
  });
  return new Blob(blobParts, { type: "application/zip" });
}

export function serializeVisibleNewick(treeLayoutNodes: TreeLayoutNode[]) {
  const root = treeLayoutNodes.find((node) => node.parent === null) ?? treeLayoutNodes[0];
  if (!root) return ";\n";
  function serialize(node: TreeLayoutNode): string {
    const children = node.children.map((childId) => treeLayoutNodes[childId]).filter(Boolean);
    const childText = children.length ? `(${children.map(serialize).join(",")})` : "";
    const label = quoteNewickLabel(node.label || `node_${node.nodeId}`);
    const length = node.parent === null ? "" : `:${Number.isFinite(node.branchLength) ? node.branchLength.toPrecision(8) : "0"}`;
    return `${childText}${label}${length}`;
  }
  return `${serialize(root)};\n`;
}

export function matrixValueText(value: number, metric: HeatmapMetric) {
  if (!Number.isFinite(value)) return "0";
  if (metric === "ratio") return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
  return String(value);
}

export function exportPlotDataArchive(input: {
  searchResult: AnnotationColumnSearchResult | null;
  activeDataset: DatasetItem | null;
  displayColumns: DisplayColumn[];
  visibleRows: VisibleRow[];
  treeLayoutNodes: TreeLayoutNode[];
  cellValues: Map<string, number>;
  heatmapMetric: HeatmapMetric;
  treeViewMode: TreeViewMode;
  circularRotationDegrees: number;
}) {
  if (!input.searchResult || !input.visibleRows.length) return;
  const columns = input.displayColumns.filter(isHeatmapDisplayColumn);
  const exportHeaders = ["branch", ...columns.map((column) => column.displayLabel)];
  const matrixLines = [
    exportHeaders.map((cell) => cell.replace(/\t/g, " ")).join("\t"),
    ...input.visibleRows.map((row) => {
      const cells = [
        row.label,
        ...columns.map((column) => matrixValueText(input.cellValues.get(rowCellKey(row, column)) ?? 0, input.heatmapMetric)),
      ];
      return cells.map((cell) => cell.replace(/\t/g, " ")).join("\t");
    }),
  ];
  const metadata = {
    exported_at: new Date().toISOString(),
    species_tree: input.activeDataset?.species_tree,
    genome_database: input.activeDataset?.genome_database,
    tree_view_mode: input.treeViewMode,
    circular_rotation_degrees: input.treeViewMode === "circular" ? input.circularRotationDegrees : undefined,
    heatmap_metric: input.heatmapMetric,
    rows: input.visibleRows.length,
    columns: columns.length,
  };
  const base = sanitizeFilePart(`${input.activeDataset?.genome_database ?? "plot"}_${input.heatmapMetric}`);
  const zip = makeZipBlob([
    { name: "tree.newick", content: serializeVisibleNewick(input.treeLayoutNodes) },
    { name: "matrix.tsv", content: `${matrixLines.join("\n")}\n` },
    { name: "metadata.json", content: `${JSON.stringify(metadata, null, 2)}\n` },
  ]);
  downloadBlob(zip, `${base}_plot_data.zip`);
}

export function exportShapeMarkup(shape: PartitionShape, x: number, y: number, width: number, height: number, fill: string, markerScale = 1) {
  const baseSize = Math.min(width, height);
  const markerSize = clamp(baseSize * markerScale, 4, Math.max(4, baseSize));
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const squareX = centerX - markerSize / 2;
  const squareY = centerY - markerSize / 2;
  if (shape === "fill") return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="0" fill="${fill}"/>`;
  if (shape === "circle") return `<circle cx="${centerX}" cy="${centerY}" r="${markerSize / 2}" fill="${fill}" stroke="rgba(17,17,17,0.5)" stroke-width="0.7"/>`;
  if (shape === "triangle") {
    const triangleHeight = markerSize * Math.sqrt(3) / 2;
    const points = `${centerX},${centerY - triangleHeight * 2 / 3} ${centerX + markerSize / 2},${centerY + triangleHeight / 3} ${centerX - markerSize / 2},${centerY + triangleHeight / 3}`;
    return `<polygon points="${points}" fill="${fill}" stroke="rgba(17,17,17,0.5)" stroke-width="0.7"/>`;
  }
  return `<rect x="${squareX}" y="${squareY}" width="${markerSize}" height="${markerSize}" rx="2" fill="${fill}" stroke="rgba(17,17,17,0.5)" stroke-width="0.7"/>`;
}

export function collectSvgStyles() {
  const parts: string[] = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      Array.from(sheet.cssRules).forEach((rule) => parts.push(rule.cssText));
    } catch {
      // Cross-origin stylesheets are skipped; app styles are same-origin.
    }
  });
  return parts.join("\n");
}
