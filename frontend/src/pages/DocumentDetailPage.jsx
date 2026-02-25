import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient, getProfileImageUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext.jsx";
import TopNavLayout from "../components/TopNavLayout.jsx";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { pdfjs } from "react-pdf";
import PdfViewer from "../components/PdfViewer.jsx";
import PdfMainView from "../components/PdfMainView.jsx";
import PdfThumbnails from "../components/PdfThumbnails.jsx";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const STANDARD_FIELDS = [
  { group: "Signature Fields", items: ["Signature", "Initial", "Stamp", "Date Signed"] },
  { group: "Personal Information Fields", items: ["Name", "Email", "Company", "Title"] },
  { group: "Data Input Fields", items: ["Text", "Number", "Checkbox", "Dropdown", "Radio"] },
];

// const STANDARD_FIELDS = [
//   { group: "Signature Fields", items: ["Signature", "Initial"] },

// ];

const FIELD_ICONS = {
  Signature: "✒",
  Initial: "✒",
  Stamp: "▣",
  "Date Signed": "📅",
  Name: "👤",
  Email: "@",
  Company: "🏢",
  Title: "💼",
  Text: "T",
  Number: "#",
  Checkbox: "☑",
  Dropdown: "▾",
  Radio: "○",
};

function generateFieldId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatEnvelopeDate(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    return d.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    }) + " | " + d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function getInitials(name, email) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

// Distinct pastel colors so multiple recipients are easy to tell apart
const RECIPIENT_COLORS = [
  { border: "#5eb8d4", bg: "rgba(94, 184, 212, 0.5)" },   // pastel blue
  { border: "#e8a0b8", bg: "rgba(232, 160, 184, 0.5)" },   // pastel pink
  { border: "#7bc9a4", bg: "rgba(123, 201, 164, 0.5)" },  // pastel mint
  { border: "#b8a5e0", bg: "rgba(184, 165, 224, 0.5)" },   // pastel lavender
  { border: "#f0b88a", bg: "rgba(240, 184, 138, 0.5)" },   // pastel peach
  { border: "#e8d478", bg: "rgba(232, 212, 120, 0.5)" },   // pastel yellow
  { border: "#a8d4e0", bg: "rgba(168, 212, 224, 0.5)" },   // pastel sky
  { border: "#d4a8c8", bg: "rgba(212, 168, 200, 0.5)" },  // pastel mauve
];

function getRecipientColor(signRequestId, signers) {
  if (!signRequestId || !signers?.length) return RECIPIENT_COLORS[0];
  const idx = signers.findIndex((sr) => String(sr._id) === String(signRequestId));
  return RECIPIENT_COLORS[idx >= 0 ? idx % RECIPIENT_COLORS.length : 0];
}

/** Map display names (DocumentDetailPage / SigningPage) to backend enum values. */
function fieldTypeToBackend(displayType) {
  if (!displayType) return "signature";
  const map = {
    Signature: "signature",
    Initial: "initial",
    Stamp: "stamp",
    "Date Signed": "date",
    Name: "name",
    Email: "email",
    Company: "company",
    Title: "title",
    Text: "text",
    Number: "number",
    Checkbox: "checkbox",
    Dropdown: "dropdown",
    Radio: "radio",
  };
  return map[displayType] || String(displayType).toLowerCase();
}

