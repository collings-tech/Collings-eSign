const fs = require("fs").promises;
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { uploadDir } = require("../config/env");
const storageService = require("./storage.service");

const BORDER_PADDING = 5;
/** Extra margin inside the border so typed signature glyphs (e.g. script 'j', ascenders) stay inside */
const SIG_TEXT_MARGIN_H = 4;
const SIG_TEXT_MARGIN_V = 3;
/** Use no-background border so it doesn't cover the signature */
const SIGN_BORDER_PATH = path.join(__dirname, "..", "..", "assets", "no-bg-sign-border.png");

/** Map frontend font names to TTF filenames in backend/assets/fonts/ (optional) */
const SIGNATURE_FONT_FILES = {
  "Dancing Script": "DancingScript-Regular.ttf",
  "Great Vibes": "GreatVibes-Regular.ttf",
  "Allura": "Allura-Regular.ttf",
  "Pacifico": "Pacifico-Regular.ttf",
  "Sacramento": "Sacramento-Regular.ttf",
};
const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "fonts");

/** Fallback: fetch TTF from Google Fonts GitHub when not on disk so font style applies in PDF */
const FONT_CDN_URLS = {
  "Dancing Script": "https://raw.githubusercontent.com/google/fonts/main/ofl/dancingscript/DancingScript%5Bwght%5D.ttf",
  "Great Vibes": "https://raw.githubusercontent.com/google/fonts/main/ofl/greatvibes/GreatVibes-Regular.ttf",
  "Allura": "https://raw.githubusercontent.com/google/fonts/main/ofl/allura/Allura-Regular.ttf",
  "Pacifico": "https://raw.githubusercontent.com/google/fonts/main/ofl/pacifico/Pacifico-Regular.ttf",
  "Sacramento": "https://raw.githubusercontent.com/google/fonts/main/ofl/sacramento/Sacramento-Regular.ttf",
};

/**
 * Parse signatureData: "typed::Name::Font::Initials::FontSize" or return null for image/other.
 * @returns {{ name: string, initials: string, font: string, fontSize: number }|null}
 */
function parseTypedSignature(signatureData) {
  if (!signatureData || typeof signatureData !== "string") return null;
  if (!signatureData.startsWith("typed::")) return null;
  const parts = signatureData.split("::");
  const name = (parts[1] != null && String(parts[1]).trim()) ? String(parts[1]).trim() : "";
  const font = (parts[2] != null && String(parts[2]).trim()) ? String(parts[2]).trim() : "";
  const initials = (parts[3] != null && String(parts[3]).trim()) ? String(parts[3]).trim() : "";
  let fontSize = 11;
  if (parts[4] != null && parts[4] !== "") {
    const n = Number(parts[4]);
    if (!Number.isNaN(n)) fontSize = Math.max(6, Math.min(24, n));
  }
  return { name, initials, font, fontSize };
}

/**
 * Extract raw image buffer from signatureData (data URL or return null for typed).
 * @param {string} signatureData
 * @returns {Promise<Buffer|null>}
 */
async function getSignatureImageBuffer(signatureData) {
  if (!signatureData || typeof signatureData !== "string") return null;
  if (signatureData.startsWith("data:image/")) {
    const base64 = signatureData.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(base64, "base64");
  }
  return null;
}

/**
 * Load and embed no-bg-sign-border.png for the PDF (transparent so it doesn't cover the signature).
 * @param {PDFDocument} pdfDoc
 * @returns {Promise<{ embed: import('pdf-lib').PDFImage }|null>}
 */
async function embedBorderImage(pdfDoc) {
  try {
    const borderBytes = await fs.readFile(SIGN_BORDER_PATH);
    const embed = await pdfDoc.embedPng(borderBytes);
    return { embed };
  } catch (err) {
    console.warn("[pdfSign] no-bg-sign-border.png not found or failed to embed:", err.message);
    return null;
  }
}

// Prefer percent-based coords (survives zoom, mobile, resizing). Fallback to px coords for legacy.

