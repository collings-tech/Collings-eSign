const fs = require("fs").promises;
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { uploadDir } = require("../config/env");

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

// When frontend sends page-relative coords + page1RenderWidth/Height, we use them for exact placement.
// Fallback when doc has no stored render size (legacy or prepare view didn't send it).
const FALLBACK_RENDER_WIDTH = 800;

/**
 * Embed the signer's signature into the document PDF and save.
 * Uses the document's current PDF (signedFilePath if set, else originalFilePath).
 * @param {Object} doc - Document with originalFilePath, signedFilePath
 * @param {Object} signRequest - SignRequest with signatureFields, signatureData
 * @returns {Promise<string>} New filename (signed) to store in doc.signedFilePath
 */
async function embedSignatureInPdf(doc, signRequest) {
  if (!signRequest.signatureData) {
    throw new Error("No signature data to embed");
  }

  const sourcePath = path.join(uploadDir, doc.originalFilePath);
  const pdfBytes = await fs.readFile(sourcePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const pages = pdfDoc.getPages();

  const imageBuffer = await getSignatureImageBuffer(signRequest.signatureData);
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

  const typedData = parseTypedSignature(signRequest.signatureData);
  const borderAsset = await embedBorderImage(pdfDoc);

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

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let fields = signRequest.signatureFields || [];
  if (fields.length === 0) {
    fields = [{ page: 1, x: 100, y: 400, width: 180, height: 36, type: "signature" }];
  }
  for (const f of fields) {
    const isSig = (f.type || "signature") === "signature" || (f.type || "signature") === "initial";
    if (!isSig) continue;

    const pageIndex = Math.max(0, (f.page || 1) - 1);
    const page = pages[pageIndex];
    if (!page) continue;

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const renderW = doc.page1RenderWidth > 0 ? doc.page1RenderWidth : FALLBACK_RENDER_WIDTH;
    const renderH = doc.page1RenderHeight > 0 ? doc.page1RenderHeight : (pageHeight / pageWidth) * renderW;
    const scaleX = pageWidth / renderW;
    const scaleY = pageHeight / renderH;
    const x = (Number(f.x) || 0) * scaleX;
    const y = (Number(f.y) || 0) * scaleY;
    const w = (Number(f.width) || 160) * scaleX;
    const h = (Number(f.height) || 36) * scaleY;
    const yPdf = pageHeight - y - h;

    const pad = BORDER_PADDING * Math.min(scaleX, scaleY);
    const innerX = x + pad;
    const innerY = yPdf + pad;
    const innerW = Math.max(1, w - 2 * pad);
    const innerH = Math.max(1, h - 2 * pad);

    const black = rgb(0, 0, 0);
    const signedById = signRequest._id ? String(signRequest._id).replace(/-/g, "").slice(-16) : "";

    const labelH = Math.min(5, innerH * 0.15);
    const idH = Math.min(5, innerH * 0.15);
    const sigH = Math.max(innerH * 0.55, innerH - labelH - idH - 8);
    // Keep "Signed by:", signature, and ID inside border using same margins
    const labelY = innerY + innerH - labelH - SIG_TEXT_MARGIN_V;
    const sigY = innerY + idH + SIG_TEXT_MARGIN_V;
    const idY = innerY + SIG_TEXT_MARGIN_V;

    if (borderAsset && borderAsset.embed) {
      try {
        const borderDims = borderAsset.embed.scaleToFit(w, h);
        if (borderDims.width > 0 && borderDims.height > 0) {
          const borderX = x + (w - borderDims.width) / 2;
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
        const sigX = innerX + (innerW - sigDims.width) / 2;
        const sigYc = sigY + (sigH - sigDims.height) / 2;
        page.drawImage(embeddedImage, {
          x: x+5,
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
        const isInitial = (f.type || "signature").toLowerCase() === "initial";
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
        // Inset box so script glyphs (e.g. 'j', ascenders) stay inside the border
        const sigTextW = Math.max(1, innerW - 2 * SIG_TEXT_MARGIN_H);
        const sigTextH = Math.max(1, sigH - 2 * SIG_TEXT_MARGIN_V);
        const sigTextX = innerX + SIG_TEXT_MARGIN_H;
        const sigTextY = sigY + SIG_TEXT_MARGIN_V;
        // Signature font = 60% of signature area height; shrink only if needed to fit width
        let fontSizePt = sigTextH * 0.6;
        const fontToUse = embeddedTypedFont || helvetica;
        let textWidth = fontToUse.widthOfTextAtSize(text, fontSizePt);
        const minFontSize = 5;
        while (textWidth > sigTextW && fontSizePt > minFontSize) {
          fontSizePt -= 1;
          textWidth = fontToUse.widthOfTextAtSize(text, fontSizePt);
        }
        const textX = sigTextX + Math.max(0, (sigTextW - textWidth) / 2);
        const textY = sigTextY + sigTextH / 2 - fontSizePt / 2;
        const drawOpts = {
          x: x+5,
          y: textY-3,
          size: fontSizePt+7,
          color: black,
        };
        if (embeddedTypedFont) drawOpts.font = embeddedTypedFont;
        page.drawText(text, drawOpts);
      } catch (err) {
        console.error("[pdfSign] Failed to draw typed signature:", err.message);
      }
    }

    try {
      page.drawText("Signed by:", {
        x: x+10,
        y: labelY + 5,
        size: labelH+3,
        font: helvetica,
        color: black,
      });
    } catch (err) {
      console.error("[pdfSign] Failed to draw Signed by:", err.message);
    }

    if (signedById) {
      try {
        page.drawText(signedById, {
          x: x+5,
          y: idY-5,
          size: idH+3,
          font: helvetica,
          color: black,
        });
      } catch (err) {
        console.error("[pdfSign] Failed to draw ID:", err.message);
      }
    }
  }

  const outFilename = `signed-${doc._id.toString()}-${Date.now()}.pdf`;
  const outPath = path.join(uploadDir, outFilename);
  const outBytes = await pdfDoc.save();
  await fs.writeFile(outPath, outBytes);
  return outFilename;
}

module.exports = {
  embedSignatureInPdf,
  getSignatureImageBuffer,
};