function EditValuesModal({ options: initialOptions, onSave, onClose }) {
  const [opts, setOpts] = useState(
    initialOptions.length ? initialOptions.map((o) => {
      const label = o.label ?? o.value ?? "";
      const value = o.label ?? o.value ?? "";
      return { label, value };
    }) : [{ label: "", value: "" }]
  );
  return (
    <div className="prepare-send-warning-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-values-title" onClick={onClose}>
      <div className="prepare-edit-values-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prepare-edit-values-header">
          <h2 id="edit-values-title" className="prepare-edit-values-title">Edit values</h2>
          <button type="button" className="prepare-edit-values-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="prepare-edit-values-hint">Enter internal data values for this list of dropdown options.</p>
        <div className="prepare-edit-values-table">
          <div className="prepare-edit-values-row prepare-edit-values-header-row">
            <span className="prepare-edit-values-col">Options</span>
            <span className="prepare-edit-values-col">Values</span>
            <span className="prepare-edit-values-col-remove" aria-hidden />
          </div>
          {opts.map((o, idx) => (
            <div key={idx} className="prepare-edit-values-row">
              <input
                type="text"
                value={o.label}
                onChange={(e) => {
                  const next = [...opts];
                  next[idx] = { ...next[idx], label: e.target.value };
                  setOpts(next);
                }}
                placeholder="Option"
                className="prepare-edit-values-input"
              />
              <input
                type="text"
                value={o.value}
                onChange={(e) => {
                  const next = [...opts];
                  next[idx] = { ...next[idx], value: e.target.value };
                  setOpts(next);
                }}
                placeholder="Value"
                className="prepare-edit-values-input"
              />
              <button
                type="button"
                className="prepare-edit-values-remove"
                onClick={() => setOpts(opts.filter((_, i) => i !== idx))}
                aria-label="Remove option"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="prepare-property-add-option"
          onClick={() => setOpts([...opts, { label: "", value: "" }])}
        >
          + Add Option
        </button>
        <div className="prepare-edit-values-actions">
          <button type="button" className="prepare-btn secondary" onClick={onClose}>Close</button>
          <button
            type="button"
            className="prepare-btn primary"
            onClick={() => onSave(opts.filter((o) => ((o.label ?? "").trim()) || ((o.value ?? "").trim())).map((o) => ({ label: ((o.label ?? "").trim()) || (o.value ?? ""), value: ((o.value ?? "").trim()) || (o.label ?? "") })))}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doc, setDoc] = useState(null);
  const [signers, setSigners] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newSigner, setNewSigner] = useState({ name: "", email: "" });
  const [creatingSigner, setCreatingSigner] = useState(false);
  const [selfSigning, setSelfSigning] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(null);
  const [sendError, setSendError] = useState(null); // modal message when send fails (e.g. email bounced)
  const [agreementTab, setAgreementTab] = useState("recipients"); // recipients | details (when not draft)
  const [showRecipientDetails, setShowRecipientDetails] = useState(true);
  const [searchFields, setSearchFields] = useState("");
  const [zoom, setZoom] = useState(100);

  const [placedFields, setPlacedFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [selectedRecipientId, setSelectedRecipientId] = useState(null);
  const [pendingFieldType, setPendingFieldType] = useState(null); // DocuSign-style: selected field type waiting to be placed
  const [cursorOverlayPos, setCursorOverlayPos] = useState(null); // overlay coords when hovering over document with pendingFieldType
  const [draggingFieldId, setDraggingFieldId] = useState(null);
  const [resizingFieldId, setResizingFieldId] = useState(null);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [pdfPageCount, setPdfPageCount] = useState(null);
  const [savingFields, setSavingFields] = useState(false);
  const [sendWarningRecipients, setSendWarningRecipients] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageRotations, setPageRotations] = useState({});
  const [pageToDelete, setPageToDelete] = useState(null);
  const [deletingPage, setDeletingPage] = useState(false);
  const [editValuesModalOpen, setEditValuesModalOpen] = useState(false);
  const [documentFileKey, setDocumentFileKey] = useState(0);
  const [documentFileUrl, setDocumentFileUrl] = useState(null);
  const dragStartRef = useRef({ fieldX: 0, fieldY: 0, clientX: 0, clientY: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0, clientX: 0, clientY: 0 });
  const dragTargetRef = useRef(null);
  const convertedToOverlayRef = useRef(false);
  const pdfInnerRef = useRef(null);
  const docCanvasRef = useRef(null);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });

  const FIELD_SIZE_LIMITS = { minW: 80, maxW: 400, minH: 24, maxH: 120 };

  /** Measure all PDF page positions/sizes so we can send page-relative coords and detect which page a field is on */
  const getPagePlacementMeasurement = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = overlay?.closest?.(".prepare-doc-canvas");
    if (!overlay || !canvas) return null;
    let pageEls = Array.from(canvas.querySelectorAll('[data-rp^="page-"]'));
    if (!pageEls.length) {
      const firstPage = canvas.querySelector('[data-testid="page-1"]') || canvas.querySelector(".rpv-core__page-layer");
      if (!firstPage) return null;
      pageEls = [firstPage];
    }
    const overlayRect = overlay.getBoundingClientRect();
    const scale = zoom / 100;
    const pages = [];
    for (let i = 0; i < pageEls.length; i++) {
      const el = pageEls[i];
      const pageRect = el.getBoundingClientRect();
      const match = el.getAttribute?.("data-rp")?.match(/page-(\d+)/);
      const pageNum = match ? parseInt(match[1], 10) : i + 1;
      pages.push({
        pageNum,
        offsetX: (pageRect.left - overlayRect.left) / scale,
        offsetY: (pageRect.top - overlayRect.top) / scale,
        pageRenderWidth: pageRect.width / scale,
        pageRenderHeight: pageRect.height / scale,
      });
    }
    pages.sort((a, b) => a.pageNum - b.pageNum);
    const first = pages[0] || null;
    return {
      offsetX: first?.offsetX ?? 0,
      offsetY: first?.offsetY ?? 0,
      pageRenderWidth: first?.pageRenderWidth ?? 800,
      pageRenderHeight: first?.pageRenderHeight ?? undefined,
      pages,
    };
  }, [zoom]);

  useEffect(() => {
    async function load() {
      try {
        const [docRes, signRes, auditRes] = await Promise.all([
          apiClient.get(`/documents/${id}`),
          apiClient.get(`/sign-requests/${id}`),
          apiClient.get(`/signing/document/${id}/audit-logs`),
        ]);
        setDoc(docRes.data);
        const signerList = signRes.data || [];
        setSigners(signerList);
        setAuditLogs(auditRes.data);
        const typeToLabel = (t) => {
          if (!t) return "Signature";
          const lower = String(t).toLowerCase();
          const map = { signature: "Signature", initial: "Initial", stamp: "Stamp", date: "Date Signed", name: "Name", email: "Email", company: "Company", title: "Title", text: "Text", number: "Number", checkbox: "Checkbox", dropdown: "Dropdown", radio: "Radio" };
          return map[lower] || (t.charAt(0).toUpperCase() + (t.slice(1) || "").toLowerCase());
        };
        const built = signerList.flatMap((sr) =>
          (sr.signatureFields || []).map((f, i) => ({
            ...f,
            id: f.id || generateFieldId(),
            signRequestId: sr._id,
            type: typeToLabel(f.type),
            dataLabel: f.dataLabel ?? `${typeToLabel(f.type)} ${String(i + 1)}`,
            required: f.required !== false,
            scale: f.scale ?? 100,
            options: Array.isArray(f.options) ? f.options : [],
            defaultOption: f.defaultOption ?? "",
          }))
        );
        setPlacedFields(built);
        convertedToOverlayRef.current = false;
        if (signerList.length && !selectedRecipientId) {
          setSelectedRecipientId(signerList[0]._id);
        }
      } catch (err) {
        console.error(err);
        setError("Failed to load document");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // Once PDF has rendered, convert loaded (page-relative) field coords to overlay coords for display/drag
  useEffect(() => {
    if (placedFields.length === 0 || convertedToOverlayRef.current) return;
    const timer = setTimeout(() => {
      const m = getPagePlacementMeasurement();
      if (!m) return;
      const pages = m.pages ?? [];
      const getOffset = (pageNum) => {
        const p = pages.find((pg) => pg.pageNum === (pageNum || 1));
        return p ? { offsetX: p.offsetX, offsetY: p.offsetY } : { offsetX: m.offsetX ?? 0, offsetY: m.offsetY ?? 0 };
      };
      const hasOffset = pages.length ? pages.some((p) => p.offsetX !== 0 || p.offsetY !== 0) : (m.offsetX !== 0 || m.offsetY !== 0);
      if (hasOffset) {
        setPlacedFields((prev) =>
          prev.map((f) => {
            const { offsetX, offsetY } = getOffset(f.page);
            return { ...f, x: f.x + offsetX, y: f.y + offsetY };
          })
        );
        convertedToOverlayRef.current = true;
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [placedFields.length, getPagePlacementMeasurement]);

  const showDoc = !!(doc?.originalKey || doc?.originalFilePath);
  useEffect(() => {
    if (!doc?._id || (!doc.originalKey && !doc.originalFilePath)) {
      setDocumentFileUrl(null);
      return;
    }
    let cancelled = false;
    apiClient.get(`/documents/${doc._id}/file-url`).then((res) => {
      if (!cancelled && res.data?.url) setDocumentFileUrl(res.data.url);
    }).catch(() => {
      if (!cancelled) setDocumentFileUrl(null);
    });
    return () => { cancelled = true; };
  }, [doc?._id, doc?.originalKey, doc?.originalFilePath, doc?.signedKey, doc?.signedFilePath]);

  useEffect(() => {
    if (!showDoc) return;
    const el = pdfInnerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? {};
      if (width > 0 && height > 0) setContentSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showDoc]);

  // Keep document centered when zoom changes (zoom from center, not left/right)
  useEffect(() => {
    const hasSize = contentSize.width > 0 && contentSize.height > 0;
    if (!hasSize || !docCanvasRef.current) return;
    const canvas = docCanvasRef.current;
    const scale = zoom / 100;
    const wrapW = Math.round(contentSize.width * scale);
    const wrapH = Math.round(contentSize.height * scale);
    const centerScroll = () => {
      if (!canvas) return;
      const scrollLeft = Math.max(0, (wrapW - canvas.clientWidth) / 2);
      const scrollTop = Math.max(0, (wrapH - canvas.clientHeight) / 2);
      canvas.scrollLeft = scrollLeft;
      canvas.scrollTop = scrollTop;
    };
    centerScroll();
    const raf = requestAnimationFrame(centerScroll);
    return () => cancelAnimationFrame(raf);
  }, [zoom, contentSize.width, contentSize.height]);

  const TEXT_FORMATTING_FIELDS = ["Name", "Email", "Company", "Title", "Text"];

  const addField = useCallback((type, position) => {
    const recipientId = selectedRecipientId || signers[0]?._id;
    const defaultX = 50;
    const defaultY = 80 + placedFields.length * 42;
    const base = {
      id: generateFieldId(),
      type,
      signRequestId: recipientId,
      page: position?.page ?? 1,
      x: position?.x ?? defaultX,
      y: position?.y ?? defaultY,
      width: type === "Signature" || type === "Initial" ? 110 : 110,
      height: type === "Signature" || type === "Initial" ? 55 : 45,
      required: true,
      scale: 100,
      dataLabel: `${type} ${generateFieldId().slice(0, 8)}`,
      tooltip: "",
    };
    const textFormatting = {
      fontFamily: "Lucida Console",
      fontSize: 14,
      bold: false,
      italic: false,
      underline: false,
      fontColor: "Black",
    };
    let newField = { ...base };
    if (type === "Dropdown" || type === "Radio") {
      newField = { ...newField, options: [], defaultOption: "" };
    }
    if (type === "Name") {
      newField = { ...newField, nameFormat: "Full Name", ...textFormatting };
    }
    if (TEXT_FORMATTING_FIELDS.includes(type)) {
      newField = { ...newField, readOnly: false, ...textFormatting };
    }
    if (type === "Text") {
      newField = { ...newField, addText: "", characterLimit: 4000, hideWithAsterisks: false, fixedWidth: false };
    }
    setPlacedFields((prev) => [...prev, newField]);
    setSelectedFieldId(newField.id);
  }, [placedFields.length, selectedRecipientId, signers]);

  const updateField = useCallback((fieldId, updates) => {
    setPlacedFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, ...updates } : f))
    );
  }, []);

  const removeField = useCallback((fieldId) => {
    setPlacedFields((prev) => prev.filter((f) => f.id !== fieldId));
    setSelectedFieldId((current) => (current === fieldId ? null : current));
  }, []);

  /** Check if a field's center is within any document page */
  const isFieldInDocumentArea = useCallback((field, measurement) => {
    if (!measurement?.pages?.length) return true;
    const w = field.width ?? 110;
    const h = field.height ?? 55;
    const cx = (field.x ?? 0) + w / 2;
    const cy = (field.y ?? 0) + h / 2;
    for (const p of measurement.pages) {
      const pageH = p.pageRenderHeight ?? p.pageRenderWidth;
      if (cx >= p.offsetX && cx <= p.offsetX + p.pageRenderWidth &&
          cy >= p.offsetY && cy <= p.offsetY + pageH) {
        return true;
      }
    }
    return false;
  }, []);

  const overlayRef = useRef(null);

  /** Convert client coords to overlay-relative coords and resolve page number */
  const clientToOverlayCoords = useCallback((clientX, clientY) => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const overlayRect = overlay.getBoundingClientRect();
    const scale = zoom / 100;
    const x = (clientX - overlayRect.left) / scale;
    const y = (clientY - overlayRect.top) / scale;
    const measurement = getPagePlacementMeasurement();
    let page = 1;
    if (measurement?.pages?.length) {
      for (const p of measurement.pages) {
        if (x >= p.offsetX && x <= p.offsetX + p.pageRenderWidth &&
            y >= p.offsetY && y <= p.offsetY + (p.pageRenderHeight ?? p.pageRenderWidth)) {
          page = p.pageNum;
          break;
        }
      }
    }
    return { x, y, page };
  }, [zoom, getPagePlacementMeasurement]);

  /** DocuSign-style: track cursor position over document when a field type is selected */
  useEffect(() => {
    if (!pendingFieldType) {
      setCursorOverlayPos(null);
      return;
    }
    const handlePointerMove = (e) => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      const inBounds = e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inBounds) {
        const scale = zoom / 100;
        setCursorOverlayPos({
          x: (e.clientX - rect.left) / scale,
          y: (e.clientY - rect.top) / scale,
        });
      } else {
        setCursorOverlayPos(null);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setPendingFieldType(null);
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingFieldType, zoom]);

  const pendingFieldWidth = (pendingFieldType === "Signature" || pendingFieldType === "Initial") ? 110 : 110;
  const pendingFieldHeight = (pendingFieldType === "Signature" || pendingFieldType === "Initial") ? 55 : 45;

  /** DocuSign-style: place field on document click when one is carried by cursor (center at click) */
  const handleDocumentPlaceClick = useCallback((e) => {
    if (!pendingFieldType || e.button !== 0) return;
    if (e.target.closest?.(".prepare-placed-field")) return;
    const coords = clientToOverlayCoords(e.clientX, e.clientY);
    if (!coords) return;
    const w = pendingFieldWidth;
    const h = pendingFieldHeight;
    const measurement = getPagePlacementMeasurement();
    if (measurement?.pages?.length && !isFieldInDocumentArea({ x: coords.x - w / 2, y: coords.y - h / 2, width: w, height: h }, measurement)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    addField(pendingFieldType, {
      x: coords.x - w / 2,
      y: coords.y - h / 2,
      page: coords.page,
    });
    setPendingFieldType(null);
    setCursorOverlayPos(null);
  }, [pendingFieldType, addField, clientToOverlayCoords, getPagePlacementMeasurement, isFieldInDocumentArea, pendingFieldWidth, pendingFieldHeight]);

  const handleFieldPointerDown = useCallback((e, field) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    if (target.setPointerCapture) target.setPointerCapture(e.pointerId);
    dragTargetRef.current = target;
    setSelectedFieldId(field.id);
    setDraggingFieldId(field.id);
    dragStartRef.current = {
      fieldX: field.x,
      fieldY: field.y,
      fieldW: field.width,
      fieldH: field.height,
      clientX: e.clientX,
      clientY: e.clientY,
    };
  }, []);

  useEffect(() => {
    if (!draggingFieldId) return;
    const handlePointerMove = (e) => {
      const { fieldX, fieldY, fieldW, fieldH, clientX, clientY } = dragStartRef.current;
      const scale = zoom / 100;
      const dx = (e.clientX - clientX) / scale;
      const dy = (e.clientY - clientY) / scale;
      const newX = Math.max(0, fieldX + dx);
      const newY = Math.max(0, fieldY + dy);
      updateField(draggingFieldId, { x: newX, y: newY });
      dragStartRef.current = {
        fieldX: newX,
        fieldY: newY,
        fieldW: fieldW ?? 110,
        fieldH: fieldH ?? 55,
        clientX: e.clientX,
        clientY: e.clientY,
      };
    };
    const handlePointerUp = (e) => {
      const target = dragTargetRef.current;
      const { fieldX, fieldY, fieldW, fieldH } = dragStartRef.current;
      const measurement = getPagePlacementMeasurement();
      const fieldAtDrop = { x: fieldX, y: fieldY, width: fieldW, height: fieldH };
      if (measurement?.pages?.length && fieldW != null && fieldH != null) {
        const cx = fieldX + fieldW / 2;
        const cy = fieldY + fieldH / 2;
        let foundPage = false;
        for (const p of measurement.pages) {
          if (cx >= p.offsetX && cx <= p.offsetX + p.pageRenderWidth &&
              cy >= p.offsetY && cy <= p.offsetY + (p.pageRenderHeight ?? p.pageRenderWidth)) {
            updateField(draggingFieldId, { page: p.pageNum });
            foundPage = true;
            break;
          }
        }
        if (!foundPage) {
          removeField(draggingFieldId);
        }
      }
      if (target?.releasePointerCapture && e.pointerId !== undefined) {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
      dragTargetRef.current = null;
      setDraggingFieldId(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointerleave", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointerleave", handlePointerUp);
    };
  }, [draggingFieldId, updateField, zoom, getPagePlacementMeasurement]);

  const handleResizePointerDown = useCallback((e, field, handle) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingFieldId(field.id);
    setResizeHandle(handle);
    resizeStartRef.current = {
      x: field.x,
      y: field.y,
      w: field.width,
      h: field.height,
      clientX: e.clientX,
      clientY: e.clientY,
    };
  }, []);

  useEffect(() => {
    if (!resizingFieldId || !resizeHandle) return;
    const { minW, maxW, minH, maxH } = FIELD_SIZE_LIMITS;
    const handlePointerMove = (e) => {
      const { x, y, w, h, clientX, clientY } = resizeStartRef.current;
      const scale = zoom / 100;
      const dx = (e.clientX - clientX) / scale;
      const dy = (e.clientY - clientY) / scale;
      let newX = x, newY = y, newW = w, newH = h;
      if (resizeHandle.includes("e")) {
        newW = Math.min(maxW, Math.max(minW, w + dx));
      }
      if (resizeHandle.includes("w")) {
        const dw = Math.min(dx, w - minW);
        newW = w - dw;
        newX = x + dw;
      }
      if (resizeHandle.includes("s")) {
        newH = Math.min(maxH, Math.max(minH, h + dy));
      }
      if (resizeHandle.includes("n")) {
        const dh = Math.min(dy, h - minH);
        newH = h - dh;
        newY = y + dh;
      }
      updateField(resizingFieldId, { x: newX, y: newY, width: newW, height: newH });
      resizeStartRef.current = { x: newX, y: newY, w: newW, h: newH, clientX: e.clientX, clientY: e.clientY };
    };
    const handlePointerUp = () => {
      const fid = resizingFieldId;
      const { x, y, w, h } = resizeStartRef.current;
      const measurement = getPagePlacementMeasurement();
      if (measurement?.pages?.length && !isFieldInDocumentArea({ x, y, width: w, height: h }, measurement)) {
        removeField(fid);
      }
      setResizingFieldId(null);
      setResizeHandle(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizingFieldId, resizeHandle, updateField, removeField, zoom, getPagePlacementMeasurement, isFieldInDocumentArea]);

  const handleAddSigner = async (e) => {
    e.preventDefault();
    setCreatingSigner(true);
    try {
      const res = await apiClient.post(`/sign-requests/${id}`, {
        signerName: newSigner.name,
        signerEmail: newSigner.email,
        signatureFields: [],
      });
      setSigners((prev) => [res.data, ...prev]);
      setNewSigner({ name: "", email: "" });
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to add signer");
    } finally {
      setCreatingSigner(false);
    }
  };

  const handleSelfSign = async () => {
    if (!user?.email) {
      setError("Please log in again");
      return;
    }
    const existing = signers.find(
      (s) => (s.signerEmail || "").toLowerCase() === user.email.toLowerCase(),
    );
    if (existing?.signLinkToken) {
      navigate(`/sign/${existing.signLinkToken}`);
      return;
    }
    setSelfSigning(true);
    setError("");
    try {
      const res = await apiClient.post(`/sign-requests/${id}`, {
        signerName: user.name || user.email,
        signerEmail: user.email,
        signatureFields: [],
        skipEmail: true,
      });
      setSigners((prev) => [res.data, ...prev]);
      if (res.data?.signLinkToken) {
        navigate(`/sign/${res.data.signLinkToken}`);
      } else {
        setError("Could not open signing link");
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to start self-signing");
    } finally {
      setSelfSigning(false);
    }
  };

  const handleBack = () => navigate("/documents/new", { state: { editDocumentId: id } });

  const confirmDeletePage = useCallback(async () => {
    if (pageToDelete == null) return;
    setDeletingPage(true);
    try {
      await apiClient.delete(`/documents/${id}/pages/${pageToDelete}`);
      setDocumentFileKey((k) => k + 1);
      setCurrentPage((p) => (p >= pageToDelete && p > 1 ? p - 1 : Math.min(p, pdfPageCount != null ? pdfPageCount - 1 : p)));
      setPageToDelete(null);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to delete page");
    } finally {
      setDeletingPage(false);
    }
  }, [id, pageToDelete, pdfPageCount]);

  const mapFieldToPayload = useCallback((f, getPageOffset) => {
    const { offsetX, offsetY } = getPageOffset(f.page);
    const base = {
      id: f.id,
      signRequestId: f.signRequestId,
      type: fieldTypeToBackend(f.type),
      page: f.page ?? 1,
      x: Math.max(0, f.x - offsetX),
      y: Math.max(0, f.y - offsetY),
      width: f.width,
      height: f.height,
      required: f.required,
      dataLabel: f.dataLabel,
      tooltip: f.tooltip,
      scale: f.scale,
    };
    if (f.type === "Dropdown" || f.type === "Radio") {
      base.options = Array.isArray(f.options) ? f.options : [];
      base.defaultOption = f.defaultOption ?? "";
    }
    if (f.type === "Name" && f.nameFormat) base.nameFormat = f.nameFormat;
    if (["Name", "Email", "Company", "Title", "Text"].includes(f.type)) {
      if (f.readOnly != null) base.readOnly = f.readOnly;
      if (f.fontFamily != null) base.fontFamily = f.fontFamily;
      if (f.fontSize != null) base.fontSize = f.fontSize;
      if (f.bold != null) base.bold = f.bold;
      if (f.italic != null) base.italic = f.italic;
      if (f.underline != null) base.underline = f.underline;
      if (f.fontColor != null) base.fontColor = f.fontColor;
    }
    if (f.type === "Text") {
      if (f.addText != null) base.addText = f.addText;
      if (f.characterLimit != null) base.characterLimit = f.characterLimit;
      if (f.hideWithAsterisks != null) base.hideWithAsterisks = f.hideWithAsterisks;
      if (f.fixedWidth != null) base.fixedWidth = f.fixedWidth;
    }
    return base;
  }, []);

  const saveSigningFields = useCallback(async () => {
    setSavingFields(true);
    try {
      const measurement = getPagePlacementMeasurement();
      const page1RenderWidth = measurement?.pageRenderWidth ?? 800;
      const page1RenderHeight = measurement?.pageRenderHeight ?? undefined;
      const pages = measurement?.pages ?? [];
      const getPageOffset = (pageNum) => {
        const p = pages.find((pg) => pg.pageNum === (pageNum || 1));
        return p ? { offsetX: p.offsetX, offsetY: p.offsetY } : { offsetX: measurement?.offsetX ?? 0, offsetY: measurement?.offsetY ?? 0 };
      };
      await apiClient.put(`/documents/${id}/signing-fields`, {
        fields: placedFields.map((f) => mapFieldToPayload(f, getPageOffset)),
        page1RenderWidth: page1RenderWidth > 0 ? Math.round(page1RenderWidth) : undefined,
        page1RenderHeight: page1RenderHeight > 0 ? Math.round(page1RenderHeight) : undefined,
      });
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to save fields");
    } finally {
      setSavingFields(false);
    }
  }, [id, placedFields, getPagePlacementMeasurement, mapFieldToPayload]);

  const isSigningField = (type) =>
    type === "Signature" || type === "Initial";

  const signersWithoutPlace = () =>
    signers.filter((sr) => {
      const sid = String(sr._id);
      return !placedFields.some((f) => String(f.signRequestId) === sid);
    });

  const handleSendClick = () => {
    setError("");
    const missing = signersWithoutPlace();
    if (missing.length > 0) {
      setSendWarningRecipients(missing);
      return;
    }
    handleSendConfirm();
  };

  const handleSendConfirm = async () => {
    setSendWarningRecipients(null);
    setSendSuccess(null);
    setSending(true);
    try {
      const measurement = getPagePlacementMeasurement();
      const page1RenderWidth = measurement?.pageRenderWidth ?? 800;
      const page1RenderHeight = measurement?.pageRenderHeight ?? undefined;
      const pages = measurement?.pages ?? [];
      const getPageOffset = (pageNum) => {
        const p = pages.find((pg) => pg.pageNum === (pageNum || 1));
        return p ? { offsetX: p.offsetX, offsetY: p.offsetY } : { offsetX: measurement?.offsetX ?? 0, offsetY: measurement?.offsetY ?? 0 };
      };
      await apiClient.put(`/documents/${id}/signing-fields`, {
        fields: placedFields.map((f) => mapFieldToPayload(f, getPageOffset)),
        page1RenderWidth: page1RenderWidth > 0 ? Math.round(page1RenderWidth) : undefined,
        page1RenderHeight: page1RenderHeight > 0 ? Math.round(page1RenderHeight) : undefined,
      });
      const res = await apiClient.post(`/documents/${id}/send`);
      setSendSuccess(res.data.sentCount ?? 0);
    } catch (err) {
      console.error(err);
      const message = err.response?.data?.error || "The email bounced or is invalid. Please check the recipient's email address and try again.";
      setSendError(message);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <TopNavLayout>
        <p className="muted">Loading…</p>
      </TopNavLayout>
    );
  }
  if (error && !doc) {
    return (
      <TopNavLayout>
        <p className="auth-error">{error}</p>
      </TopNavLayout>
    );
  }
  if (!doc) {
    return (
      <TopNavLayout>
        <p className="muted">Not found</p>
      </TopNavLayout>
    );
  }

  const fileUrl = documentFileUrl ? (documentFileKey ? `${documentFileUrl}${documentFileUrl.includes("?") ? "&" : "?"}v=${documentFileKey}` : documentFileUrl) : null;
  const currentSigner = signers[0];
  const displayName = currentSigner
    ? [currentSigner.signerName, currentSigner.signerEmail].filter(Boolean).join(" · ") || "Recipient"
    : (doc.recipients?.[0]?.name) || "Recipient";

  const isDraft = doc.status === "draft";
  const envelopeTitle = doc.title?.endsWith(".pdf") ? doc.title : `${doc.title || "Document"}.pdf`;
  const envelopeDisplayTitle = `Complete with Collings eSign: ${envelopeTitle}`;
  const mySignRequest = user?.email
    ? signers.find((s) => (s.signerEmail || "").toLowerCase() === user.email.toLowerCase())
    : null;
  const needsMySignature = mySignRequest && mySignRequest.status !== "signed";
  const sentDate = doc.sentAt || doc.updatedAt;
  const expiringDate = doc.sentAt
    ? new Date(new Date(doc.sentAt).getTime() + 90 * 24 * 60 * 60 * 1000)
    : null;
  const allSigned = doc.status === "completed" || signers.every((s) => s.status === "signed");

  const selectedField = placedFields.find((f) => f.id === selectedFieldId);
  const scale = zoom / 100;
  const hasSize = contentSize.width > 0 && contentSize.height > 0;
  const wrapWidth = hasSize ? Math.round(contentSize.width * scale) : undefined;
  const wrapHeight = hasSize ? Math.round(contentSize.height * scale) : undefined;
  const filteredFieldItems = searchFields.trim()
    ? STANDARD_FIELDS.map((g) => ({
        ...g,
        items: g.items.filter((item) =>
          item.toLowerCase().includes(searchFields.toLowerCase()),
        ),
      })).filter((g) => g.items.length > 0)
    : STANDARD_FIELDS;

  // Sent agreement view (not draft) — Collings eSign-style detail with Recipients / Details tabs.
  // Only show prepare (assign fields + Send) when doc is draft; otherwise show agreement detail so we never try to save fields on a non-draft doc.
  if (!isDraft) {
    const documentDisplayUrl = documentFileUrl;
    const copyEnvelopeId = () => {
      navigator.clipboard?.writeText(doc._id).then(() => {});
    };
    return (
      <TopNavLayout>
        <div className="agreement-detail-shell">
     

          <div className="agreement-detail-status-row">
            <div className="agreement-detail-status-left">
              <span className="agreement-detail-status-badge">
                <span className="agreement-detail-status-icon">✒</span>
                {allSigned ? "Completed" : "Need to sign"}
              </span>
              {expiringDate && (
                <span className="agreement-detail-expiring">Expiring on {formatEnvelopeDate(expiringDate)}</span>
              )}
            </div>
            <div className="agreement-detail-title-block">
              <h1 className="agreement-detail-doc-title">{envelopeDisplayTitle}</h1>
              <p className="agreement-detail-from">
                From:{" "}
                {(() => {
                  const senderName = doc.ownerName || doc.ownerEmail || user?.name || user?.email || "Sender";
                  const senderEmail = doc.ownerEmail || user?.email;
                  const senderImg = getProfileImageUrl(doc.ownerProfileImageUrl || user?.profileImageUrl);
                  return (
                    <>
                      {senderImg && (
                        <img src={senderImg} alt="" className="agreement-detail-from-avatar" />
                      )}
                      <span>{senderName}</span>
                      {senderEmail && <span className="agreement-detail-from-email">{senderEmail}</span>}
                    </>
                  );
                })()}
              </p>
            </div>
            <div className="agreement-detail-actions">
              {needsMySignature && mySignRequest?.signLinkToken && (
                <button
                  type="button"
                  className="agreement-detail-sign-btn"
                  onClick={() => navigate(`/sign/${mySignRequest.signLinkToken}`)}
                >
                  Sign
                </button>
              )}
              <button type="button" className="agreement-detail-more-btn" aria-label="More actions">⋯</button>
            </div>
          </div>

          <div className="agreement-detail-body">
            <div className="agreement-detail-main">
              <div className="agreement-detail-tabs">
                <button
                  type="button"
                  className={`agreement-detail-tab ${agreementTab === "recipients" ? "active" : ""}`}
                  onClick={() => setAgreementTab("recipients")}
                >
                  Recipients ({signers.length})
                </button>
                <button
                  type="button"
                  className={`agreement-detail-tab ${agreementTab === "details" ? "active" : ""}`}
                  onClick={() => setAgreementTab("details")}
                >
                  Details
                </button>
              </div>

              {agreementTab === "recipients" && (
                <div className="agreement-detail-recipients-panel">
                  <div className="agreement-detail-recipients-toolbar">
                    <button type="button" className="agreement-detail-signing-order">Signing Order</button>
                    <label className="agreement-detail-toggle">
                      <input
                        type="checkbox"
                        checked={showRecipientDetails}
                        onChange={(e) => setShowRecipientDetails(e.target.checked)}
                      />
                      <span className="agreement-detail-toggle-slider" />
                      <span>Show recipient details</span>
                    </label>
                  </div>
                  {showRecipientDetails && (
                    <ul className="agreement-detail-recipients-list">
                      {signers.map((sr) => (
                        <li key={sr._id} className="agreement-detail-recipient-item">
                          <span className="agreement-detail-recipient-avatar" aria-hidden>
                            {getProfileImageUrl(sr.signerProfileImageUrl) ? (
                              <img src={getProfileImageUrl(sr.signerProfileImageUrl)} alt="" className="agreement-detail-recipient-avatar-img" />
                            ) : (
                              getInitials(sr.signerName, sr.signerEmail)
                            )}
                          </span>
                          <div className="agreement-detail-recipient-info">
                            <span className="agreement-detail-recipient-name">{sr.signerName}</span>
                            <span className="agreement-detail-recipient-email">{sr.signerEmail}</span>
                          </div>
                          <div className="agreement-detail-recipient-status">
                            <span className="agreement-detail-recipient-status-icon">✒</span>
                            {sr.status === "signed" ? "Signed" : "Needs to Sign"}
                            {(sr.signedAt || (sr.status !== "signed" && sr.updatedAt)) && (
                              <span className="agreement-detail-recipient-date">{formatEnvelopeDate(sr.signedAt || sr.updatedAt)}</span>
                            )}
                            {sr.status !== "signed" && sr.signLinkToken && String(sr._id) === String(mySignRequest?._id) && (
                              <button
                                type="button"
                                className="agreement-detail-sign-btn agreement-detail-sign-inline"
                                onClick={() => navigate(`/sign/${sr.signLinkToken}`)}
                              >
                                Sign
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {agreementTab === "details" && (
                <div className="agreement-detail-details-panel">
                  <dl className="agreement-detail-details-list">
                    <div className="agreement-detail-detail-row">
                      <dt>Envelope Name</dt>
                      <dd>{envelopeDisplayTitle}</dd>
                    </div>
                    <div className="agreement-detail-detail-row">
                      <dt>Envelope ID</dt>
                      <dd>
                        {doc._id}
                        <button type="button" className="agreement-detail-copy-inline" onClick={copyEnvelopeId} aria-label="Copy">📋</button>
                      </dd>
                    </div>
                    <div className="agreement-detail-detail-row">
                      <dt>From</dt>
                      <dd>{doc.ownerName || doc.ownerEmail || user?.name || user?.email || "—"} {(doc.ownerEmail || user?.email) && <span className="agreement-detail-email">{doc.ownerEmail || user?.email}</span>}</dd>
                    </div>
                    <div className="agreement-detail-detail-row">
                      <dt>Sent</dt>
                      <dd>{formatEnvelopeDate(sentDate)}</dd>
                    </div>
                    <div className="agreement-detail-detail-row">
                      <dt>Last Changed</dt>
                      <dd>{formatEnvelopeDate(doc.updatedAt)}</dd>
                    </div>
                    <div className="agreement-detail-detail-row">
                      <dt>Message</dt>
                      <dd>{doc.message?.trim() ? doc.message : "No message has been entered."}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>

            <aside className="agreement-detail-sidebar">
              <h3 className="agreement-detail-sidebar-title">Documents</h3>
              <div
                className="agreement-detail-doc-thumb-wrap"
                onClick={() => documentDisplayUrl && window.open(documentDisplayUrl, "_blank", "noopener,noreferrer")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && documentDisplayUrl && window.open(documentDisplayUrl, "_blank", "noopener,noreferrer")}
                aria-label={`View document: ${envelopeTitle}`}
              >
                <div className="agreement-detail-doc-thumb">
                  {documentDisplayUrl ? (
                  <Document
                    file={documentDisplayUrl}
                    onLoadSuccess={({ numPages }) => setPdfPageCount(numPages)}
                    loading={<span className="agreement-detail-doc-thumb-loading">Loading…</span>}
                    error={<span className="agreement-detail-doc-thumb-error">PDF</span>}
                  >
                    <Page pageNumber={1} width={200} renderTextLayer={false} renderAnnotationLayer={false} />
                  </Document>
                  ) : (
                    <span className="agreement-detail-doc-thumb-loading">Loading…</span>
                  )}
                </div>
                <span className="agreement-detail-doc-view-overlay">View</span>
              </div>
              <div className="agreement-detail-doc-meta">
                <span className="agreement-detail-doc-filename">{envelopeTitle}</span>
                {pdfPageCount != null && <span className="agreement-detail-doc-pages">{pdfPageCount} pages</span>}
              </div>
            </aside>
          </div>

          <footer className="agreement-detail-footer">
            <button type="button" className="agreement-detail-btn secondary" onClick={handleBack}>
              Back
            </button>
          </footer>
        </div>
      </TopNavLayout>
    );
  }

  return (
    <TopNavLayout>
      <div className={`prepare-shell ${sendSuccess != null ? "prepare-shell-sent" : ""}`}>
        {sendSuccess == null && (
        <header className="prepare-header">
          <div className="prepare-header-left">
            <button type="button" className="prepare-icon-btn" onClick={handleBack} aria-label="Close">
              ✕
            </button>
            <button type="button" className="prepare-icon-btn" onClick={handleBack} aria-label="Back">
              ‹
            </button>
            <span className="prepare-doc-name">{doc.title || "Document"}</span>
          </div>
          <div className="prepare-header-center">
            {/* <button type="button" className="prepare-icon-btn" aria-label="Undo">↩</button>
            <button type="button" className="prepare-icon-btn" aria-label="Redo">↪</button>
            <button
              type="button"
              className="prepare-icon-btn"
              aria-label="Save"
              onClick={saveSigningFields}
              disabled={savingFields}
              title="Save field placements"
            >
              {savingFields ? "…" : "💾"}
            </button> */}
            {/* <button type="button" className="prepare-icon-btn" aria-label="Delete">🗑</button> */}
            <div className="prepare-zoom-wrap">
              <button
                type="button"
                className="prepare-zoom-btn prepare-zoom-in"
                onClick={() => setZoom((z) => Math.min(175, z + 25))}
                disabled={zoom >= 175}
                aria-label="Zoom in"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                  <path d="M11 8v6" />
                  <path d="M8 11h6" />
                </svg>
              </button>
              <span className="prepare-zoom-value" aria-live="polite">{zoom}%</span>
              <button
                type="button"
                className="prepare-zoom-btn prepare-zoom-out"
                onClick={() => setZoom((z) => Math.max(100, z - 25))}
                disabled={zoom <= 100}
                aria-label="Zoom out"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                  <path d="M8 11h6" />
                </svg>
              </button>
            </div>
            {/* <button type="button" className="prepare-icon-btn" aria-label="Fit to page">⊡</button> */}
          </div>
          <div className="prepare-header-right">
          
          </div>
        </header>
        )}

        {sendSuccess == null && (
        <>
        <div className="prepare-body">
          <aside className="prepare-left">
            <div className="prepare-recipient-select-wrap">
              <label className="prepare-recipient-label">Assign fields to</label>
              <div className="prepare-recipient-select-row">
                {selectedRecipientId && (
                  <span
                    className="prepare-recipient-dot prepare-recipient-dot-select"
                    style={{
                      backgroundColor: getRecipientColor(selectedRecipientId, signers).border,
                    }}
                    aria-hidden
                  />
                )}
                <select
                  className="prepare-recipient-select"
                  value={selectedRecipientId ? String(selectedRecipientId) : ""}
                  onChange={(e) => setSelectedRecipientId(e.target.value || null)}
                  aria-label="Select recipient"
                >
                  {signers.map((sr, idx) => (
                    <option key={sr._id} value={String(sr._id)}>
                      {sr.signerName || sr.signerEmail || "Recipient"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="prepare-recipient-legend">
                {signers.slice(0, 6).map((sr, idx) => (
                  <span key={sr._id} className="prepare-recipient-legend-item">
                    <span
                      className="prepare-recipient-dot"
                      style={{ backgroundColor: RECIPIENT_COLORS[idx % RECIPIENT_COLORS.length].border }}
                      aria-hidden
                    />
                    <span className="prepare-recipient-legend-name">
                      {(sr.signerName || sr.signerEmail || "Recipient").split("@")[0]}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div className="prepare-search-wrap">
              <span className="prepare-search-icon">🔍</span>
              <input
                type="text"
                className="prepare-search-input"
                placeholder="Search Fields"
                value={searchFields}
                onChange={(e) => setSearchFields(e.target.value)}
              />
              {searchFields && (
                <button
                  type="button"
                  className="prepare-search-clear"
                  onClick={() => setSearchFields("")}
                  aria-label="Clear"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="prepare-fields-section">
              <h3 className="prepare-fields-title">Standard Fields</h3>
              {filteredFieldItems.map((group) => (
                <div key={group.group} className="prepare-field-group">
                  <div className="prepare-field-group-name">{group.group}</div>
                  <ul className="prepare-field-list">
                    {group.items.map((item) => (
                      <li key={item} className="prepare-field-item">
                        <button
                          type="button"
                          className={`prepare-field-btn ${pendingFieldType === item ? "selected" : ""}`}
                          onClick={() => setPendingFieldType((prev) => (prev === item ? null : item))}
                          title={pendingFieldType === item ? "Click on document to place field" : "Click to select, then click on document to place"}
                        >
                          <span className="prepare-field-icon">{FIELD_ICONS[item] || "•"}</span>
                          {item}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </aside>

          <main className="prepare-center">
            <div ref={docCanvasRef} className="prepare-doc-canvas">
              <div
                className="prepare-pdf-zoom-wrap"
                style={{
                  minWidth: hasSize ? `max(100%, ${wrapWidth}px)` : "100%",
                  minHeight: hasSize ? `max(100%, ${wrapHeight}px)` : "100%",
                }}
              >
                <div
                  ref={pdfInnerRef}
                  className="prepare-pdf-inner"
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "0 0",
                  }}
                >
                  <div className="prepare-pdf-wrap">
                    {fileUrl ? (
                      <PdfMainView
                        fileUrl={fileUrl}
                        pageRotations={pageRotations}
                        currentPage={currentPage}
                        onPageCount={setPdfPageCount}
                      />
                    ) : null}
                  </div>
                  <div ref={overlayRef} className="prepare-fields-overlay">
                {pendingFieldType && (
                  <>
                    <div
                      className="prepare-fields-dropzone"
                      style={{ pointerEvents: "auto" }}
                      onPointerDown={handleDocumentPlaceClick}
                      aria-label="Click to place field"
                    />
                    {cursorOverlayPos && (
                      <div
                        className="prepare-field-ghost"
                        style={{
                          left: cursorOverlayPos.x - pendingFieldWidth / 2,
                          top: cursorOverlayPos.y - pendingFieldHeight / 2,
                          width: pendingFieldWidth,
                          height: pendingFieldHeight,
                          pointerEvents: "none",
                        }}
                        aria-hidden
                      >
                        <span className="prepare-placed-field-icon">{FIELD_ICONS[pendingFieldType] || "•"}</span>
                        <span className="prepare-placed-field-label">
                          {pendingFieldType === "Signature" ? "Sign" : pendingFieldType}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {placedFields.map((f) => {
                  const color = getRecipientColor(f.signRequestId, signers);
                  const isSignatureType = f.type === "Signature" || f.type === "Initial";
                  const isSelected = selectedFieldId === f.id;
                  const showHandles = isSelected && isSignatureType;
                  return (
                    <div
                      key={f.id}
                      role="button"
                      tabIndex={0}
                      className={`prepare-placed-field ${isSignatureType ? "prepare-placed-field-sign" : ""} ${isSelected ? "selected" : ""} ${draggingFieldId === f.id ? "dragging" : ""} ${resizingFieldId === f.id ? "resizing" : ""}`}
                      style={{
                        left: f.x,
                        top: f.y,
                        width: f.width,
                        height: f.height,
                        borderColor: color.border,
                        backgroundColor: color.bg,
                      }}
                      onPointerDown={(e) => handleFieldPointerDown(e, f)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedFieldId(f.id);
                        }
                      }}
                    >
                      <span className="prepare-placed-field-icon" aria-hidden>{FIELD_ICONS[f.type] || "•"}</span>
                      <span className="prepare-placed-field-label">
                        {f.type === "Signature" ? "Sign" : f.type}
                      </span>
                      {showHandles && (
                        <>
                          {["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((h) => (
                            <div
                              key={h}
                              className={`prepare-resize-handle prepare-resize-handle-${h}`}
                              onPointerDown={(e) => handleResizePointerDown(e, f, h)}
                              aria-hidden
                            />
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
                  </div>
                </div>
              </div>
            </div>
          </main>

          <aside className="prepare-right">
            {selectedField ? (
              <div className="prepare-properties">
                <h3 className="prepare-properties-title">
                  <span className="prepare-properties-icon">{FIELD_ICONS[selectedField.type] || "•"}</span>
                  {selectedField.type}
                </h3>
                {signers.length > 0 && (
                  <div className="prepare-property-row prepare-property-recipient">
                    <span className="prepare-property-label">Recipient</span>
                    <select
                      value={selectedField.signRequestId ? String(selectedField.signRequestId) : ""}
                      onChange={(e) => updateField(selectedField.id, { signRequestId: e.target.value || null })}
                      aria-label="Assign to recipient"
                      className="prepare-property-select"
                    >
                      {signers.map((sr) => (
                        <option key={sr._id} value={String(sr._id)}>
                          {sr.signerName || sr.signerEmail || "Recipient"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {selectedField.type === "Name" && (
                  <div className="prepare-property-row prepare-property-recipient">
                    <span className="prepare-property-label">Name format</span>
                    <select
                      value={selectedField.nameFormat ?? "Full Name"}
                      onChange={(e) => updateField(selectedField.id, { nameFormat: e.target.value })}
                      aria-label="Name format"
                      className="prepare-property-select"
                    >
                      <option value="Full Name">Full Name</option>
                      <option value="First Name">First Name</option>
                      <option value="Last Name">Last Name</option>
                    </select>
                  </div>
                )}
                <label className="prepare-property-row prepare-property-check">
                  <input
                    type="checkbox"
                    checked={selectedField.required}
                    onChange={(e) => updateField(selectedField.id, { required: e.target.checked })}
                  />
                  <span>Required Field</span>
                </label>
                {["Company", "Title", "Text"].includes(selectedField.type) && (
                  <label className="prepare-property-row prepare-property-check">
                    <input
                      type="checkbox"
                      checked={selectedField.readOnly}
                      onChange={(e) => updateField(selectedField.id, { readOnly: e.target.checked })}
                    />
                    <span>Read Only</span>
                  </label>
                )}
                {selectedField.type === "Text" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Add Text ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <label className="prepare-property-row">
                        <textarea
                          value={selectedField.addText ?? ""}
                          onChange={(e) => updateField(selectedField.id, { addText: e.target.value })}
                          placeholder="Add Text"
                          rows={3}
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Character Limit</span>
                        <input
                          type="number"
                          min={1}
                          max={10000}
                          value={selectedField.characterLimit ?? 4000}
                          onChange={(e) =>
                            updateField(selectedField.id, { characterLimit: Math.max(1, Number(e.target.value) || 4000) })
                          }
                        />
                      </label>
                    </div>
                  </div>
                )}
                {(selectedField.type === "Dropdown" || selectedField.type === "Radio") && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Options ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <p className="prepare-property-hint">Fill in the list of options.</p>
                      {(selectedField.options || []).map((opt, idx) => (
                        <div key={idx} className="prepare-property-option-row">
                          <input
                            type="text"
                            value={opt.label ?? opt.value ?? ""}
                            onChange={(e) => {
                              const opts = [...(selectedField.options || [])];
                              const prev = opts[idx];
                              const newLabel = e.target.value;
                              const prevLabel = prev?.label ?? prev?.value ?? "";
                              const prevValue = prev?.value ?? prev?.label ?? "";
                              const valueStayedInSyncWithLabel = prevLabel === prevValue;
                              opts[idx] = {
                                label: newLabel,
                                value: valueStayedInSyncWithLabel ? newLabel : prevValue,
                              };
                              updateField(selectedField.id, { options: opts });
                            }}
                            placeholder="Option"
                            className="prepare-property-option-input"
                          />
                          <button
                            type="button"
                            className="prepare-property-option-remove"
                            onClick={() => {
                              const opts = (selectedField.options || []).filter((_, i) => i !== idx);
                              const def = selectedField.defaultOption;
                              const removed = selectedField.options?.[idx];
                              const sameAsRemoved = removed && (def === (removed.value ?? removed.label));
                              updateField(selectedField.id, {
                                options: opts,
                                defaultOption: sameAsRemoved ? "" : def,
                              });
                            }}
                            aria-label="Remove option"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="prepare-property-add-option"
                        onClick={() => {
                          const opts = [...(selectedField.options || []), { label: "New option", value: "New option" }];
                          updateField(selectedField.id, { options: opts });
                        }}
                      >
                        + ADD OPTION
                      </button>
                      <label className="prepare-property-row prepare-property-default-option">
                        <span>Default Option</span>
                        <select
                          value={selectedField.defaultOption ?? ""}
                          onChange={(e) => updateField(selectedField.id, { defaultOption: e.target.value })}
                          className="prepare-property-select"
                          aria-label="Default option"
                        >
                          <option value="">-- Select --</option>
                          {(selectedField.options || []).map((opt, idx) => {
                            const v = opt.value ?? opt.label ?? "";
                            return (
                              <option key={idx} value={v}>
                                {opt.label ?? opt.value ?? v}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="prepare-property-edit-values"
                        onClick={() => setEditValuesModalOpen(true)}
                      >
                        EDIT VALUES
                      </button>
                    </div>
                  </div>
                )}
                <div className="prepare-property-section">
                  <button type="button" className="prepare-property-section-head">
                    Formatting ▾
                  </button>
                  <div className="prepare-property-section-body">
                    {["Name", "Email", "Company", "Title", "Text"].includes(selectedField.type) ? (
                      <>
                        <label className="prepare-property-row">
                          <span>Font</span>
                          <select
                            value={selectedField.fontFamily ?? "Lucida Console"}
                            onChange={(e) => updateField(selectedField.id, { fontFamily: e.target.value })}
                            className="prepare-property-select"
                            aria-label="Font family"
                          >
                            <option value="Lucida Console">Lucida Console</option>
                            <option value="Arial">Arial</option>
                            <option value="Times New Roman">Times New Roman</option>
                            <option value="Georgia">Georgia</option>
                            <option value="Courier New">Courier New</option>
                            <option value="Verdana">Verdana</option>
                          </select>
                        </label>
                        <label className="prepare-property-row prepare-property-row-inline">
                          <span>Font Size</span>
                          <select
                            value={String(selectedField.fontSize ?? 14)}
                            onChange={(e) => updateField(selectedField.id, { fontSize: Number(e.target.value) || 14 })}
                            className="prepare-property-select prepare-property-select-narrow"
                            aria-label="Font size"
                          >
                            {[6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20].map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                          <div className="prepare-property-style-btns">
                            <button
                              type="button"
                              className={`prepare-property-style-btn ${selectedField.bold ? "active" : ""}`}
                              onClick={() => updateField(selectedField.id, { bold: !selectedField.bold })}
                              aria-label="Bold"
                              title="Bold"
                            >
                              B
                            </button>
                            <button
                              type="button"
                              className={`prepare-property-style-btn ${selectedField.italic ? "active" : ""}`}
                              onClick={() => updateField(selectedField.id, { italic: !selectedField.italic })}
                              aria-label="Italic"
                              title="Italic"
                            >
                              I
                            </button>
                            <button
                              type="button"
                              className={`prepare-property-style-btn ${selectedField.underline ? "active" : ""}`}
                              onClick={() => updateField(selectedField.id, { underline: !selectedField.underline })}
                              aria-label="Underline"
                              title="Underline"
                            >
                              U
                            </button>
                          </div>
                        </label>
                        <label className="prepare-property-row">
                          <span>Color</span>
                          <select
                            value={selectedField.fontColor ?? "Black"}
                            onChange={(e) => updateField(selectedField.id, { fontColor: e.target.value })}
                            className="prepare-property-select"
                            aria-label="Font color"
                          >
                            <option value="Black">Black</option>
                            <option value="White">White</option>
                            <option value="Red">Red</option>
                            <option value="Blue">Blue</option>
                            <option value="Green">Green</option>
                            <option value="Gray">Gray</option>
                            <option value="Dark Gray">Dark Gray</option>
                          </select>
                        </label>
                        {selectedField.type === "Text" && (
                          <>
                            <label className="prepare-property-row prepare-property-check">
                              <input
                                type="checkbox"
                                checked={selectedField.hideWithAsterisks}
                                onChange={(e) => updateField(selectedField.id, { hideWithAsterisks: e.target.checked })}
                              />
                              <span>Hide text with asterisks</span>
                            </label>
                            <label className="prepare-property-row prepare-property-check">
                              <input
                                type="checkbox"
                                checked={selectedField.fixedWidth}
                                onChange={(e) => updateField(selectedField.id, { fixedWidth: e.target.checked })}
                              />
                              <span>Fixed Width</span>
                            </label>
                          </>
                        )}
                      </>
                    ) : (
                      <label className="prepare-property-row">
                        <span>Scale %</span>
                        <input
                          type="number"
                          min={50}
                          max={200}
                          value={selectedField.scale}
                          onChange={(e) =>
                            updateField(selectedField.id, { scale: Number(e.target.value) || 100 })
                          }
                        />
                      </label>
                    )}
                  </div>
                </div>
                <div className="prepare-property-section">
                  <button type="button" className="prepare-property-section-head">
                    Data Label ▾
                  </button>
                  <div className="prepare-property-section-body">
                    <label className="prepare-property-row">
                      <input
                        type="text"
                        value={selectedField.dataLabel}
                        onChange={(e) =>
                          updateField(selectedField.id, { dataLabel: e.target.value })
                        }
                        placeholder="Data label"
                      />
                    </label>
                  </div>
                </div>
                <div className="prepare-property-section">
                  <button type="button" className="prepare-property-section-head">
                    Tooltip ▾
                  </button>
                  <div className="prepare-property-section-body">
                    <label className="prepare-property-row">
                      <textarea
                        value={selectedField.tooltip}
                        onChange={(e) =>
                          updateField(selectedField.id, { tooltip: e.target.value })
                        }
                        placeholder="Tooltip text"
                        rows={2}
                      />
                    </label>
                  </div>
                </div>
                <div className="prepare-property-section">
                  <button type="button" className="prepare-property-section-head">
                    Location ▾
                  </button>
                  <div className="prepare-property-section-body">
                    <label className="prepare-property-row">
                      <span>Pixels from Left</span>
                      <input
                        type="number"
                        min={0}
                        value={Math.round(selectedField.x)}
                        onChange={(e) =>
                          updateField(selectedField.id, { x: Number(e.target.value) || 0 })
                        }
                      />
                    </label>
                    <label className="prepare-property-row">
                      <span>Pixels from Top</span>
                      <input
                        type="number"
                        min={0}
                        value={Math.round(selectedField.y)}
                        onChange={(e) =>
                          updateField(selectedField.id, { y: Number(e.target.value) || 0 })
                        }
                      />
                    </label>
                  </div>
                </div>
                <div className="prepare-property-actions">
                  <button type="button" className="prepare-btn secondary prepare-btn-block">
                    SAVE AS CUSTOM FIELD
                  </button>
                  <button
                    type="button"
                    className="prepare-btn prepare-btn-danger prepare-btn-block"
                    onClick={() => removeField(selectedField.id)}
                  >
                    DELETE
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="prepare-right-panel-title">Pages</h3>
                <div className="prepare-thumbnails-header">
                  <span className="prepare-thumbnails-title">{doc.title || "Document"}</span>
                  {pdfPageCount != null && (
                    <span className="prepare-thumbnails-pages">Pages: {pdfPageCount}</span>
                  )}
                </div>
                <div className="prepare-thumbnails-list">
                  <PdfThumbnails
                    fileUrl={fileUrl}
                    onPageCount={setPdfPageCount}
                    onPageSelect={setCurrentPage}
                    onRotate={(pageNum) => {
                      setPageRotations((prev) => ({
                        ...prev,
                        [pageNum]: ((prev[pageNum] || 0) + 90) % 360,
                      }));
                    }}
                    onDelete={(pageNum) => setPageToDelete(pageNum)}
                    pageRotations={pageRotations}
                    currentPage={currentPage}
                  />
                </div>
              </>
            )}
          </aside>
        </div>

        <footer className="prepare-footer">
          <button type="button" className="prepare-btn secondary" onClick={handleBack}>
            Back
          </button>
          <button
            type="button"
            className="prepare-btn primary"
            onClick={handleSendClick}
            disabled={sending || !signers.length}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </footer>
        </>
        )}

        {sendWarningRecipients != null && sendWarningRecipients.length > 0 && (
          <div className="prepare-send-warning-backdrop" role="dialog" aria-modal="true" aria-labelledby="send-warning-title">
            <div className="prepare-send-warning-modal">
              <h2 id="send-warning-title" className="prepare-send-warning-title">Recipients without any fields</h2>
              <p className="prepare-send-warning-text">
                The following recipient(s) do not have any fields placed on the document.
              </p>
              <ul className="prepare-send-warning-list">
                {sendWarningRecipients.map((sr) => (
                  <li key={sr._id}>
                    {sr.signerName || sr.signerEmail || "Recipient"}
                  </li>
                ))}
              </ul>
              <p className="prepare-send-warning-actions-label">What would you like to do?</p>
              <div className="prepare-send-warning-actions">
                <button type="button" className="prepare-btn secondary" onClick={() => setSendWarningRecipients(null)}>
                  Back
                </button>
                <button type="button" className="prepare-btn primary" onClick={handleSendConfirm}>
                  Send without
                </button>
              </div>
            </div>
          </div>
        )}

        {editValuesModalOpen && selectedField && (selectedField.type === "Dropdown" || selectedField.type === "Radio") && (
          <EditValuesModal
            options={selectedField.options || []}
            onSave={(opts) => {
              const optionValues = opts.map((o) => (o.value ?? o.label ?? "").trim()).filter(Boolean);
              const currentDefault = selectedField.defaultOption ?? "";
              const defaultStillValid = currentDefault && optionValues.includes(currentDefault);
              const newDefault = defaultStillValid ? currentDefault : (optionValues[0] ?? "");
              updateField(selectedField.id, { options: opts, defaultOption: newDefault });
              setEditValuesModalOpen(false);
            }}
            onClose={() => setEditValuesModalOpen(false)}
          />
        )}

        {pageToDelete != null && (
          <div className="prepare-send-warning-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-page-title">
            <div className="prepare-send-warning-modal">
              <h2 id="delete-page-title" className="prepare-send-warning-title">Delete page?</h2>
              <p className="prepare-send-warning-text">
                Are you sure you want to delete Page {pageToDelete}? This cannot be undone.
              </p>
              <div className="prepare-send-warning-actions" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  className="prepare-btn secondary"
                  onClick={() => setPageToDelete(null)}
                  disabled={deletingPage}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="prepare-btn prepare-btn-danger"
                  onClick={confirmDeletePage}
                  disabled={deletingPage}
                >
                  {deletingPage ? "Deleting…" : "Yes, delete page"}
                </button>
              </div>
            </div>
          </div>
        )}

        {sendError != null && (
          <div className="prepare-send-error-backdrop" role="dialog" aria-modal="true" aria-labelledby="send-error-title" onClick={() => setSendError(null)}>
            <div className="prepare-send-error-modal" onClick={(e) => e.stopPropagation()}>
              <h2 id="send-error-title" className="prepare-send-error-title">
                {sendError.includes("draft") ? "Cannot update document" : "Email could not be sent"}
              </h2>
              <p className="prepare-send-error-text">{sendError}</p>
              <p className="prepare-send-error-hint">
                {sendError.includes("draft")
                  ? "This document was already sent. Use the agreement detail view to resend or manage recipients."
                  : "Please check and edit the recipient's email address, then try again."}
              </p>
              <div className="prepare-send-error-actions">
                <button type="button" className="prepare-btn primary" onClick={() => setSendError(null)}>
                  {sendError.includes("draft") ? "OK" : "Edit recipients"}
                </button>
              </div>
            </div>
          </div>
        )}

        {sendSuccess != null && (
          <div className="prepare-sent-screen" role="status">
            <div className="prepare-sent-content">
              <div className="prepare-sent-banner">
                <span className="prepare-sent-check" aria-hidden>✓</span>
                Agreement sent
              </div>
              <h1 className="prepare-sent-heading">Keep track of your agreements</h1>
              <p className="prepare-sent-text">
                Monitor the status of your agreements in real-time and keep your progress on schedule.
              </p>
              <button
                type="button"
                className="prepare-sent-cta"
                onClick={() => navigate("/agreements")}
              >
                Track Agreement Status
              </button>
            </div>
            <div className="prepare-sent-illustration" aria-hidden>
              <div className="prepare-sent-doc" />
              <div className="prepare-sent-plane prepare-sent-plane-1" />
              <div className="prepare-sent-plane prepare-sent-plane-2" />
              <div className="prepare-sent-plane prepare-sent-plane-3" />
            </div>
          </div>
        )}
        {error && <p className="auth-error prepare-error">{error}</p>}
      </div>
    </TopNavLayout>
  );
}