/**
 * Convert field to PDF box: { x, yPdf, w, h }.
 * Prefers xPct, yPct, wPct, hPct when present (percent of page, top-left origin).
 * PDF uses points, bottom-left origin. Y conversion: pdfY = pageHeight - topY - h.
 */
function fieldToPdfBox(f, pageWidth, pageHeight) {
  const defW = 120;
  const defH = 24;
  let x, w, topY, h;
  if (f.xPct != null && f.yPct != null && f.wPct != null && f.hPct != null) {
    // Percent-based (recommended)
    x = (Number(f.xPct) / 100) * pageWidth;
    w = (Number(f.wPct) / 100) * pageWidth;
    topY = (Number(f.yPct) / 100) * pageHeight;
    h = (Number(f.hPct) / 100) * pageHeight;
  } else {
    // Legacy: x, y, width, height in render space - scale to PDF
    const renderW = 800;
    const renderH = (pageHeight / pageWidth) * renderW;
    const scaleX = pageWidth / renderW;
    const scaleY = pageHeight / renderH;
    const posX = f.x != null ? Number(f.x) : (f.pageX != null ? Number(f.pageX) : 0);
    const posY = f.y != null ? Number(f.y) : (f.pageY != null ? Number(f.pageY) : 0);
    x = posX * scaleX;
    topY = posY * scaleY;
    w = (Number(f.width) ?? defW) * scaleX;
    h = (Number(f.height) ?? defH) * scaleY;
  }
  const yPdf = pageHeight - topY - h;
  const xClamp = Math.max(0, Math.min(x, pageWidth - w));
  const yPdfClamp = Math.max(0, Math.min(yPdf, pageHeight - h));
  return { x: xClamp, yPdf: yPdfClamp, w, h };
}

/**
 * Embed the signer's signature into the document PDF and save.
 * Uses the document's current PDF (signedKey/signedFilePath if set, else originalKey/originalFilePath).
 * When using Supabase: downloads from storage, embeds, uploads to documents/{docId}/signed.pdf, returns key.
 * Otherwise: reads/writes local disk, returns filename.
 * @param {Object} doc - Document with originalKey, signedKey, originalFilePath, signedFilePath
 * @param {Object} signRequest - SignRequest with signatureFields, signatureData
 * @returns {Promise<string>} Storage key (e.g. documents/{docId}/signed.pdf) or local filename for doc.signedKey / doc.signedFilePath
 */
