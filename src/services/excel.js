import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { join } from "node:path";
import { EXPORT_DIR } from "../config/env.js";
import { getSupabaseAdmin } from "./supabase.js";

export async function generarExcelRuta(data) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ruta de Lubricación");

  sheet.columns = [
    { header: "Activo", key: "activo", width: 25 },
    { header: "Componente", key: "componente", width: 25 },
    { header: "Cantidad", key: "cantidad", width: 12 },
    { header: "Lubricante", key: "lubricante", width: 20 },
    { header: "Frecuencia", key: "frecuencia", width: 18 },
    { header: "Ubicación", key: "ubicacion", width: 20 },
    { header: "Observaciones", key: "observaciones", width: 30 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAB308" } };
    cell.font = { bold: true, color: { argb: "FF111827" }, size: 12 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });

  const componentes = data.componentes || [];
  let rowIdx = 2;
  for (const comp of componentes) {
    const row = sheet.getRow(rowIdx);
    row.getCell(1).value = data.activo || "";
    row.getCell(2).value = comp.nombre || "";
    row.getCell(3).value = comp.cantidad || "";
    row.getCell(4).value = comp.lubricante || "";
    row.getCell(5).value = comp.frecuencia || data.frecuencia || "";
    row.getCell(6).value = comp.ubicacion || data.ubicacion || "";
    row.getCell(7).value = comp.observaciones || data.observaciones || "";
    row.eachCell((cell) => {
      cell.font = { size: 11 };
      cell.alignment = { vertical: "middle" };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });
    rowIdx++;
  }

  const filename = `ruta_lubricacion_${Date.now()}.xlsx`;
  const filepath = join(EXPORT_DIR, filename);
  await workbook.xlsx.writeFile(filepath);
  return { filepath, filename };
}

export function parseExcelBufferForPreview(buf, filename) {
  const wb = XLSX.read(buf, { type: "buffer", cellStyles: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headers = (rows[0] || []).map((h) => String(h || ""));
  const data = rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, j) => {
      obj[`col${j}`] = String(row[j] || "");
    });
    return obj;
  });

  const styles = {};
  for (const cellRef in sheet) {
    if (cellRef.startsWith("!")) continue;
    const cell = sheet[cellRef];
    const addr = XLSX.utils.decode_cell(cellRef);
    if (addr.r === 0) continue; // skip header
    const ri = addr.r - 1;
    const ci = addr.c;
    const s = {};
    if (cell.s) {
      if (cell.s.fgColor && cell.s.fgColor.rgb) s.bg = "#" + cell.s.fgColor.rgb.slice(2);
      if (cell.s.font && cell.s.font.color && cell.s.font.color.rgb) s.color = "#" + cell.s.font.color.rgb.slice(2);
      if (cell.s.font && cell.s.font.bold) s.bold = true;
      if (cell.s.font && cell.s.font.italic) s.italic = true;
    }
    if (Object.keys(s).length > 0) styles[`${ri}_${ci}`] = s;
  }

  const merges = sheet["!merges"] || [];
  styles["_merges"] = merges.map((m) => ({ r1: m.s.r - 1, c1: m.s.c, r2: m.e.r - 1, c2: m.e.c }));

  return { headers, rows: data, filename, cellStyles: styles };
}

export async function saveEditedExcelWorkbook({ projectId, headers, rows: dataRows, cellStyles }) {
  const sb = getSupabaseAdmin();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");

  // Headers con estilo INGELUBSA
  const headerRow = sheet.getRow(1);
  headers.forEach((h, j) => {
    const cell = headerRow.getCell(j + 1);
    cell.value = h;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAB308" } };
    cell.font = { bold: true, color: { argb: "FF111827" }, size: 12 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });

  // Filas de datos con estilos
  for (let i = 0; i < dataRows.length; i++) {
    const row = sheet.getRow(i + 2);
    for (let j = 0; j < headers.length; j++) {
      const cell = row.getCell(j + 1);
      cell.value = (dataRows[i][`col${j}`] || "").replace(/\[img:.*?\]/, "").trim();
      const style = (cellStyles || {})[`${i}_${j}`] || {};
      if (style.bg && style.bg !== "#ffffff") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + style.bg.replace("#", "") } };
      if (style.color && style.color !== "#000000") cell.font = { ...cell.font, color: { argb: "FF" + style.color.replace("#", "") } };
      if (style.bold) cell.font = { ...cell.font, bold: true };
      if (style.italic) cell.font = { ...cell.font, italic: true };
      const bd = style.border === "thick" ? "medium" : style.border === "thin" ? "thin" : style.border === "double" ? "double" : undefined;
      if (bd) cell.border = { top: { style: bd }, bottom: { style: bd }, left: { style: bd }, right: { style: bd } };
      else cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.font = { ...cell.font, size: 12 };
    }
  }

  // Merged cells
  const merges = (cellStyles || {})["_merges"] || [];
  for (const m of merges) {
    sheet.mergeCells(Number(m.r1) + 2, Number(m.c1) + 1, Number(m.r2) + 2, Number(m.c2) + 1);
  }

  // Embed imágenes
  for (let i = 0; i < dataRows.length; i++) {
    for (let j = 0; j < headers.length; j++) {
      const val = dataRows[i][`col${j}`] || "";
      const match = val.match(/\[img:\s*(.+?)\]/);
      if (match) {
        try {
          const { data: imgFiles } = await sb.from("files").select("*").eq("project_id", projectId).ilike("name", `%${match[1].trim()}%`).ilike("mimetype", "image/%");
          if (imgFiles && imgFiles.length > 0) {
            const imgFile = imgFiles[0];
            const { data: imgData } = await sb.storage.from("lubia-files").download(`${imgFile.project_id}/${imgFile.id}`);
            if (imgData) {
              const imgId = workbook.addImage({
                buffer: Buffer.from(await imgData.arrayBuffer()),
                extension: imgFile.mimetype.split("/")[1] || "jpeg",
              });
              sheet.addImage(imgId, { tl: { col: j, row: i + 1 }, br: { col: j + 1, row: i + 2 } });
              sheet.getRow(i + 2).height = 90;
            }
          }
        } catch (e) {
          console.error("[Excel] Error insertando imagen:", e);
        }
      }
    }
  }

  // Column widths
  headers.forEach((_, j) => {
    sheet.getColumn(j + 1).width = Math.max(15, (headers[j] || "").length * 2 + 5);
  });

  return await workbook.xlsx.writeBuffer();
}

export function extractHeadersFromExcel(buffer, originalFilename) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headers = (rows[0] || []).map((h) => String(h || "").trim()).filter(Boolean);
  return {
    name: (originalFilename || "Plantilla").replace(/\.[^.]+$/, ""),
    columns: headers,
  };
}
