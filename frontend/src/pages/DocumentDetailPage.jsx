import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useLocation } from "react-router-dom";
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
import DatePicker from "../components/DatePicker.jsx";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const STANDARD_FIELDS = [
  { group: "Signature Fields", items: ["Signature", "Initial", "Stamp", "Date Signed"] },
  { group: "Personal Information Fields", items: ["Name", "Email", "Company", "Title"] },
  { group: "Data Input Fields", items: ["Text", "Number", "Checkbox", "Dropdown", "Radio"] },
  { group: "Action Fields", items: ["Note", "Approve", "Decline"] },
];

// const STANDARD_FIELDS = [
//   { group: "Signature Fields", items: ["Signature", "Initial"] },

// ];

const FIELD_ICONS = {
  Signature: <i className="lni lni-pen-to-square" aria-hidden />,
  Initial: <i className="lni lni-pen-to-square" aria-hidden />,
  Stamp: <i className="lni lni-stamp" aria-hidden />,
  "Date Signed": <i className="lni lni-calendar-days" aria-hidden />,
  Name: <i className="lni lni-user-4" aria-hidden />,
  Email: "@",
  Company: <i className="lni lni-buildings-1" aria-hidden />,
  Title: <i className="lni lni-briefcase-1" aria-hidden />,
  Text: "T",
  Number: "#",
  Checkbox: <i className="lni lni-check-square-2" aria-hidden />,
  Dropdown: <i className="lni lni-angle-double-down" aria-hidden />,
  Radio: "○",
  Note: <i className="lni lni-clipboard" aria-hidden />,
  Approve: <i className="lni lni-check-circle-1" aria-hidden />,
  Decline: <i className="lni lni-xmark-circle" aria-hidden />,
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
    Note: "note",
    Approve: "approve",
    Decline: "decline",
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
          <button type="button" className="prepare-edit-values-close" onClick={onClose} aria-label="Close"><i className="lni lni-xmark" aria-hidden /></button>
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
                <i className="lni lni-xmark" aria-hidden />
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

function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isTemplateFlow = location.state?.isTemplateFlow === true;
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
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [saveAsTemplateModalOpen, setSaveAsTemplateModalOpen] = useState(false);
  const [templateLabel, setTemplateLabel] = useState("");
  const [saveTemplateError, setSaveTemplateError] = useState("");
  const [editValuesModalOpen, setEditValuesModalOpen] = useState(false);
  const [fieldsPopupOpen, setFieldsPopupOpen] = useState(false); // mobile: fields panel as popup
  const [rightPanelPopupOpen, setRightPanelPopupOpen] = useState(false); // mobile: Pages/Properties as popup
  const [documentFileKey, setDocumentFileKey] = useState(0);
  const [documentFileUrl, setDocumentFileUrl] = useState(null);
  const [editingFieldId, setEditingFieldId] = useState(null); // ID of field being edited inline
  const dragStartRef = useRef({ fieldX: 0, fieldY: 0, clientX: 0, clientY: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0, clientX: 0, clientY: 0 });
  const dragTargetRef = useRef(null);
  const docCanvasRef = useRef(null);
  const prevZoomRef = useRef(zoom);
  const overlayRef = useRef(null);

  const FIELD_SIZE_LIMITS = { minW: 80, maxW: 400, minH: 24, maxH: 120 };

  /** Cached page measurement (unscaled coords). Updated in useLayoutEffect after DOM/zoom so fields stay in place when zooming. */
  const [pagePlacementMeasurement, setPagePlacementMeasurement] = useState(null);

  function computePagePlacementMeasurement(scale) {
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
  }

  /** Measure after DOM has the current zoom applied so field positions don't jump when zooming. */
  useLayoutEffect(() => {
    const scale = zoom / 100;
    const next = computePagePlacementMeasurement(scale);
    setPagePlacementMeasurement(next);
  }, [zoom, documentFileUrl, documentFileKey, pdfPageCount]);

  /** Measure all PDF page positions/sizes. Uses cached measurement so zoom changes don't read stale DOM during render. */
  const getPagePlacementMeasurement = useCallback(() => {
    if (pagePlacementMeasurement) return pagePlacementMeasurement;
    return computePagePlacementMeasurement(zoom / 100);
  }, [pagePlacementMeasurement, zoom]);

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
          const map = { signature: "Signature", initial: "Initial", stamp: "Stamp", date: "Date Signed", name: "Name", email: "Email", company: "Company", title: "Title", text: "Text", number: "Number", checkbox: "Checkbox", dropdown: "Dropdown", radio: "Radio", note: "Note", approve: "Approve", decline: "Decline" };
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
            page: f.page ?? 1,
            xPct: f.xPct,
            yPct: f.yPct,
            wPct: f.wPct,
            hPct: f.hPct,
            pageX: f.x,
            pageY: f.y,
          }))
        );
        setPlacedFields(built);
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

  // Fields loaded from API use pageX/pageY (page-relative); overlay position is computed at render time.

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

  // Keep the same viewport center when zoom changes
  useEffect(() => {
    const canvas = docCanvasRef.current;
    if (!canvas) return;

    const prevScale = (prevZoomRef.current || 100) / 100;
    const nextScale = (zoom || 100) / 100;

    const prevCenterX = canvas.scrollLeft + canvas.clientWidth / 2;
    const prevCenterY = canvas.scrollTop + canvas.clientHeight / 2;
    const unscaledCenterX = prevScale ? prevCenterX / prevScale : prevCenterX;
    const unscaledCenterY = prevScale ? prevCenterY / prevScale : prevCenterY;

    const apply = () => {
      const nextCenterX = unscaledCenterX * nextScale;
      const nextCenterY = unscaledCenterY * nextScale;
      let nextLeft = nextCenterX - canvas.clientWidth / 2;
      let nextTop = nextCenterY - canvas.clientHeight / 2;

      const maxLeft = Math.max(0, canvas.scrollWidth - canvas.clientWidth);
      const maxTop = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
      nextLeft = Math.min(Math.max(0, nextLeft), maxLeft);
      nextTop = Math.min(Math.max(0, nextTop), maxTop);

      canvas.scrollLeft = nextLeft;
      canvas.scrollTop = nextTop;
    };

    apply();
    const raf = requestAnimationFrame(apply);
    prevZoomRef.current = zoom;
    return () => cancelAnimationFrame(raf);
  }, [zoom]);

  const TEXT_FORMATTING_FIELDS = ["Name", "Email", "Company", "Title", "Text"];

  // Close mobile fields popup when user selects a field type
  useEffect(() => {
    if (fieldsPopupOpen && pendingFieldType) {
      setFieldsPopupOpen(false);
    }
  }, [fieldsPopupOpen, pendingFieldType]);

  const addField = useCallback((type, position) => {
    const recipientId = selectedRecipientId || signers[0]?._id;
    const defaultPage = 1;
    const DATA_INPUT_COMPACT = ["Checkbox", "Radio"];
    const DATA_INPUT_RECTANGLE = ["Text", "Number", "Dropdown", "Name", "Email", "Company", "Title"];
    const defWPct = DATA_INPUT_COMPACT.includes(type) ? 12 : DATA_INPUT_RECTANGLE.includes(type) ? 16 : 14;
    const defHPct = DATA_INPUT_COMPACT.includes(type) ? 3 : DATA_INPUT_RECTANGLE.includes(type) ? 4 : 6;
    const base = {
      id: generateFieldId(),
      type,
      signRequestId: recipientId,
      page: position?.page ?? defaultPage,
      xPct: position?.xPct ?? 8,
      yPct: position?.yPct ?? 10,
      wPct: position?.wPct ?? defWPct,
      hPct: position?.hPct ?? defHPct,
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
      newField = { ...newField, nameFormat: "Full Name", dataLabel: "Full Name", defaultValue: "", ...textFormatting };
    }
    if (TEXT_FORMATTING_FIELDS.includes(type)) {
      newField = { ...newField, readOnly: false, ...textFormatting };
    }
    if (type === "Email") {
      newField = { ...newField, defaultValue: "" };
    }
    if (type === "Company") {
      newField = { ...newField, defaultValue: "" };
    }
    if (type === "Title") {
      newField = { ...newField, defaultValue: "" };
    }
    if (type === "Text") {
      newField = { ...newField, addText: "", characterLimit: 4000, hideWithAsterisks: false, fixedWidth: false, defaultValue: "" };
    }
    if (type === "Checkbox") {
      newField = { ...newField, caption: "", checked: false };
    }
    if (type === "Number") {
      newField = { ...newField, readOnly: false, minValue: undefined, maxValue: undefined, decimalPlaces: 0, placeholder: "", defaultValue: "", ...textFormatting };
    }
    if (type === "Radio") {
      newField = { ...newField, groupName: "" };
    }
    if (type === "Note") {
      newField = { ...newField, noteContent: "" };
    }
    if (type === "Date Signed") {
      const today = new Date();
      const day = String(today.getDate()).padStart(2, '0');
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const year = today.getFullYear();
      const australianDate = `${day}/${month}/${year}`;
      newField = { ...newField, defaultValue: australianDate };
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

  /** Get overlay (x, y) for rendering; uses page-relative coords when present so layout changes don't move fields. Prefers field.x/y when set (e.g. during drag). */
  const getFieldOverlayPosition = useCallback((field, measurement) => {
    if (field.x != null && field.y != null) return { x: field.x, y: field.y };
    if (field.pageX != null && field.pageY != null && measurement?.pages?.length) {
      const p = measurement.pages.find((pg) => pg.pageNum === (field.page ?? 1));
      if (p) return { x: p.offsetX + field.pageX, y: p.offsetY + field.pageY };
    }
    return { x: field.x ?? 0, y: field.y ?? 0 };
  }, []);

  /** Check if a field's center is within any document page */
  const isFieldInDocumentArea = useCallback((field, measurement) => {
    if (!measurement?.pages?.length) return true;
    const pos = getFieldOverlayPosition(field, measurement);
    const w = field.width ?? 110;
    const h = field.height ?? 55;
    const cx = pos.x + w / 2;
    const cy = pos.y + h / 2;
    for (const p of measurement.pages) {
      const pageH = p.pageRenderHeight ?? p.pageRenderWidth;
      if (cx >= p.offsetX && cx <= p.offsetX + p.pageRenderWidth &&
          cy >= p.offsetY && cy <= p.offsetY + pageH) {
        return true;
      }
    }
    return false;
  }, [getFieldOverlayPosition]);

  /** Convert client click to percent coords relative to page wrapper (recommended approach). */
  const clientToPercentCoords = useCallback((clientX, clientY) => {
    const canvas = docCanvasRef.current;
    if (!canvas) return null;
    const pageEls = Array.from(canvas.querySelectorAll('[data-rp^="page-"]'));
    for (const pageWrapper of pageEls) {
      const rect = pageWrapper.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        const xPx = clientX - rect.left;
        const yPx = clientY - rect.top;
        const xPct = (xPx / rect.width) * 100;
        const yPct = (yPx / rect.height) * 100;
        const match = pageWrapper.getAttribute?.("data-rp")?.match(/page-(\d+)/);
        const page = match ? parseInt(match[1], 10) : 1;
        return { xPct, yPct, page };
      }
    }
    return null;
  }, []);

  /** Convert overlay coords to page-relative (page, pageX, pageY) so position survives layout changes */
  const overlayToPageRelative = useCallback((overlayX, overlayY) => {
    const measurement = getPagePlacementMeasurement();
    if (!measurement?.pages?.length) return { page: 1, pageX: overlayX, pageY: overlayY };
    const cx = overlayX;
    const cy = overlayY;
    for (const p of measurement.pages) {
      const pageH = p.pageRenderHeight ?? p.pageRenderWidth;
      if (cx >= p.offsetX && cx <= p.offsetX + p.pageRenderWidth &&
          cy >= p.offsetY && cy <= p.offsetY + pageH) {
        return { page: p.pageNum, pageX: overlayX - p.offsetX, pageY: overlayY - p.offsetY };
      }
    }
    const first = measurement.pages[0];
    return { page: first?.pageNum ?? 1, pageX: overlayX - (first?.offsetX ?? 0), pageY: overlayY - (first?.offsetY ?? 0) };
  }, [getPagePlacementMeasurement]);

  /** DocuSign-style: track cursor position over document when a field type is selected */
  useEffect(() => {
    if (!pendingFieldType) {
      setCursorOverlayPos(null);
      return;
    }
    const handlePointerMove = (e) => {
      const coords = clientToPercentCoords(e.clientX, e.clientY);
      if (coords) {
        setCursorOverlayPos({ xPct: coords.xPct, yPct: coords.yPct, page: coords.page });
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
  }, [pendingFieldType, clientToPercentCoords]);

  const DATA_INPUT_COMPACT = ["Checkbox", "Radio"];
  const DATA_INPUT_RECTANGLE = ["Text", "Number", "Dropdown", "Name", "Email", "Company", "Title"];
  const pendingWPct = DATA_INPUT_COMPACT.includes(pendingFieldType) ? 12 : DATA_INPUT_RECTANGLE.includes(pendingFieldType) ? 16 : 14;
  const pendingHPct = DATA_INPUT_COMPACT.includes(pendingFieldType) ? 3 : DATA_INPUT_RECTANGLE.includes(pendingFieldType) ? 4 : (pendingFieldType === "Signature" || pendingFieldType === "Initial") ? 6 : 5;

  /** DocuSign-style: place field on document click when one is carried by cursor (center at click). Uses percent coords. */
  const handleDocumentPlaceClick = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest?.(".prepare-placed-field")) return;
    
    if (pendingFieldType) {
      const coords = clientToPercentCoords(e.clientX, e.clientY);
      if (!coords) return;
      e.preventDefault();
      e.stopPropagation();
      addField(pendingFieldType, {
        page: coords.page,
        xPct: Math.max(0, coords.xPct - pendingWPct / 2),
        yPct: Math.max(0, coords.yPct - pendingHPct / 2),
        wPct: pendingWPct,
        hPct: pendingHPct,
      });
      setPendingFieldType(null);
      setCursorOverlayPos(null);
    } else {
      setSelectedFieldId(null);
    }
  }, [pendingFieldType, addField, clientToPercentCoords, pendingWPct, pendingHPct]);

  const handleFieldPointerDown = useCallback((e, field) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    if (target.setPointerCapture) target.setPointerCapture(e.pointerId);
    dragTargetRef.current = target;
    setSelectedFieldId(field.id);
    setDraggingFieldId(field.id);
    const coords = clientToPercentCoords(e.clientX, e.clientY);
    dragStartRef.current = {
      fieldXPct: field.xPct ?? 8,
      fieldYPct: field.yPct ?? 10,
      fieldWPct: field.wPct ?? 14,
      fieldHPct: field.hPct ?? 6,
      clientX: e.clientX,
      clientY: e.clientY,
      startXPct: coords?.xPct ?? field.xPct ?? 8,
      startYPct: coords?.yPct ?? field.yPct ?? 10,
    };
  }, [clientToPercentCoords]);

  useEffect(() => {
    if (!draggingFieldId) return;
    const handlePointerMove = (e) => {
      const { fieldXPct, fieldYPct, fieldWPct, fieldHPct, startXPct, startYPct } = dragStartRef.current;
      const coords = clientToPercentCoords(e.clientX, e.clientY);
      if (!coords) return;
      const dxPct = coords.xPct - startXPct;
      const dyPct = coords.yPct - startYPct;
      const newXPct = Math.max(0, Math.min(100 - fieldWPct, fieldXPct + dxPct));
      const newYPct = Math.max(0, Math.min(100 - fieldHPct, fieldYPct + dyPct));
      updateField(draggingFieldId, { xPct: newXPct, yPct: newYPct });
      dragStartRef.current = {
        fieldXPct: newXPct,
        fieldYPct: newYPct,
        fieldWPct,
        fieldHPct,
        clientX: e.clientX,
        clientY: e.clientY,
        startXPct: coords.xPct,
        startYPct: coords.yPct,
      };
    };
    const handlePointerUp = (e) => {
      const target = dragTargetRef.current;
      const { fieldXPct, fieldYPct } = dragStartRef.current;
      const coords = clientToPercentCoords(e.clientX, e.clientY);
      const page = coords?.page ?? 1;
      updateField(draggingFieldId, { page, xPct: fieldXPct, yPct: fieldYPct });
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
  }, [draggingFieldId, updateField, clientToPercentCoords]);

  const minWPct = 3;
  const maxWPct = 55;
  const minHPct = 2;
  const maxHPct = 18;

  const handleResizePointerDown = useCallback((e, field, handle) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingFieldId(field.id);
    setResizeHandle(handle);
    resizeStartRef.current = {
      xPct: field.xPct ?? 8,
      yPct: field.yPct ?? 10,
      wPct: field.wPct ?? 14,
      hPct: field.hPct ?? 6,
      page: field.page ?? 1,
      clientX: e.clientX,
      clientY: e.clientY,
    };
  }, []);

  useEffect(() => {
    if (!resizingFieldId || !resizeHandle) return;
    const handlePointerMove = (e) => {
      const canvas = docCanvasRef.current;
      if (!canvas) return;
      const pageWrapper = canvas.querySelector(`[data-rp="page-${resizeStartRef.current.page}"]`);
      if (!pageWrapper) return;
      const rect = pageWrapper.getBoundingClientRect();
      const dxPct = ((e.clientX - resizeStartRef.current.clientX) / rect.width) * 100;
      const dyPct = ((e.clientY - resizeStartRef.current.clientY) / rect.height) * 100;
      let { xPct, yPct, wPct, hPct } = resizeStartRef.current;
      if (resizeHandle.includes("e")) {
        wPct = Math.min(maxWPct, Math.max(minWPct, wPct + dxPct));
      }
      if (resizeHandle.includes("w")) {
        const dw = Math.min(dxPct, wPct - minWPct);
        wPct = wPct - dw;
        xPct = xPct + dw;
      }
      if (resizeHandle.includes("s")) {
        hPct = Math.min(maxHPct, Math.max(minHPct, hPct + dyPct));
      }
      if (resizeHandle.includes("n")) {
        const dh = Math.min(dyPct, hPct - minHPct);
        hPct = hPct - dh;
        yPct = yPct + dh;
      }
      updateField(resizingFieldId, { xPct, yPct, wPct, hPct });
      resizeStartRef.current = { ...resizeStartRef.current, xPct, yPct, wPct, hPct, clientX: e.clientX, clientY: e.clientY };
    };
    const handlePointerUp = () => {
      setResizingFieldId(null);
      setResizeHandle(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizingFieldId, resizeHandle, updateField]);

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

  const handleBack = () => {
    if (isTemplateFlow) {
      navigate("/templates");
    } else {
      navigate("/documents/new", { state: { editDocumentId: id } });
    }
  };

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

  const mapFieldToPayload = useCallback((f) => {
    const base = {
      id: f.id,
      signRequestId: f.signRequestId,
      type: fieldTypeToBackend(f.type),
      page: f.page ?? 1,
      xPct: f.xPct ?? 8,
      yPct: f.yPct ?? 10,
      wPct: f.wPct ?? 14,
      hPct: f.hPct ?? 6,
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
    if (["Name", "Email", "Company", "Title", "Text", "Date Signed"].includes(f.type)) {
      if (f.readOnly != null) base.readOnly = f.readOnly;
      if (f.fontFamily != null) base.fontFamily = f.fontFamily;
      if (f.fontSize != null) base.fontSize = f.fontSize;
      if (f.bold != null) base.bold = f.bold;
      if (f.italic != null) base.italic = f.italic;
      if (f.underline != null) base.underline = f.underline;
      if (f.fontColor != null) base.fontColor = f.fontColor;
      if (f.defaultValue != null) base.defaultValue = f.defaultValue;
    }
    if (f.type === "Text") {
      if (f.addText != null) base.addText = f.addText;
      if (f.characterLimit != null) base.characterLimit = f.characterLimit;
      if (f.hideWithAsterisks != null) base.hideWithAsterisks = f.hideWithAsterisks;
      if (f.fixedWidth != null) base.fixedWidth = f.fixedWidth;
    }
    if (f.type === "Checkbox") {
      if (f.caption != null) base.caption = f.caption;
      if (f.checked != null) base.checked = f.checked;
    }
    if (f.type === "Number") {
      if (f.readOnly != null) base.readOnly = f.readOnly;
      if (f.minValue != null) base.minValue = f.minValue;
      if (f.maxValue != null) base.maxValue = f.maxValue;
      if (f.decimalPlaces != null) base.decimalPlaces = f.decimalPlaces;
      if (f.placeholder != null) base.placeholder = f.placeholder;
      if (f.defaultValue != null) base.defaultValue = f.defaultValue;
      if (f.fontFamily != null) base.fontFamily = f.fontFamily;
      if (f.fontSize != null) base.fontSize = f.fontSize;
      if (f.bold != null) base.bold = f.bold;
      if (f.italic != null) base.italic = f.italic;
      if (f.underline != null) base.underline = f.underline;
      if (f.fontColor != null) base.fontColor = f.fontColor;
    }
    if (f.type === "Radio" && f.groupName != null) base.groupName = f.groupName;
    if (f.type === "Note" && f.noteContent != null) base.noteContent = f.noteContent;
    return base;
  }, []);

  const saveSigningFields = useCallback(async () => {
    setSavingFields(true);
    try {
      await apiClient.put(`/documents/${id}/signing-fields`, {
        fields: placedFields.map(mapFieldToPayload),
      });
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to save fields");
    } finally {
      setSavingFields(false);
    }
  }, [id, placedFields, mapFieldToPayload]);

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
      await apiClient.put(`/documents/${id}/signing-fields`, {
        fields: placedFields.map(mapFieldToPayload),
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

  const openSaveAsTemplateModal = () => {
    setSaveAsTemplateModalOpen(true);
    setTemplateLabel(doc?.title || "");
    setSaveTemplateError("");
  };

  const closeSaveAsTemplateModal = () => {
    setSaveAsTemplateModalOpen(false);
    setTemplateLabel("");
    setSaveTemplateError("");
  };

  const handleSaveAsTemplate = async () => {
    const label = templateLabel.trim();
    if (!label) {
      setSaveTemplateError("Template label is required.");
      return;
    }
    setSavingTemplate(true);
    setSaveTemplateError("");
    try {
      await apiClient.put(`/documents/${id}/signing-fields`, {
        fields: placedFields.map(mapFieldToPayload),
      });
      await apiClient.put(`/documents/${id}`, { isTemplate: true, title: label });
      setDoc((prev) => prev ? { ...prev, isTemplate: true, title: label } : prev);
      closeSaveAsTemplateModal();
      navigate("/templates");
    } catch (err) {
      console.error(err);
      setSaveTemplateError(err.response?.data?.error || "Failed to save as template");
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSaveEdits = async () => {
    setSavingFields(true);
    setError("");
    try {
      await apiClient.put(`/documents/${id}/signing-fields`, {
        fields: placedFields.map(mapFieldToPayload),
      });
      navigate("/templates");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to save edits");
    } finally {
      setSavingFields(false);
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
                <span className="agreement-detail-status-icon"><i className="lni lni-pen-to-square" aria-hidden /></span>
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
                            <span className="agreement-detail-recipient-status-icon"><i className="lni lni-pen-to-square" aria-hidden /></span>
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
                        <button type="button" className="agreement-detail-copy-inline" onClick={copyEnvelopeId} aria-label="Copy"><i className="lni lni-clipboard" aria-hidden /></button>
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
            <button type="button" className="prepare-icon-btn" onClick={handleBack} aria-label="Back">
              <i className="lni lni-arrow-left" aria-hidden />
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
              {savingFields ? "…" : <i className="lni lni-floppy-disk-1" aria-hidden />}
            </button> */}
            {/* <button type="button" className="prepare-icon-btn" aria-label="Delete"><i className="lni lni-trash-3" aria-hidden /></button> */}
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
            <button
              type="button"
              className="prepare-fields-fab"
              onClick={() => setFieldsPopupOpen(true)}
              aria-label="Open fields panel"
              title="Add field"
              style={{ display: rightPanelPopupOpen ? "none" : undefined }}
            >
            <span className="prepare-fields-fab-icon">+</span>
            <span className="prepare-fields-fab-label">Add Field</span>
          </button>

            <button
              type="button"
              className="prepare-right-fab"
              onClick={() => setRightPanelPopupOpen(true)}
              aria-label="Open Pages panel"
              title="Pages"
              style={{ display: rightPanelPopupOpen ? "none" : undefined }}
            >
            <span className="prepare-right-fab-icon"><i className="lni lni-file-multiple" aria-hidden /></span>
            <span className="prepare-right-fab-label">Pages</span>
          </button>

          <aside className="prepare-left prepare-left-desktop">
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
              <span className="prepare-search-icon"><i className="lni lni-search-1" aria-hidden /></span>
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
                  <i className="lni lni-xmark" aria-hidden />
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

          {fieldsPopupOpen && (
            <div
              className="prepare-fields-popup-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="prepare-fields-popup-title"
              onClick={() => setFieldsPopupOpen(false)}
            >
              <div
                className="prepare-fields-popup"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="prepare-fields-popup-header">
                  <h2 id="prepare-fields-popup-title" className="prepare-fields-popup-title">Add Field</h2>
                  <button
                    type="button"
                    className="prepare-fields-popup-close"
                    onClick={() => setFieldsPopupOpen(false)}
                    aria-label="Close"
                  >
                    <i className="lni lni-xmark" aria-hidden />
                  </button>
                </div>
                <div className="prepare-fields-popup-body">
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
                        {signers.map((sr) => (
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
                    <span className="prepare-search-icon"><i className="lni lni-search-1" aria-hidden /></span>
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
                        <i className="lni lni-xmark" aria-hidden />
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
                                title={pendingFieldType === item ? "Click on document to place field" : "Click to select"}
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
                </div>
              </div>
            </div>
          )}

          <main className="prepare-center">
            <div ref={docCanvasRef} className="prepare-doc-canvas">
              <div
                className="prepare-pdf-zoom-wrap"
                onPointerDown={(e) => {
                  if (!e.target.closest(".prepare-placed-field") && !pendingFieldType) {
                    setSelectedFieldId(null);
                  }
                }}
              >
                <div
                  className="prepare-pdf-inner"
                >
                  <div className="prepare-pdf-wrap">
                    {fileUrl ? (
                      <PdfMainView
                        fileUrl={fileUrl}
                        fixedPageWidth={Math.round(800 * scale)}
                        pageRotations={pageRotations}
                        currentPage={currentPage}
                        onPageCount={setPdfPageCount}
                        renderPageOverlay={(pageNum) => {
                          const pageFields = placedFields.filter((f) => (f.page ?? 1) === pageNum);
                          const showGhost = pendingFieldType && cursorOverlayPos?.page === pageNum;
                          return (
                            <>
                              {showGhost && (
                                <div
                                  className="prepare-field-ghost"
                                  style={{
                                    position: "absolute",
                                    left: `${Math.max(0, cursorOverlayPos.xPct - pendingWPct / 2)}%`,
                                    top: `${Math.max(0, cursorOverlayPos.yPct - pendingHPct / 2)}%`,
                                    width: `${pendingWPct}%`,
                                    height: `${pendingHPct}%`,
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
                              {pageFields.map((f) => {
                                const color = getRecipientColor(f.signRequestId, signers);
                                const isSignatureType = f.type === "Signature" || f.type === "Initial";
                                const isNoteField = f.type === "Note";
                                const isCheckboxField = f.type === "Checkbox";
                                const isDataInputField = ["Name", "Email", "Company", "Title", "Text", "Number"].includes(f.type);
                                const isSelected = selectedFieldId === f.id;
                                const showHandles = isSelected;
                                const xPct = f.xPct != null ? f.xPct : 8;
                                const yPct = f.yPct != null ? f.yPct : 10;
                                const wPct = f.wPct != null ? f.wPct : 14;
                                const hPct = f.hPct != null ? f.hPct : 6;
                                const dynamicFontSize = `${Math.max(0.5, Math.min(1.2, hPct * 0.15))}rem`;
                                return (
                                  <div
                                    key={f.id}
                                    ref={f.page === 1 ? overlayRef : undefined}
                                    role="button"
                                    tabIndex={0}
                                    className={`prepare-placed-field ${isSignatureType ? "prepare-placed-field-sign" : ""} ${isNoteField ? "prepare-placed-field-note" : ""} ${isCheckboxField ? "prepare-placed-field-checkbox" : ""} ${f.type === "Radio" ? "prepare-placed-field-radio" : ""} ${["Text", "Number", "Dropdown", "Name", "Email", "Company", "Title"].includes(f.type) ? "prepare-placed-field-data-rect" : ""} ${isSelected ? "selected" : ""} ${draggingFieldId === f.id ? "dragging" : ""} ${resizingFieldId === f.id ? "resizing" : ""}`}
                                    style={{
                                      position: "absolute",
                                      left: `${xPct}%`,
                                      top: `${yPct}%`,
                                      width: `${wPct}%`,
                                      height: `${hPct}%`,
                                      borderColor: color.border,
                                      backgroundColor: color.bg,
                                    }}
                                    title={isDataInputField ? (f.type === "Date Signed" ? "Click to select date" : "Double-click to enter default value") : undefined}
                                    onPointerDown={(e) => handleFieldPointerDown(e, f)}
                                    onClick={(e) => {
                                      if (f.type === "Date Signed" && editingFieldId !== f.id) {
                                        e.stopPropagation();
                                        setEditingFieldId(f.id);
                                        setSelectedFieldId(f.id);
                                      }
                                    }}
                                    onDoubleClick={(e) => {
                                      if (["Name", "Email", "Company", "Title", "Text", "Number"].includes(f.type)) {
                                        e.stopPropagation();
                                        setEditingFieldId(f.id);
                                        setSelectedFieldId(f.id);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setSelectedFieldId(f.id);
                                      }
                                    }}
                                  >
                                    <span className="prepare-placed-field-icon" aria-hidden>{FIELD_ICONS[f.type] || "•"}</span>
                                    {isNoteField ? (
                                      <div className={`prepare-placed-field-note-content ${!(f.noteContent ?? "").trim() ? "is-placeholder" : ""}`}>
                                        {(f.noteContent ?? "").trim() || "Note for recipient"}
                                      </div>
                                    ) : isCheckboxField ? (
                                      <span className="prepare-placed-field-label">
                                        {(f.caption ?? "").trim() || "Checkbox"}
                                      </span>
                                    ) : f.type === "Date Signed" && editingFieldId === f.id ? (
                                      <DatePicker
                                        value={f.defaultValue ?? ""}
                                        onChange={(newDate) => updateField(f.id, { defaultValue: newDate })}
                                        onClose={() => setEditingFieldId(null)}
                                        autoFocus={true}
                                        fontSize={dynamicFontSize}
                                      />
                                    ) : ["Name", "Email", "Company", "Title", "Text", "Number"].includes(f.type) && editingFieldId === f.id ? (
                                      <input
                                        type="text"
                                        className="prepare-placed-field-inline-input"
                                        style={{ fontSize: dynamicFontSize }}
                                        value={f.defaultValue ?? ""}
                                        onChange={(e) => updateField(f.id, { defaultValue: e.target.value })}
                                        onBlur={() => setEditingFieldId(null)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === "Escape") {
                                            e.preventDefault();
                                            setEditingFieldId(null);
                                          }
                                          e.stopPropagation();
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        placeholder={f.type === "Name" ? (f.nameFormat ?? "Full Name") : f.type}
                                        autoFocus
                                      />
                                    ) : f.type === "Name" ? (
                                      <span className="prepare-placed-field-label" style={{ fontSize: dynamicFontSize }}>
                                        {(f.defaultValue ?? "").trim() || (f.nameFormat ?? "Full Name")}
                                      </span>
                                    ) : ["Email", "Company", "Title", "Text", "Number"].includes(f.type) ? (
                                      <span className="prepare-placed-field-label" style={{ fontSize: dynamicFontSize }}>
                                        {(f.defaultValue ?? "").trim() || f.type}
                                      </span>
                                    ) : f.type === "Date Signed" ? (
                                      <span className="prepare-placed-field-label" style={{ whiteSpace: "normal", fontSize: dynamicFontSize }}>
                                        {(f.defaultValue ?? "").trim() || "DD/MM/YYYY"}
                                      </span>
                                    ) : (
                                      <span className="prepare-placed-field-label">
                                        {f.type === "Signature" ? "Sign" : f.type}
                                      </span>
                                    )}
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
                              {pendingFieldType && (
                                <div
                                  className="prepare-fields-dropzone"
                                  style={{ position: "absolute", inset: 0, cursor: "crosshair", zIndex: 100 }}
                                  onPointerDown={handleDocumentPlaceClick}
                                  aria-label="Click to place field"
                                />
                              )}
                            </>
                          );
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </main>

          {rightPanelPopupOpen &&
            createPortal(
              <div className="prepare-right-popup-portal">
                <div
                  className="prepare-right-popup-backdrop"
                  role="button"
                  tabIndex={0}
                  onClick={() => setRightPanelPopupOpen(false)}
                  onKeyDown={(e) => e.key === "Enter" && setRightPanelPopupOpen(false)}
                  aria-label="Close"
                  aria-hidden
                />
                <aside className="prepare-right prepare-right-popup-panel">
                  <div className="prepare-right-popup-header">
                    <h2 className="prepare-right-popup-title">
                      {selectedField ? selectedField.type : "Pages"}
                    </h2>
                    <button
                      type="button"
                      className="prepare-right-popup-close"
                      onClick={() => setRightPanelPopupOpen(false)}
                      aria-label="Close panel"
                      title="Close"
                    >
                      Close
                    </button>
                  </div>
                  <div className="prepare-right-popup-body">
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
                  <>
                    <div className="prepare-property-row prepare-property-recipient">
                      <span className="prepare-property-label">Name format</span>
                      <select
                        value={selectedField.nameFormat ?? "Full Name"}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateField(selectedField.id, { nameFormat: val, dataLabel: val });
                        }}
                        aria-label="Name format"
                        className="prepare-property-select"
                      >
                        <option value="Full Name">Full Name</option>
                        <option value="First Name">First Name</option>
                        <option value="Last Name">Last Name</option>
                      </select>
                    </div>
                    <label className="prepare-property-row">
                      <span>Default Value</span>
                      <input
                        type="text"
                        value={selectedField.defaultValue ?? ""}
                        onChange={(e) => updateField(selectedField.id, { defaultValue: e.target.value })}
                        placeholder="Pre-fill with value"
                      />
                    </label>
                  </>
                )}
                {["Email", "Company", "Title"].includes(selectedField.type) && (
                  <label className="prepare-property-row">
                    <span>Default Value</span>
                    <input
                      type="text"
                      value={selectedField.defaultValue ?? ""}
                      onChange={(e) => updateField(selectedField.id, { defaultValue: e.target.value })}
                      placeholder="Pre-fill with value"
                    />
                  </label>
                )}
                <label className="prepare-property-row prepare-property-check">
                  <input
                    type="checkbox"
                    checked={selectedField.required}
                    onChange={(e) => updateField(selectedField.id, { required: e.target.checked })}
                  />
                  <span>Required Field</span>
                </label>
                {["Company", "Title", "Text", "Number"].includes(selectedField.type) && (
                  <label className="prepare-property-row prepare-property-check">
                    <input
                      type="checkbox"
                      checked={selectedField.readOnly}
                      onChange={(e) => updateField(selectedField.id, { readOnly: e.target.checked })}
                    />
                    <span>Read Only</span>
                  </label>
                )}
                {selectedField.type === "Checkbox" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Checkbox ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <label className="prepare-property-row">
                        <span>Caption</span>
                        <input
                          type="text"
                          value={selectedField.caption ?? ""}
                          onChange={(e) => updateField(selectedField.id, { caption: e.target.value })}
                          placeholder="Label next to checkbox"
                        />
                      </label>
                      <label className="prepare-property-row prepare-property-check">
                        <input
                          type="checkbox"
                          checked={selectedField.checked}
                          onChange={(e) => updateField(selectedField.id, { checked: e.target.checked })}
                        />
                        <span>Default checked</span>
                      </label>
                    </div>
                  </div>
                )}
                {selectedField.type === "Number" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Number ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <label className="prepare-property-row">
                        <span>Default Value</span>
                        <input
                          type="text"
                          value={selectedField.defaultValue ?? ""}
                          onChange={(e) => updateField(selectedField.id, { defaultValue: e.target.value })}
                          placeholder="Pre-fill with value"
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Min value</span>
                        <input
                          type="number"
                          value={selectedField.minValue ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? undefined : Number(e.target.value);
                            updateField(selectedField.id, { minValue: Number.isFinite(v) ? v : undefined });
                          }}
                          placeholder="—"
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Max value</span>
                        <input
                          type="number"
                          value={selectedField.maxValue ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? undefined : Number(e.target.value);
                            updateField(selectedField.id, { maxValue: Number.isFinite(v) ? v : undefined });
                          }}
                          placeholder="—"
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Decimal places</span>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={selectedField.decimalPlaces ?? 0}
                          onChange={(e) => updateField(selectedField.id, { decimalPlaces: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Placeholder</span>
                        <input
                          type="text"
                          value={selectedField.placeholder ?? ""}
                          onChange={(e) => updateField(selectedField.id, { placeholder: e.target.value })}
                          placeholder="e.g. 0"
                        />
                      </label>
                    </div>
                  </div>
                )}
                {selectedField.type === "Note" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Note ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <p className="prepare-property-hint">Message for the recipient. This text is not written on the document.</p>
                      <label className="prepare-property-row">
                        <textarea
                          value={selectedField.noteContent ?? ""}
                          onChange={(e) => updateField(selectedField.id, { noteContent: e.target.value })}
                          placeholder="Note for recipient"
                          rows={4}
                        />
                      </label>
                    </div>
                  </div>
                )}
                {selectedField.type === "Text" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Text Field ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <label className="prepare-property-row">
                        <span>Default Value</span>
                        <input
                          type="text"
                          value={selectedField.defaultValue ?? ""}
                          onChange={(e) => updateField(selectedField.id, { defaultValue: e.target.value })}
                          placeholder="Pre-fill with value"
                        />
                      </label>
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
                      {selectedField.type === "Radio" && (
                        <label className="prepare-property-row">
                          <span>Group name</span>
                          <input
                            type="text"
                            value={selectedField.groupName ?? ""}
                            onChange={(e) => updateField(selectedField.id, { groupName: e.target.value })}
                            placeholder="Link radio buttons"
                          />
                        </label>
                      )}
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
                            <i className="lni lni-xmark" aria-hidden />
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
                    {["Name", "Email", "Company", "Title", "Text", "Number"].includes(selectedField.type) ? (
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
                    <>
                      <label className="prepare-property-row">
                        <span>% from Left</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={Number(selectedField.xPct ?? 8).toFixed(1)}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            updateField(selectedField.id, { xPct: Math.max(0, Math.min(100, v)) });
                          }}
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>% from Top</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={Number(selectedField.yPct ?? 10).toFixed(1)}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            updateField(selectedField.id, { yPct: Math.max(0, Math.min(100, v)) });
                          }}
                        />
                      </label>
                    </>
                  </div>
                </div>
                <div className="prepare-property-actions">
                 
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
                  </div>
                </aside>
              </div>,
              document.body
            )}

          <aside className="prepare-right prepare-right-desktop">
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
                  <>
                    <div className="prepare-property-row prepare-property-recipient">
                      <span className="prepare-property-label">Name format</span>
                      <select
                        value={selectedField.nameFormat ?? "Full Name"}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateField(selectedField.id, { nameFormat: val, dataLabel: val });
                        }}
                        aria-label="Name format"
                        className="prepare-property-select"
                      >
                        <option value="Full Name">Full Name</option>
                        <option value="First Name">First Name</option>
                        <option value="Last Name">Last Name</option>
                      </select>
                    </div>
                    <label className="prepare-property-row">
                      <span>Default Value</span>
                      <input
                        type="text"
                        value={selectedField.defaultValue ?? ""}
                        onChange={(e) => updateField(selectedField.id, { defaultValue: e.target.value })}
                        placeholder="Pre-fill with value"
                      />
                    </label>
                  </>
                )}
                {["Email", "Company", "Title"].includes(selectedField.type) && (
                  <label className="prepare-property-row">
                    <span>Default Value</span>
                    <input
                      type="text"
                      value={selectedField.defaultValue ?? ""}
                      onChange={(e) => updateField(selectedField.id, { defaultValue: e.target.value })}
                      placeholder="Pre-fill with value"
                    />
                  </label>
                )}
                <label className="prepare-property-row prepare-property-check">
                  <input
                    type="checkbox"
                    checked={selectedField.required}
                    onChange={(e) => updateField(selectedField.id, { required: e.target.checked })}
                  />
                  <span>Required Field</span>
                </label>
                {["Company", "Title", "Text", "Number"].includes(selectedField.type) && (
                  <label className="prepare-property-row prepare-property-check">
                    <input
                      type="checkbox"
                      checked={selectedField.readOnly}
                      onChange={(e) => updateField(selectedField.id, { readOnly: e.target.checked })}
                    />
                    <span>Read Only</span>
                  </label>
                )}
                {selectedField.type === "Checkbox" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Checkbox ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <label className="prepare-property-row">
                        <span>Caption</span>
                        <input
                          type="text"
                          value={selectedField.caption ?? ""}
                          onChange={(e) => updateField(selectedField.id, { caption: e.target.value })}
                          placeholder="Label next to checkbox"
                        />
                      </label>
                      <label className="prepare-property-row prepare-property-check">
                        <input
                          type="checkbox"
                          checked={selectedField.checked}
                          onChange={(e) => updateField(selectedField.id, { checked: e.target.checked })}
                        />
                        <span>Default checked</span>
                      </label>
                    </div>
                  </div>
                )}
                {selectedField.type === "Number" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Number ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <label className="prepare-property-row">
                        <span>Default Value</span>
                        <input
                          type="text"
                          value={selectedField.defaultValue ?? ""}
                          onChange={(e) => updateField(selectedField.id, { defaultValue: e.target.value })}
                          placeholder="Pre-fill with value"
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Min value</span>
                        <input
                          type="number"
                          value={selectedField.minValue ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? undefined : Number(e.target.value);
                            updateField(selectedField.id, { minValue: Number.isFinite(v) ? v : undefined });
                          }}
                          placeholder="—"
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Max value</span>
                        <input
                          type="number"
                          value={selectedField.maxValue ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? undefined : Number(e.target.value);
                            updateField(selectedField.id, { maxValue: Number.isFinite(v) ? v : undefined });
                          }}
                          placeholder="—"
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Decimal places</span>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={selectedField.decimalPlaces ?? 0}
                          onChange={(e) => updateField(selectedField.id, { decimalPlaces: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>Placeholder</span>
                        <input
                          type="text"
                          value={selectedField.placeholder ?? ""}
                          onChange={(e) => updateField(selectedField.id, { placeholder: e.target.value })}
                          placeholder="e.g. 0"
                        />
                      </label>
                    </div>
                  </div>
                )}
                {selectedField.type === "Note" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Note ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <p className="prepare-property-hint">Message for the recipient. This text is not written on the document.</p>
                      <label className="prepare-property-row">
                        <textarea
                          value={selectedField.noteContent ?? ""}
                          onChange={(e) => updateField(selectedField.id, { noteContent: e.target.value })}
                          placeholder="Note for recipient"
                          rows={4}
                        />
                      </label>
                    </div>
                  </div>
                )}
                {selectedField.type === "Text" && (
                  <div className="prepare-property-section prepare-property-section-expanded">
                    <button type="button" className="prepare-property-section-head">
                      Text Field ▾
                    </button>
                    <div className="prepare-property-section-body">
                      <label className="prepare-property-row">
                        <span>Default Value</span>
                        <input
                          type="text"
                          value={selectedField.defaultValue ?? ""}
                          onChange={(e) => updateField(selectedField.id, { defaultValue: e.target.value })}
                          placeholder="Pre-fill with value"
                        />
                      </label>
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
                      {selectedField.type === "Radio" && (
                        <label className="prepare-property-row">
                          <span>Group name</span>
                          <input
                            type="text"
                            value={selectedField.groupName ?? ""}
                            onChange={(e) => updateField(selectedField.id, { groupName: e.target.value })}
                            placeholder="Link radio buttons"
                          />
                        </label>
                      )}
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
                            <i className="lni lni-xmark" aria-hidden />
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
                    {["Name", "Email", "Company", "Title", "Text", "Number"].includes(selectedField.type) ? (
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
                    <>
                      <label className="prepare-property-row">
                        <span>% from Left</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={Number(selectedField.xPct ?? 8).toFixed(1)}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            updateField(selectedField.id, { xPct: Math.max(0, Math.min(100, v)) });
                          }}
                        />
                      </label>
                      <label className="prepare-property-row">
                        <span>% from Top</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={Number(selectedField.yPct ?? 10).toFixed(1)}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            updateField(selectedField.id, { yPct: Math.max(0, Math.min(100, v)) });
                          }}
                        />
                      </label>
                    </>
                  </div>
                </div>
                <div className="prepare-property-actions">
                 
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
          {doc?.isTemplate ? (
            <span className="prepare-footer-save-wrap">
              {signersWithoutPlace().length > 0 && (
                <span className="prepare-footer-save-hint" role="status">
                  Place at least one field for each recipient who needs to sign ({signersWithoutPlace().length} remaining)
                </span>
              )}
              <button
                type="button"
                className="prepare-btn primary"
                onClick={handleSaveEdits}
                disabled={savingFields || signersWithoutPlace().length > 0}
                title={
                  signersWithoutPlace().length > 0
                    ? `Place at least one field for each recipient who needs to sign (${signersWithoutPlace().length} remaining)`
                    : undefined
                }
              >
                {savingFields ? "Saving…" : "Save edits"}
              </button>
            </span>
          ) : isTemplateFlow ? (
            <button
              type="button"
              className="prepare-btn primary"
              onClick={openSaveAsTemplateModal}
              disabled={savingTemplate || !signers.length}
            >
              {savingTemplate ? "Saving…" : "Save template"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="prepare-btn secondary"
                onClick={openSaveAsTemplateModal}
                disabled={savingTemplate || !signers.length}
              >
                Save as template
              </button>
              <button
                type="button"
                className="prepare-btn primary"
                onClick={handleSendClick}
                disabled={sending || !signers.length}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </>
          )}
        </footer>
        </>
        )}

        {saveAsTemplateModalOpen && (
          <div className="prepare-send-warning-backdrop" role="dialog" aria-modal="true" aria-labelledby="save-template-modal-title" onClick={closeSaveAsTemplateModal}>
            <div className="prepare-send-warning-modal" onClick={(e) => e.stopPropagation()}>
              <h2 id="save-template-modal-title" className="prepare-send-warning-title">Save as template</h2>
              <p className="prepare-send-warning-text">
                Enter a name for this template. The document will be saved as a reusable template.
              </p>
              <label className="adopt-modal-field" style={{ display: "block", marginBottom: "1rem" }}>
                <span>Template label</span>
                <input
                  type="text"
                  value={templateLabel}
                  onChange={(e) => setTemplateLabel(e.target.value)}
                  placeholder="e.g. Employment Agreement"
                  autoFocus
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </label>
              {saveTemplateError && <p className="adopt-error">{saveTemplateError}</p>}
              <div className="prepare-send-warning-actions" style={{ marginTop: "1rem" }}>
                <button type="button" className="prepare-btn secondary" onClick={closeSaveAsTemplateModal} disabled={savingTemplate}>
                  Back
                </button>
                <button
                  type="button"
                  className="prepare-btn primary"
                  onClick={handleSaveAsTemplate}
                  disabled={savingTemplate || !templateLabel.trim()}
                >
                  {savingTemplate ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
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
                <span className="prepare-sent-check" aria-hidden><i className="lni lni-check" aria-hidden /></span>
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

export default DocumentDetailPage;