async function embedSignatureInPdf(doc, signRequest) {
  const hasPerField = signRequest.fieldSignatureData && typeof signRequest.fieldSignatureData === "object" && Object.keys(signRequest.fieldSignatureData).length > 0;
  const hasLegacy = !!signRequest.signatureData;
  const hasFieldValues = signRequest.fieldValues && typeof signRequest.fieldValues === "object" && Object.keys(signRequest.fieldValues).length > 0;
  const sigFields = (signRequest.signatureFields || []).filter((f) => {
    const t = String(f.type || "signature").toLowerCase();
    return t === "signature" || t === "initial";
  });
  const textFieldTypes = ["name", "email", "company", "title", "text", "number", "stamp", "date", "dropdown"];
  const hasSigFields = sigFields.length > 0;
  if (hasSigFields && !hasPerField && !hasLegacy) {
    throw new Error("No signature data to embed");
  }
  /* When only text fields exist with no values yet, we still run and save PDF as-is */

  let pdfBytes;
  const useStorage = doc.originalKey && storageService.isStorageConfigured();
  if (useStorage) {
    const sourceKey = doc.signedKey || doc.originalKey;
    pdfBytes = await storageService.download(sourceKey);
  } else {
    const sourcePath = path.join(uploadDir, doc.signedFilePath || doc.originalFilePath);
    pdfBytes = await fs.readFile(sourcePath);
  }

  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const pages = pdfDoc.getPages();

  const borderAsset = await embedBorderImage(pdfDoc);

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let fields = signRequest.signatureFields || [];
  if (fields.length === 0 && hasSigFields) {
    fields = [{ page: 1, x: 100, y: 400, width: 180, height: 36, type: "signature" }];
  }
  const sigFieldCount = fields.filter((f) => {
    const t = String(f.type || "signature").toLowerCase();
    return t === "signature" || t === "initial";
  }).length;
  const firstPage = pages[0] || null;
  console.log("[pdfSign] Embedding signature:", { fields: fields.length, sigFields: sigFieldCount, useStorage });

  for (const f of fields) {
    const typeLower = String(f.type || "signature").toLowerCase();
    const isSig = typeLower === "signature" || typeLower === "initial";
    if (!isSig) continue;

    const signatureDataForField = hasPerField && f.id && signRequest.fieldSignatureData[f.id]
      ? signRequest.fieldSignatureData[f.id]
      : signRequest.signatureData;
    if (!signatureDataForField) continue;

    const imageBuffer = await getSignatureImageBuffer(signatureDataForField);
    let embeddedImage = null;
    if (imageBuffer) {
      try {
        embeddedImage = await pdfDoc.embedPng(imageBuffer);
      } catch {
        try {
          embeddedImage = await pdfDoc.embedJpg(imageBuffer);
        } catch (err) {
          console.error("[pdfSign] Failed to embed signature image", err.message);
        }
      }
    }

    const typedData = parseTypedSignature(signatureDataForField);
    let embeddedTypedFont = null;
    if (typedData?.font && (SIGNATURE_FONT_FILES[typedData.font] || FONT_CDN_URLS[typedData.font])) {
      try {
        let fontBytes = null;
        const fontPath = path.join(FONTS_DIR, SIGNATURE_FONT_FILES[typedData.font]);
        try {
          fontBytes = await fs.readFile(fontPath);
        } catch {
          const cdnUrl = FONT_CDN_URLS[typedData.font];
          if (cdnUrl) {
            const res = await fetch(cdnUrl);
            if (res.ok) fontBytes = Buffer.from(await res.arrayBuffer());
          }
        }
        if (fontBytes && fontBytes.length > 0) {
          embeddedTypedFont = await pdfDoc.embedFont(fontBytes);
        }
      } catch (err) {
        console.warn("[pdfSign] Custom font not loaded, using default:", typedData.font, err.message);
      }
    }

    const pageIndex = Math.max(0, (f.page || 1) - 1);
    const page = pages[pageIndex];
    if (!page) continue;

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const box = fieldToPdfBox(f, pageWidth, pageHeight);
    const { x, yPdf, w, h } = box;
    const innerX = x;
    const innerY = yPdf;
    const innerW = w;
    const innerH = h;

    const black = rgb(0, 0, 0);
    const signedById = signRequest._id ? String(signRequest._id).replace(/-/g, "").slice(-16) : "";

    const labelH = Math.min(5, innerH * 0.15);
    const idH = Math.min(5, innerH * 0.15);
    const sigH = Math.max(innerH * 0.55, innerH - labelH - idH - 8);
    const labelY = innerY + innerH - labelH - SIG_TEXT_MARGIN_V;
    const sigY = innerY + idH + SIG_TEXT_MARGIN_V;
    const idY = innerY + SIG_TEXT_MARGIN_V;

    if (borderAsset && borderAsset.embed) {
      try {
        const borderDims = borderAsset.embed.scaleToFit(w, h);
        if (borderDims.width > 0 && borderDims.height > 0) {
          const borderY = yPdf + (h - borderDims.height) / 2;
          page.drawImage(borderAsset.embed, {
            x: x,
            y: borderY,
            width: borderDims.width,
            height: borderDims.height,
            opacity: 1,
          });
        }
      } catch (err) {
        console.warn("[pdfSign] Border draw failed:", err.message);
      }
    }

    if (embeddedImage) {
      try {
        const sigDims = embeddedImage.scaleToFit(innerW, sigH);
        const sigYc = sigY + (sigH - sigDims.height) / 2;
        page.drawImage(embeddedImage, {
          x: innerX,
          y: sigYc,
          width: sigDims.width,
          height: sigDims.height,
          opacity: 1,
        });
      } catch (err) {
        console.error("[pdfSign] Failed to draw signature image:", err.message);
      }
    } else if (typedData) {
      try {
        const isInitial = typeLower === "initial";
        const signerName = signRequest.signerName || "Signed";
        let text = isInitial && typedData.initials
          ? typedData.initials
          : (typedData.name || signerName);
          text = String(text)
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        if (!text) text = signerName;
        const sigTextW = Math.max(1, innerW - 2 * SIG_TEXT_MARGIN_H);
        const sigTextH = Math.max(1, sigH - 2 * SIG_TEXT_MARGIN_V);
        const sigTextX = innerX + SIG_TEXT_MARGIN_H;
        const sigTextY = sigY + SIG_TEXT_MARGIN_V;
        let fontSizePt = sigTextH * 0.6;
        const fontToUse = embeddedTypedFont || helvetica;
        let textWidth = fontToUse.widthOfTextAtSize(text, fontSizePt);
        const minFontSize = 5;
        while (textWidth > sigTextW && fontSizePt > minFontSize) {
          fontSizePt -= 1;
          textWidth = fontToUse.widthOfTextAtSize(text, fontSizePt);
        }
        const textY = sigTextY + sigTextH / 2 - fontSizePt / 2;
        const drawOpts = {
          x: innerX + 7,
          y: textY + 3,
          size: fontSizePt + 4,
          color: black,
        };
        if (embeddedTypedFont) drawOpts.font = embeddedTypedFont;
        page.drawText(text, drawOpts);
      } catch (err) {
        console.error("[pdfSign] Failed to draw typed signature:", err.message);
      }
    } else {
      try {
        const signerName = (signRequest.signerName || "Signed").trim() || "Signed";
        const fallbackFontSize = Math.min(12, Math.max(8, innerH * 0.4));
        const fallbackY = innerY + innerH / 2 - fallbackFontSize / 2;
        page.drawText(signerName, {
          x: innerX,
          y: fallbackY,
          size: fallbackFontSize + 4,
          font: helvetica,
          color: black,
        });
      } catch (err) {
        console.error("[pdfSign] Failed to draw fallback signature text:", err.message);
      }
    }

    try {
      page.drawText("Signed by:", {
        x: innerX + 7,
        y: labelY-2,
        size: labelH+2,
        font: helvetica,
        color: black,
      });
    } catch (err) {
      console.error("[pdfSign] Failed to draw Signed by:", err.message);
    }

    if (signedById) {
      try {
        page.drawText(signedById, {
          x: innerX + 7,
          y: idY,
          size: idH + 2,
          font: helvetica,
          color: black,
        });
      } catch (err) {
        console.error("[pdfSign] Failed to draw ID:", err.message);
      }
    }
  }

  // Draw typed text fields (name, email, company, title, text, number) with formatting
  const fieldValues = signRequest.fieldValues || {};
  const getFieldKey = (f) => (f.id != null && f.id !== "" ? f.id : `field-${f.page ?? 1}-${f.x ?? 0}-${f.y ?? 0}-${(f.type || "text")}`);

  const FONT_COLOR_MAP = {
    black: rgb(0, 0, 0),
    white: rgb(1, 1, 1),
    red: rgb(0.9, 0.1, 0.1),
    blue: rgb(0.2, 0.2, 0.9),
    green: rgb(0.1, 0.5, 0.1),
    gray: rgb(0.5, 0.5, 0.5),
    darkgray: rgb(0.25, 0.25, 0.25),
    "dark gray": rgb(0.25, 0.25, 0.25),
  };
  const getTextColor = (colorName) => {
    if (!colorName || typeof colorName !== "string") return rgb(0, 0, 0);
    const key = String(colorName).toLowerCase().trim().replace(/\s+/g, "");
    return FONT_COLOR_MAP[key] || rgb(0, 0, 0);
  };
  const getTextFont = async (pdfDoc, f) => {
    const bold = f.bold === true;
    const italic = f.italic === true;
    const family = (f.fontFamily || "").toLowerCase();
    let base = StandardFonts.Helvetica;
    if (family.includes("times") || family.includes("georgia")) base = StandardFonts.TimesRoman;
    else if (family.includes("courier") || family.includes("lucida console")) base = StandardFonts.Courier;
    if (base === StandardFonts.TimesRoman) {
      if (bold && italic) return pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
      if (bold) return pdfDoc.embedFont(StandardFonts.TimesRomanBold);
      if (italic) return pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
      return pdfDoc.embedFont(StandardFonts.TimesRoman);
    }
    if (base === StandardFonts.Courier) {
      if (bold && italic) return pdfDoc.embedFont(StandardFonts.CourierBoldOblique);
      if (bold) return pdfDoc.embedFont(StandardFonts.CourierBold);
      if (italic) return pdfDoc.embedFont(StandardFonts.CourierOblique);
      return pdfDoc.embedFont(StandardFonts.Courier);
    }
    if (bold && italic) return pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
    if (bold) return pdfDoc.embedFont(StandardFonts.HelveticaBold);
    if (italic) return pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    return pdfDoc.embedFont(StandardFonts.Helvetica);
  };

  for (const f of fields) {
    const typeLower = String(f.type || "signature").toLowerCase();
    if (!textFieldTypes.includes(typeLower)) continue;
    const fieldKey = getFieldKey(f);
    let value = fieldValues[fieldKey] ?? fieldValues[f.id];
    if (value == null || String(value).trim() === "") {
      if (f.readOnly && typeLower === "text" && (f.addText ?? "").trim()) value = String(f.addText).trim();
      else continue;
    }

    const pageIndex = Math.max(0, (f.page || 1) - 1);
    const page = pages[pageIndex];
    if (!page) continue;

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const box = fieldToPdfBox(f, pageWidth, pageHeight);
    const { x, yPdf, w: innerW, h: innerH } = box;
    const innerX = x;
    const innerY = yPdf;

    const text = String(value).trim();
    let fontSizePt = f.fontSize != null && f.fontSize > 0 ? Math.min(72, Math.max(6, Number(f.fontSize))) : Math.min(12, Math.max(8, innerH * 0.7));
    if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) fontSizePt = 10;
    const textColor = getTextColor(f.fontColor);
    const textX = innerX + 1;
    const textY = innerY + Math.min(3, innerH * 0.15);

    try {
      const textFont = await getTextFont(pdfDoc, f);
      page.drawText(text, {
        x: textX,
        y: textY,
        size: fontSizePt,
        font: textFont,
        color: textColor,
      });
      if (f.underline) {
        const textWidth = textFont.widthOfTextAtSize(text, fontSizePt);
        const underlineY = textY - 1;
        page.drawLine({
          start: { x: textX, y: underlineY },
          end: { x: textX + textWidth, y: underlineY },
          thickness: Math.max(0.5, fontSizePt / 18),
          color: textColor,
        });
      }
    } catch (err) {
      console.error("[pdfSign] Failed to draw text field:", err.message);
    }
  }

  const outBytes = await pdfDoc.save();
  if (useStorage) {
    const signedKeyPath = storageService.signedKey(doc._id.toString());
    await storageService.upload(signedKeyPath, Buffer.from(outBytes));
    console.log("[pdfSign] Saved signed PDF to storage:", signedKeyPath);
    return signedKeyPath;
  }
  const outFilename = `signed-${doc._id.toString()}-${Date.now()}.pdf`;
  const outPath = path.join(uploadDir, outFilename);
  await fs.writeFile(outPath, outBytes);
  console.log("[pdfSign] Saved signed PDF to local:", outFilename);
  return outFilename;
}

module.exports = {
  embedSignatureInPdf,
  getSignatureImageBuffer,
};
