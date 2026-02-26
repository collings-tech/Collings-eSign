import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import PdfMainView from "../components/PdfMainView.jsx";
import AdoptSignatureModal from "../components/AdoptSignatureModal.jsx";
import collingsLogo from "../assets/collings-logo-1.png";

export default function SigningPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileUrlLoading, setFileUrlLoading] = useState(false);
  const [fileUrlError, setFileUrlError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fileUrlTimeoutRef = useRef(null);
  const [error, setError] = useState("");
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signFieldId, setSignFieldId] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [showSigningCompletedMessage, setShowSigningCompletedMessage] = useState(false);
  /** Signed file URL available immediately after complete (before fileUrl is set for viewer) */
  const [completedFileUrl, setCompletedFileUrl] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  /** Layout size of .signing-pdf-inner (unscaled) so we can size the scroll wrapper to scale × this and allow scrolling when zoomed */
  const [innerLayoutSize, setInnerLayoutSize] = useState({ width: 0, height: 0 });
  const [page1Rect, setPage1Rect] = useState(null);
  /** Per-page rects so fields on page 2+ are positioned correctly (same format as page1Rect: viewport-relative to inner) */
  const [pageRects, setPageRects] = useState([]);
  const [linkExpired, setLinkExpired] = useState(false);
  const [localFieldOverrides, setLocalFieldOverrides] = useState({});
  const [declineConfirmOpen, setDeclineConfirmOpen] = useState(false);
  const [voidAlertDismissed, setVoidAlertDismissed] = useState(false);
  const [approving, setApproving] = useState(false);
  const [declining, setDeclining] = useState(false);
  /** Local cache of field values so we don't refetch on every blur (avoids PDF reload/flicker when typing). */
  const [savedFieldValues, setSavedFieldValues] = useState({});
  /** Measured widths for text fields so they grow with content (keyed by field id). */
  const [textFieldWidths, setTextFieldWidths] = useState({});
  const textMeasureRefs = useRef({});
  const containerRef = useRef(null);
  const pdfInnerRef = useRef(null);

  const fetchInfo = useCallback(async () => {
    setLinkExpired(false);
    try {
      const res = await apiClient.get(`/signing/${token}`);
      setInfo(res.data);
      setError("");
    } catch (err) {
      console.error(err);
      const isExpired = err.response?.status === 410 || err.response?.data?.code === "LINK_EXPIRED";
      if (isExpired) {
        setLinkExpired(true);
        setError("");
      } else {
        setError(err.response?.data?.error || "Link not found");
      }
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  // Keep saved field values in sync with server when info loads or updates (e.g. after sign/complete).
  useEffect(() => {
    const fromServer = info?.signRequest?.fieldValues;
    if (fromServer && typeof fromServer === "object") setSavedFieldValues(fromServer);
  }, [info?.signRequest?.fieldValues]);

  const fetchFileUrl = useCallback(() => {
    setFileUrlError(null);
    setFileUrlLoading(true);
    const timeoutMs = 20000;
    const timeoutId = setTimeout(() => {
      setFileUrlLoading((prev) => {
        if (prev) setFileUrlError("Document is taking longer than usual. Check your connection and try again.");
        return false;
      });
    }, timeoutMs);
    fileUrlTimeoutRef.current = timeoutId;

    apiClient.get(`/signing/${token}/file-url`)
      .then((res) => {
        if (fileUrlTimeoutRef.current) {
          clearTimeout(fileUrlTimeoutRef.current);
          fileUrlTimeoutRef.current = null;
        }
        const url = res.data?.url;
        if (url) {
          setFileUrl(url);
          setFileUrlError(null);
        } else {
          setFileUrl(null);
          setFileUrlError("Document file could not be loaded.");
        }
        setFileUrlLoading(false);
      })
      .catch((err) => {
        if (fileUrlTimeoutRef.current) {
          clearTimeout(fileUrlTimeoutRef.current);
          fileUrlTimeoutRef.current = null;
        }
        setFileUrl(null);
        setFileUrlError(err.response?.data?.error || "Document could not be loaded. Try again.");
        setFileUrlLoading(false);
      });
  }, [token]);

  // Fetch view URL for PDF when info is available. Refetch when info changes (e.g. after complete → signed PDF).
  // Skip refetch when we already have a URL (avoids infinite loop: backend returns cache-busting URLs, so refetch would always produce new URL → effect rerun → refetch again).
  useEffect(() => {
    if (!info) {
      setFileUrl(null);
      setFileUrlError(null);
      setFileUrlLoading(false);
      if (fileUrlTimeoutRef.current) {
        clearTimeout(fileUrlTimeoutRef.current);
        fileUrlTimeoutRef.current = null;
      }
      return;
    }
    // When we already have a URL, don't refetch. We only need to fetch when we don't have one (initial load, or after complete cleared it).
    if (fileUrl) {
      return; // Keep existing PDF; handleComplete clears fileUrl before fetching signed PDF, so transition is covered
    }
    fetchFileUrl();
  }, [info, fetchFileUrl, fileUrl]);

  // ResizeObserver must run at top level (same hook order every render)
  const showDoc = !!info;
  useEffect(() => {
    if (!showDoc) return;
    const el = pdfInnerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? {};
      if (width > 0 && height > 0) setContentSize({ width, height });
      // Layout size (offsetWidth/offsetHeight) is unchanged by transform:scale, so scroll wrapper can use it * zoom
      const target = entries[0]?.target;
      if (target && typeof target.offsetWidth === "number" && typeof target.offsetHeight === "number") {
        setInnerLayoutSize({ width: target.offsetWidth, height: target.offsetHeight });
      }
    });
    ro.observe(el);
    const sync = () => {
      if (el.offsetWidth > 0 || el.offsetHeight > 0) {
        setInnerLayoutSize({ width: el.offsetWidth, height: el.offsetHeight });
      }
    };
    sync();
    return () => ro.disconnect();
  }, [showDoc]);

  // Measure all PDF page positions/sizes (same approach as DocumentDetailPage: data-rp="page-N" from PdfMainView)
  const measurePages = useCallback(() => {
    const inner = pdfInnerRef.current;
    if (!inner) return;
    const innerRect = inner.getBoundingClientRect();
    // PdfMainView (react-pdf) uses data-rp="page-N" - match DocumentDetailPage
    let pageEls = Array.from(inner.querySelectorAll('[data-rp^="page-"]'));
    if (pageEls.length === 0) {
      pageEls = Array.from(inner.querySelectorAll(".rpv-core__inner-page"));
      if (pageEls.length === 0 && inner.querySelector(".rpv-core__inner-pages")) {
        pageEls = Array.from(inner.querySelector(".rpv-core__inner-pages").children).filter((c) => c && c.offsetWidth > 0);
      }
    }
    if (pageEls.length === 0) {
      const single = inner.querySelector('[data-rp="page-1"]') ||
        inner.querySelector('[data-testid="page-1"]') ||
        inner.querySelector(".rpv-core__inner-page") ||
        inner.querySelector(".rpv-core__page-layer");
      if (single) {
        const pageRect = single.getBoundingClientRect();
        const left = pageRect.left - innerRect.left;
        const top = pageRect.top - innerRect.top;
        setPage1Rect({ left, top, width: pageRect.width, height: pageRect.height });
        setPageRects([{ left, top, width: pageRect.width, height: pageRect.height }]);
      }
      return;
    }
    const rects = pageEls.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - innerRect.left,
        top: r.top - innerRect.top,
        width: r.width,
        height: r.height,
      };
    });
    setPage1Rect(rects[0] ?? null);
    setPageRects(rects);
  }, []);

  // Re-measure when PDF viewer adds page elements (avoids "fields sometimes not showing" when PDF loads late)
  useEffect(() => {
    if (!showDoc || !fileUrl) return;
    const inner = pdfInnerRef.current;
    if (!inner) return;
    const checkAndMeasure = () => {
      const hasPages =
        inner.querySelector(".rpv-core__inner-page") ||
        inner.querySelector(".rpv-core__inner-pages") ||
        inner.querySelector('[data-rp^="page-"]') ||
        inner.querySelector(".rpv-core__page-layer");
      if (hasPages) measurePages();
    };
    const observer = new MutationObserver(() => {
      checkAndMeasure();
    });
    observer.observe(inner, { childList: true, subtree: true });
    checkAndMeasure();
    return () => observer.disconnect();
  }, [showDoc, fileUrl, measurePages]);

  useEffect(() => {
    if (!showDoc) return;
    measurePages();
    const t1 = setTimeout(measurePages, 300);
    const t2 = setTimeout(measurePages, 1000);
    const t3 = setTimeout(measurePages, 2500);
    const t4 = setTimeout(measurePages, 5000);
    const t5 = setTimeout(measurePages, 7500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [showDoc, fileUrl, contentSize.width, contentSize.height, zoom, measurePages]);

  // Scroll document canvas to top when PDF loads so first page is visible
  useEffect(() => {
    if (!fileUrl) return;
    const el = containerRef.current;
    const scrollToTop = () => {
      if (el) {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      }
    };
    scrollToTop();
    const t = setTimeout(scrollToTop, 400);
    const t2 = setTimeout(scrollToTop, 1000);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [fileUrl]);

  const handleAdoptAndSign = async ({ signatureData }) => {
    await apiClient.post(`/signing/${token}/sign`, {
      signatureData,
      ...(signFieldId ? { fieldId: signFieldId } : {}),
    });
    setSignModalOpen(false);
    setSignFieldId(null);
    await fetchInfo();
  };

  const openSignModal = (fieldId) => {
    setSignFieldId(fieldId);
    setSignModalOpen(true);
  };

  const saveFieldValue = useCallback(async (fieldId, value) => {
    const trimmed = value == null ? "" : String(value).trim();
    setSavedFieldValues((prev) => ({ ...prev, [fieldId]: trimmed }));
    try {
      await apiClient.patch(`/signing/${token}/field-value`, { fieldId, value: trimmed });
    } catch (err) {
      console.error("Failed to save field value", err);
      setSavedFieldValues((prev) => ({ ...prev, [fieldId]: info?.signRequest?.fieldValues?.[fieldId] ?? prev[fieldId] }));
    }
  }, [token, info?.signRequest?.fieldValues]);

  const handleApprove = async () => {
    setApproving(true);
    try {
      await apiClient.post(`/signing/${token}/approve`);
      await fetchInfo();
    } catch (err) {
      setCompleteError(err.response?.data?.error || "Could not record approval");
    } finally {
      setApproving(false);
    }
  };

  const handleDeclineConfirm = async () => {
    setDeclineConfirmOpen(false);
    setDeclining(true);
    setCompleteError("");
    try {
      await apiClient.post(`/signing/${token}/decline`);
      await fetchInfo();
      setFileUrl(null);
      const urlRes = await apiClient.get(`/signing/${token}/file-url`);
      if (urlRes.data?.url) setFileUrl(urlRes.data.url);
    } catch (err) {
      setCompleteError(err.response?.data?.error || "Could not decline");
    } finally {
      setDeclining(false);
    }
  };

  const handleComplete = async () => {
    setCompleteError("");
    setCompleting(true);
    try {
      // Flush all unsaved field values to server before Complete (user may have typed without blurring)
      const toFlush = { ...localFieldOverrides };
      for (const [fieldId, value] of Object.entries(toFlush)) {
        await apiClient.patch(`/signing/${token}/field-value`, { fieldId, value: value == null ? "" : String(value).trim() });
      }
      setLocalFieldOverrides({});
      setSavedFieldValues((prev) => ({ ...prev, ...toFlush }));
      await apiClient.post(`/signing/${token}/complete`);
      await fetchInfo();
      // Force viewer to unload current PDF, then load the signed one (avoids cache showing original)
      setFileUrl(null);
      const urlRes = await apiClient.get(`/signing/${token}/file-url`);
      const signedUrl = urlRes.data?.url;
      if (signedUrl) {
        setCompletedFileUrl(signedUrl);
        setTimeout(() => setFileUrl(signedUrl), 1000);
      }
      setShowSigningCompletedMessage(true);
    } catch (err) {
      setCompleteError(err.response?.data?.error || "Could not complete");
    } finally {
      setCompleting(false);
    }
  };

  const TEXT_FIELD_TYPES_FOR_MEASURE = ["name", "email", "company", "title", "text", "number", "stamp", "date"];
  useLayoutEffect(() => {
    if (!info?.signRequest?.signatureFields?.length) return;
    const fields = info.signRequest.signatureFields;
    const fieldValues = info.signRequest.fieldValues || {};
    const next = {};
    for (const f of fields) {
      const t = (f.type || "signature").toLowerCase();
      if (!TEXT_FIELD_TYPES_FOR_MEASURE.includes(t)) continue;
      let value = localFieldOverrides[f.id] ?? savedFieldValues[f.id] ?? fieldValues[f.id] ?? "";
      if (!value && t === "text" && (f.addText ?? "").trim()) value = String(f.addText).trim();
      const el = textMeasureRefs.current[f.id];
      if (el) {
        const measured = el.getBoundingClientRect().width;
        const blockWidth = f.width ?? 110;
        next[f.id] = Math.max(blockWidth, measured + 16);
      }
    }
    if (Object.keys(next).length > 0) {
      setTextFieldWidths((prev) => ({ ...prev, ...next }));
    }
  }, [info, pageRects, contentSize, zoom, localFieldOverrides, savedFieldValues]);

  if (loading) {
    return (
      <div className="signing-shell review-complete">
        <div className="signing-loading">Loading…</div>
      </div>
    );
  }
  if (linkExpired) {
    return (
      <div className="signing-shell review-complete signing-expired-page">
        <div className="signing-expired-card">
          <div className="signing-expired-icon" aria-hidden>⏱</div>
          <h1 className="signing-expired-title">This link has expired</h1>
          <p className="signing-expired-text">
            The signing link for this document is no longer valid. Links expire after 1 week for security.
          </p>
          <p className="signing-expired-text">
            If you still need to sign, please ask the sender to resend the document.
          </p>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="signing-shell review-complete">
        <p className="signing-error">{error || "Not found"}</p>
      </div>
    );
  }

  const { document: doc, signRequest } = info;
  const isVoided = doc.status === "voided";
  const isSigned = signRequest.status === "signed";
  // Normalize to array so fields always show (avoids "sometimes not" when API returns null/undefined or empty)
  const rawFields = Array.isArray(signRequest.signatureFields) ? signRequest.signatureFields : [];
  const fields = rawFields.length > 0
    ? rawFields
    : [{ id: "default", page: 1, x: 100, y: 400, width: 180, height: 36, type: "signature" }];
  const signatureData = signRequest.signatureData;
  const fieldSignatureData = signRequest.fieldSignatureData || {};
  const fieldValues = signRequest.fieldValues || {};
  const allFieldsAreInitial = fields.every((f) => (f.type || "signature").toLowerCase() === "initial");
  const TEXT_FIELD_TYPES = ["name", "email", "company", "title", "text", "number", "stamp", "date"];
  const sigFields = fields.filter((f) => {
    const t = (f.type || "signature").toLowerCase();
    return t === "signature" || t === "initial";
  });
  const getFieldKey = (f) => f.id != null && f.id !== "" ? f.id : `field-${f.page ?? 1}-${f.x ?? 0}-${f.y ?? 0}-${(f.type || "text")}`;
  /** Map formatting-tool color names to CSS color (matches DocumentDetailPage options). */
  const FONT_COLOR_MAP = {
    Black: "#000000",
    White: "#ffffff",
    Red: "#dc2626",
    Blue: "#2563eb",
    Green: "#16a34a",
    Gray: "#6b7280",
    "Dark Gray": "#374151",
  };
  /** Build inline style for text/data input fields from the field's formatting tool settings. */
  const getTextFieldFormatStyle = (f) => {
    const fontSize = Math.max(6, Math.min(24, Number(f.fontSize) || 14));
    const fontFamily = (f.fontFamily && f.fontFamily.trim()) ? f.fontFamily.trim() : "Lucida Console";
    const color = FONT_COLOR_MAP[f.fontColor] ?? (f.fontColor && /^#|[a-z]/.test(f.fontColor) ? f.fontColor : "#000000");
    return {
      fontSize: `${fontSize}px`,
      fontFamily: `${fontFamily}, monospace, sans-serif`,
      fontWeight: f.bold ? "bold" : "normal",
      fontStyle: f.italic ? "italic" : "normal",
      textDecoration: f.underline ? "underline" : "none",
      color,
    };
  };
  const hasApproveField = fields.some((f) => (f.type || "").toLowerCase() === "approve");
  const approvedAt = signRequest.approvedAt;
  const allSigFieldsSigned = sigFields.length === 0 || sigFields.every((f) => fieldSignatureData[f.id]) || (signatureData && Object.keys(fieldSignatureData).length === 0);
  const requiredDataFields = fields.filter((f) => {
    if (f.required === false) return false;
    const t = (f.type || "signature").toLowerCase();
    if (t === "note" || t === "approve" || t === "decline") return false;
    if (t === "checkbox") return false; // checkbox (checked or unchecked) never blocks Complete
    return t !== "signature" && t !== "initial";
  });
  const allRequiredDataFieldsFilled = requiredDataFields.length === 0 || requiredDataFields.every((f) => {
    const key = getFieldKey(f);
    const t = (f.type || "signature").toLowerCase();
    let value = (localFieldOverrides[key] ?? savedFieldValues[key] ?? fieldValues[f.id] ?? fieldValues[key] ?? "").toString().trim();
    if (!value && t === "text" && (f.addText ?? "").trim()) value = String(f.addText).trim();
    return value.length > 0; // radio must have a value (user chose 1)
  });
  const canComplete = (allSigFieldsSigned || (hasApproveField && approvedAt)) && allRequiredDataFieldsFilled;

  if (isVoided) {
    return (
      <div className="signing-shell review-complete">
        <header className="signing-review-header">
          <div className="signing-review-header-left">
            <span className="signing-review-brand">
              <img src={collingsLogo} alt="Collings" className="signing-review-logo" />
              <span className="signing-review-brand-esign">eSign</span>
            </span>
            <span className="signing-review-title">Document voided</span>
          </div>
          <div className="signing-review-header-right">
            <span className="signing-envelope-id">Envelope ID: {doc.id}</span>
            <span className="signing-complete-btn signing-signed-label" style={{ cursor: "default", pointerEvents: "none" }} tabIndex={-1}>
              Voided
            </span>
          </div>
        </header>
        <div className="signing-review-body">
          <main className="signing-review-main">
            <div className="signing-voided-banner" role="alert">
              This document has been voided and is no longer valid.
            </div>
            <div ref={containerRef} className="signing-doc-canvas signing-doc-canvas-prepare-style">
            <div className="prepare-pdf-zoom-wrap">
              <div
                ref={pdfInnerRef}
                className="prepare-pdf-inner"
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: "0 0",
                }}
              >
                <div className="prepare-pdf-wrap">
                  {fileUrl ? (
                    <PdfMainView fileUrl={fileUrl} />
                  ) : fileUrlLoading ? (
                    <div className="signing-loading" role="status" aria-live="polite">Loading PDF…</div>
                  ) : fileUrlError ? (
                    <div className="signing-pdf-error" style={{ padding: "2rem", textAlign: "center" }}>
                      <p className="signing-pdf-error-text">{fileUrlError}</p>
                      <button type="button" className="signing-pdf-error-retry" onClick={fetchFileUrl}>
                        Retry
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            </div>
            <div className="signing-zoom-fixed" aria-label="Zoom controls">
            <button
              type="button"
              className="signing-zoom-btn signing-zoom-in"
              onClick={() => setZoom((z) => Math.min(200, z + 25))}
              disabled={zoom >= 200}
              aria-label="Zoom in"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><path d="M11 8v6" /><path d="M8 11h6" /></svg>
            </button>
            <span className="signing-zoom-value" aria-live="polite">{zoom}%</span>
            <button
              type="button"
              className="signing-zoom-btn signing-zoom-out"
              onClick={() => setZoom((z) => Math.max(100, z - 25))}
              disabled={zoom <= 100}
              aria-label="Zoom out"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><path d="M8 11h6" /></svg>
            </button>
            </div>
          </main>
        </div>

        <footer className="signing-review-footer">
          <span className="signing-footer-brand">Powered by Collings eSign</span>
          <div className="signing-footer-center">
            <select className="signing-footer-lang" aria-label="Language" defaultValue="en">
              <option value="en">English (US)</option>
            </select>
            <a href="#terms">Terms of Use</a>
            <a href="#privacy">Privacy</a>
          </div>
          <span className="signing-footer-copy">© {new Date().getFullYear()} Collings eSign. All rights reserved.</span>
        </footer>

        {!voidAlertDismissed && (
          <div className="signing-completed-overlay" role="dialog" aria-modal="true" aria-labelledby="void-alert-title" onClick={() => setVoidAlertDismissed(true)}>
            <div className="signing-completed-message" onClick={(e) => e.stopPropagation()}>
              <h2 id="void-alert-title" className="signing-completed-title">Document is void</h2>
              <p className="signing-completed-text">
                The document is already void. Contact the sender for clarification.
              </p>
              <button type="button" className="signing-completed-dismiss" onClick={() => setVoidAlertDismissed(true)}>
                OK
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const scale = zoom / 100;
  const hasSize = contentSize.width > 0 && contentSize.height > 0;
  const wrapWidth = hasSize ? Math.round(contentSize.width * scale) : undefined;

  // Full document size from measured page rects (in rendered/scaled pixels) so scroll area includes all pages
  const totalDocHeight =
    pageRects.length > 0
      ? pageRects[pageRects.length - 1].top + pageRects[pageRects.length - 1].height
      : 0;
  const totalDocWidth =
    pageRects.length > 0
      ? Math.max(...pageRects.map((r) => r.left + r.width), 0)
      : 0;
  const usePageRectsForScroll = pageRects.length > 0 && totalDocHeight > 0 && totalDocWidth > 0;

  const scaleFactor = scale;
  const hasPageMeasure = pageRects.length > 0 || page1Rect != null;

  return (
    <div className="signing-shell review-complete">
      {completing && (
        <div className="signing-completing-overlay" role="status" aria-live="polite" aria-label="Completing">
          <div className="signing-completing-spinner" aria-hidden />
          <p className="signing-completing-text">Completing…</p>
        </div>
      )}
      <header className="signing-review-header">
        <div className="signing-review-header-left">
          <span className="signing-review-brand">
            <img src={collingsLogo} alt="Collings" className="signing-review-logo" />
            <span className="signing-review-brand-esign">eSign</span>
          </span>
          <span className="signing-review-title">Review and complete</span>
        </div>
        <div className="signing-review-header-right">
          <span className="signing-envelope-id">Envelope ID: {doc.id}</span>
          {isSigned ? (
            (fileUrl || completedFileUrl) ? (
              <a
                href={fileUrl || completedFileUrl}
                download={doc?.title ? (doc.title.endsWith(".pdf") ? doc.title : `${doc.title}.pdf`) : "document.pdf"}
                target="_blank"
                rel="noopener noreferrer"
                className="signing-complete-btn signing-download-btn"
              >
                Download
              </a>
            ) : (
              <span className="signing-complete-btn signing-signed-label" style={{ cursor: "default", pointerEvents: "none" }} tabIndex={-1}>Signed</span>
            )
          ) : (
            <button
              type="button"
              className="signing-complete-btn"
              onClick={handleComplete}
              disabled={completing || !canComplete}
              title={!canComplete ? (!allSigFieldsSigned ? "Sign all required signature fields first" : "Fill in all required fields first") : undefined}
            >
              {completing ? "…" : "Complete"}
            </button>
          )}
          {completeError && (
            <span className="signing-complete-error" role="alert">{completeError}</span>
          )}
        </div>
      </header>

      <div className="signing-review-body">
        <main className="signing-review-main">
          {/* Use same structure/CSS as DocumentDetailPage so coordinates match exactly */}
          <div ref={containerRef} className="signing-doc-canvas signing-doc-canvas-prepare-style">
            <div className="prepare-pdf-zoom-wrap">
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
                      key={isSigned ? `signed-${doc?.id}-${fileUrl}` : `draft-${fileUrl}`}
                      fileUrl={fileUrl}
                      renderPageOverlay={!isSigned ? (pageNum) => {
                        const pageFields = fields.filter((f) => (f.page ?? 1) === pageNum);
                        return pageFields.map((f) => {
                          const typeLower = (f.type || "signature").toLowerCase();
                          const isSig = typeLower === "signature" || typeLower === "initial";
                          const isTextField = TEXT_FIELD_TYPES.includes(typeLower);
                          /* Percent-based coords (recommended) - survives zoom, mobile, resizing */
                          const rw = doc?.page1RenderWidth ?? 612;
                          const rh = doc?.page1RenderHeight ?? 792;
                          const xPct = f.xPct != null ? f.xPct : ((Number(f.x ?? f.pageX ?? 0) / rw) * 100);
                          const yPct = f.yPct != null ? f.yPct : ((Number(f.y ?? f.pageY ?? 0) / rh) * 100);
                          const wPct = f.wPct != null ? f.wPct : ((Number(f.width ?? 110) / rw) * 100);
                          const hPct = f.hPct != null ? f.hPct : ((Number(f.height ?? 55) / rh) * 100);

                      if (typeLower === "note") {
                        const noteText = (f.noteContent ?? "").trim();
                        if (!noteText) return null;
                        return (
                          <div
                            key={f.id || `${f.page}-${f.x}-${f.y}`}
                            className="signing-field-block signing-field-note-block"
                            style={{
                              position: "absolute",
                              left: `${xPct}%`,
                              top: `${yPct}%`,
                              width: `${wPct}%`,
                              height: `${hPct}%`,
                            }}
                          >
                            <div className="signing-field-note-content">{noteText}</div>
                          </div>
                        );
                      }
                      if (typeLower === "approve") {
                        return (
                          <div
                            key={f.id || `${f.page}-${f.x}-${f.y}`}
                            className="signing-field-block signing-field-approve-block"
                            style={{
                              position: "absolute",
                              left: `${xPct}%`,
                              top: `${yPct}%`,
                              width: `${wPct}%`,
                              height: `${hPct}%`,
                            }}
                          >
                            <button
                              type="button"
                              className="signing-field-approve-btn"
                              onClick={handleApprove}
                              disabled={approving || !!approvedAt}
                              aria-label="Approve"
                            >
                              {approvedAt ? "Approved" : (approving ? "…" : "Approve")}
                            </button>
                          </div>
                        );
                      }
                      if (typeLower === "decline") {
                        return (
                          <div
                            key={f.id || `${f.page}-${f.x}-${f.y}`}
                            className="signing-field-block signing-field-decline-block"
                            style={{
                              position: "absolute",
                              left: `${xPct}%`,
                              top: `${yPct}%`,
                              width: `${wPct}%`,
                              height: `${hPct}%`,
                            }}
                          >
                            <button
                              type="button"
                              className="signing-field-decline-btn"
                              onClick={() => setDeclineConfirmOpen(true)}
                              disabled={declining}
                              aria-label="Decline"
                            >
                              {declining ? "…" : "Decline"}
                            </button>
                          </div>
                        );
                      }

                      if (isTextField) {
                        const fieldKey = getFieldKey(f);
                        const isReadOnly = f.readOnly === true;
                        const rawValue = localFieldOverrides[fieldKey] ?? savedFieldValues[fieldKey] ?? fieldValues[f.id] ?? fieldValues[fieldKey];
                        const value = rawValue ?? (typeLower === "text" && (f.addText ?? "").trim() ? f.addText.trim() : "");
                        const label = typeLower === "date" ? "Date signed" : typeLower === "name" ? (f.nameFormat ?? "Full Name") : typeLower.charAt(0).toUpperCase() + typeLower.slice(1);
                        const effectiveW = (textFieldWidths[f.id] && rw > 0) ? `${Math.max(wPct, (textFieldWidths[f.id] / rw) * 100)}%` : `${wPct}%`;
                        const textFormatStyle = getTextFieldFormatStyle(f);
                        return (
                          <div
                            key={f.id || `${f.page}-${f.x}-${f.y}`}
                            className={`signing-field-block signing-field-text-block ${isReadOnly ? "signing-field-readonly" : ""}`}
                            style={{
                              position: "absolute",
                              left: `${xPct}%`,
                              top: `${yPct}%`,
                              width: effectiveW,
                              height: `${hPct}%`,
                            }}
                          >
                            <span
                              ref={(el) => { textMeasureRefs.current[f.id] = el; }}
                              className="signing-field-text-measure"
                              style={textFormatStyle}
                              aria-hidden
                            >
                              {typeof value === "string" ? value : String(value ?? "")}
                            </span>
                            <input
                              type={typeLower === "email" ? "email" : typeLower === "date" ? "date" : "text"}
                              inputMode={typeLower === "number" ? "numeric" : "text"}
                              className="signing-field-text-input"
                              style={textFormatStyle}
                              value={value}
                              readOnly={isReadOnly}
                              disabled={isReadOnly}
                              onChange={isReadOnly ? undefined : (e) => setLocalFieldOverrides((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                              onBlur={isReadOnly ? undefined : (e) => saveFieldValue(fieldKey, e.target.value)}
                              placeholder={label}
                              aria-label={label}
                              aria-readonly={isReadOnly}
                            />
                          </div>
                        );
                      }

                      if (typeLower === "checkbox") {
                        const fieldKey = getFieldKey(f);
                        const rawValue = localFieldOverrides[fieldKey] ?? savedFieldValues[fieldKey] ?? fieldValues[f.id] ?? fieldValues[fieldKey];
                        const defaultVal = f.checked === true ? "Yes" : "";
                        const valueStr = (rawValue ?? defaultVal).toString().trim();
                        const isChecked = valueStr === "Yes" || valueStr === "true";
                        const caption = (f.caption ?? "").trim() || "Checkbox";
                        return (
                          <div
                            key={f.id || `${f.page}-${f.x}-${f.y}`}
                            className="signing-field-block signing-field-checkbox-block"
                            style={{
                              position: "absolute",
                              left: `${xPct}%`,
                              top: `${yPct}%`,
                              width: `${wPct}%`,
                              height: `${hPct}%`,
                            }}
                          >
                            <label className="signing-field-checkbox-label">
                              <input
                                type="checkbox"
                                className="signing-field-checkbox-input"
                                checked={isChecked}
                                onChange={(e) => {
                                  const v = e.target.checked ? "Yes" : "";
                                  setLocalFieldOverrides((prev) => ({ ...prev, [fieldKey]: v }));
                                  saveFieldValue(fieldKey, v);
                                }}
                                aria-label={caption}
                              />
                              <span className="signing-field-checkbox-caption">{caption}</span>
                            </label>
                          </div>
                        );
                      }
                      if (typeLower === "radio") {
                        const opts = Array.isArray(f.options) ? f.options : [];
                        const optionLabels = opts.map((o) => (o.label ?? o.value ?? "").trim()).filter(Boolean);
                        const defaultVal = (f.defaultOption != null && f.defaultOption !== "" && optionLabels.includes(f.defaultOption))
                          ? f.defaultOption
                          : "";
                        const fieldKey = getFieldKey(f);
                        const groupName = (f.groupName ?? f.id ?? fieldKey).toString().trim() || fieldKey;
                        const value = localFieldOverrides[fieldKey] ?? savedFieldValues[fieldKey] ?? fieldValues[f.id] ?? fieldValues[fieldKey] ?? defaultVal;
                        const valueStr = (typeof value === "string" ? value : String(value ?? "")).trim();
                        const selectedVal = valueStr && optionLabels.includes(valueStr) ? valueStr : "";
                        return (
                          <div
                            key={f.id || `${f.page}-${f.x}-${f.y}`}
                            className="signing-field-block signing-field-radio-block"
                            style={{
                              position: "absolute",
                              left: `${xPct}%`,
                              top: `${yPct}%`,
                              width: `${wPct}%`,
                              height: `${hPct}%`,
                            }}
                          >
                            <div className="signing-field-radio-group" role="radiogroup" aria-label={f.dataLabel || "Radio"}>
                              {opts.map((o, idx) => {
                                const displayText = (o.label ?? o.value ?? "").trim() || "";
                                if (!displayText) return null;
                                const isSelected = selectedVal === displayText;
                                return (
                                  <label key={idx} className="signing-field-radio-option">
                                    <input
                                      type="radio"
                                      name={groupName}
                                      checked={isSelected}
                                      onChange={() => {
                                        setLocalFieldOverrides((prev) => ({ ...prev, [fieldKey]: displayText }));
                                        saveFieldValue(fieldKey, displayText);
                                      }}
                                      aria-label={displayText}
                                    />
                                    <span>{displayText}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }
                      if (typeLower === "dropdown") {
                        const opts = Array.isArray(f.options) ? f.options : [];
                        const optionLabels = opts.map((o) => (o.label ?? o.value ?? "").trim()).filter(Boolean);
                        const defaultVal = (f.defaultOption != null && f.defaultOption !== "" && optionLabels.includes(f.defaultOption))
                          ? f.defaultOption
                          : "";
                        const fieldKey = getFieldKey(f);
                        const value = localFieldOverrides[fieldKey] ?? savedFieldValues[fieldKey] ?? fieldValues[f.id] ?? fieldValues[fieldKey] ?? defaultVal;
                        const valueStr = (typeof value === "string" ? value : String(value ?? "")).trim();
                        const valueToShow = valueStr && optionLabels.includes(valueStr) ? valueStr : "";
                        return (
                          <div
                            key={f.id || `${f.page}-${f.x}-${f.y}`}
                            className="signing-field-block signing-field-dropdown-block"
                            style={{
                              position: "absolute",
                              left: `${xPct}%`,
                              top: `${yPct}%`,
                              width: `${wPct}%`,
                              height: `${hPct}%`,
                            }}
                          >
                            <select
                              className="signing-field-dropdown-select"
                              value={valueToShow}
                              onChange={(e) => {
                                const v = e.target.value;
                                setLocalFieldOverrides((prev) => ({ ...prev, [fieldKey]: v }));
                                saveFieldValue(fieldKey, v);
                              }}
                              aria-label={f.dataLabel || "Dropdown"}
                            >
                              <option value="">-- select --</option>
                              {opts.map((o, idx) => {
                                const displayText = (o.label ?? o.value ?? "").trim() || "";
                                return (
                                  <option key={idx} value={displayText}>
                                    {displayText}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        );
                      }

                      if (!isSig) return null;
                      const isInitialField = typeLower === "initial";
                      const hasSigned = !!(fieldSignatureData[f.id] ?? (signatureData && Object.keys(fieldSignatureData).length === 0 ? signatureData : null));
                      const fieldSignature = fieldSignatureData[f.id] || (Object.keys(fieldSignatureData).length === 0 ? signatureData : null);
                      return (
                        <div
                          key={f.id || `${f.page}-${f.x}-${f.y}`}
                          className={`signing-field-block ${hasSigned ? "signed" : "unsigned"}`}
                          style={{
                            position: "absolute",
                            left: `${xPct}%`,
                            top: `${yPct}%`,
                            width: `${wPct}%`,
                            height: `${hPct}%`,
                          }}
                        >
                          {hasSigned ? (
                            <button
                              type="button"
                              className="signing-field-signed-wrap"
                              onClick={() => openSignModal(f.id)}
                              aria-label={isInitialField ? "Change initials" : "Change signature"}
                            >
                              {!isInitialField && <span className="signing-field-signed-by">Signed by:</span>}
                              <div className="signing-field-signature-inner">
                                <SigningFieldSignature
                                  signatureData={fieldSignature}
                                  signerName={signRequest.signerName}
                                  initials={getInitials(signRequest.signerName)}
                                  initialsOnly={isInitialField}
                                />
                              </div>
                              <span className="signing-field-signed-id">
                                {signRequest.id ? String(signRequest.id).slice(-12) : "••••••••"}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="signing-field-btn"
                              onClick={() => openSignModal(f.id)}
                              aria-label={isInitialField ? "Click to add initials" : "Click to sign"}
                            >
                              <span className="signing-field-label">{isInitialField ? "Initial" : "Sign"}</span>
                              <span className="signing-field-icon" aria-hidden><i className="lni lni-pen-to-square" aria-hidden /></span>
                            </button>
                          )}
                        </div>
                      );
                        });
                      } : undefined}
                    />
                  ) : fileUrlError ? null : (
                    <div className="signing-loading" role="status" aria-live="polite">Loading PDF…</div>
                  )}
                </div>
                {fileUrlError && (
                  <div className="signing-pdf-error" style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)" }}>
                    <p className="signing-pdf-error-text">{fileUrlError}</p>
                    <button type="button" className="signing-pdf-error-retry" onClick={fetchFileUrl}>
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        <aside className="signing-review-sidebar">
          {/* <button type="button" className="signing-sidebar-item summarize">
            <span className="signing-sidebar-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            </span>
            Summarize
          </button>
          <button type="button" className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            </span>
            Search
          </button>
          <button type="button" className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            </span>
            View Pages
          </button>
          <button type="button" className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
            </span>
            Comment
          </button>
          {(isSigned && (fileUrl || completedFileUrl)) ? (
            <a href={fileUrl || completedFileUrl} download={doc?.title ? (doc.title.endsWith(".pdf") ? doc.title : `${doc.title}.pdf`) : "document.pdf"} target="_blank" rel="noopener noreferrer" className="signing-sidebar-item">
              <span className="signing-sidebar-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              </span>
              Download
            </a>
          ) : isSigned ? (
            <span className="signing-sidebar-item">
              <span className="signing-sidebar-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              </span>
              Signed
            </span>
          ) : (
            <>
              {fileUrl ? (
                <a href={fileUrl} download={doc?.title ? (doc.title.endsWith(".pdf") ? doc.title : `${doc.title}.pdf`) : "document.pdf"} target="_blank" rel="noopener noreferrer" className="signing-sidebar-item">
                  <span className="signing-sidebar-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                  </span>
                  Download
                </a>
              ) : (
                <span className="signing-sidebar-item">
                  <span className="signing-sidebar-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                  </span>
                  Download
                </span>
              )}
            </>
          )}
          <button type="button" className="signing-sidebar-item" onClick={() => window.print()}>
            <span className="signing-sidebar-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
            </span>
            Print
          </button>
          <button type="button" className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>
            </span>
            Counsel
          </button> */}
        </aside>

        <div className="signing-zoom-fixed" aria-label="Zoom controls">
          <button
            type="button"
            className="signing-zoom-btn signing-zoom-in"
            onClick={() => setZoom((z) => Math.min(200, z + 25))}
            disabled={zoom >= 200}
            aria-label="Zoom in"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
              <path d="M11 8v6" />
              <path d="M8 11h6" />
            </svg>
          </button>
          <span className="signing-zoom-value" aria-live="polite">{zoom}%</span>
          <button
            type="button"
            className="signing-zoom-btn signing-zoom-out"
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
      </div>

      <footer className="signing-review-footer">
        <span className="signing-footer-brand">Powered by Collings eSign</span>
        <div className="signing-footer-center">
          <select className="signing-footer-lang" aria-label="Language" defaultValue="en">
            <option value="en">English (US)</option>
          </select>
          <a href="#terms">Terms of Use</a>
          <a href="#privacy">Privacy</a>
        </div>
        <span className="signing-footer-copy">© {new Date().getFullYear()} Collings eSign. All rights reserved.</span>
      </footer>

      {showSigningCompletedMessage && doc && (
        <div className="signing-completed-overlay" role="dialog" aria-modal="true" aria-labelledby="signing-completed-title" onClick={() => setShowSigningCompletedMessage(false)}>
          <div className="signing-completed-message" onClick={(e) => e.stopPropagation()}>
            <h2 id="signing-completed-title" className="signing-completed-title">You've signed</h2>
            <p className="signing-completed-text">
              {doc.status === "completed"
                ? "The envelope is complete."
                : "You can download the document once the envelope is completed. We'll email you when all recipients have signed."}
            </p>
            {(fileUrl || completedFileUrl) ? (
              <a
                href={fileUrl || completedFileUrl}
                download={doc?.title ? (doc.title.endsWith(".pdf") ? doc.title : `${doc.title}.pdf`) : "document.pdf"}
                target="_blank"
                rel="noopener noreferrer"
                className="signing-completed-download"
                onClick={() => setShowSigningCompletedMessage(false)}
              >
                Download signed document
              </a>
            ) : null}
            <button type="button" className="signing-completed-dismiss" onClick={() => setShowSigningCompletedMessage(false)}>
              {(fileUrl || completedFileUrl) ? "Close" : "OK"}
            </button>
          </div>
        </div>
      )}

      {declineConfirmOpen && (
        <div className="signing-completed-overlay" role="dialog" aria-modal="true" aria-labelledby="signing-decline-title" onClick={() => setDeclineConfirmOpen(false)}>
          <div className="signing-completed-message signing-decline-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="signing-decline-title" className="signing-completed-title">Decline document?</h2>
            <p className="signing-completed-text">
              Are you sure you want to decline? After declining, the document will be voided and a VOID watermark will be applied. This action cannot be undone.
            </p>
            <div className="signing-decline-actions">
              <button type="button" className="signing-completed-dismiss" onClick={() => setDeclineConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" className="signing-field-decline-btn" onClick={handleDeclineConfirm} disabled={declining}>
                {declining ? "…" : "Yes, decline"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AdoptSignatureModal
        open={signModalOpen}
        onClose={() => { setSignModalOpen(false); setSignFieldId(null); }}
        signerName={signRequest.signerName}
        signerEmail={signRequest.signerEmail}
        initialSignatureData={signFieldId ? (fieldSignatureData[signFieldId] || signatureData) : signatureData}
        onAdoptAndSign={handleAdoptAndSign}
        initialsOnly={signFieldId ? (fields.find((f) => f.id === signFieldId)?.type || "signature").toLowerCase() === "initial" : allFieldsAreInitial}
      />
    </div>
  );
}

function getInitials(name) {
  if (!name || !name.trim()) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function SigningFieldSignature({ signatureData, signerName, initials, initialsOnly = false }) {
  const isImage = typeof signatureData === "string" && (signatureData.startsWith("data:image") || signatureData.startsWith("http"));
  const isTyped = typeof signatureData === "string" && signatureData.startsWith("typed::");
  const parts = isTyped ? signatureData.split("::") : [];
  const typedName = (parts[1] != null && parts[1] !== "") ? parts[1] : signerName;
  const font = parts[2] || "cursive";
  const typedInitials = (parts[3] != null && parts[3] !== "") ? parts[3] : initials;
  const displayName = typedName || signerName || "Signed";
  const displayInitials = typedInitials || initials || "—";
  const fontSize = Math.max(11, Math.min(24, Number(parts[4]) || 28));

  const showText = initialsOnly ? displayInitials : displayName;

  return (
    <div className="signing-field-signature">
      {isImage && !initialsOnly && (
        <img src={signatureData} alt="" className="signing-field-signature-img" />
      )}
      {isImage && initialsOnly && (
        <span className="signing-field-signature-text signing-field-initials-only" style={{ fontSize: `${fontSize}px` }}>
          {displayInitials}
        </span>
      )}
      {isTyped && (
        <span className="signing-field-signature-text" style={{ fontFamily: font, fontSize: `${fontSize}px` }}>
          {showText}
        </span>
      )}
      {!isImage && !isTyped && (
        <span className="signing-field-signature-text" style={{ fontSize: `${fontSize}px` }}>
          {showText}
        </span>
      )}
    </div>
  );
}

function CompletedSignaturePreview({ signatureData, signerName, initials }) {
  const isImage = typeof signatureData === "string" && (signatureData.startsWith("data:image") || signatureData.startsWith("http"));
  const isTyped = typeof signatureData === "string" && signatureData.startsWith("typed::");
  const parts = isTyped ? signatureData.split("::") : [];
  const typedName = (parts[1] != null && parts[1] !== "") ? parts[1] : signerName;
  const font = parts[2] || "cursive";
  const typedInitials = (parts[3] != null && parts[3] !== "") ? parts[3] : initials;
  const displayName = typedName || signerName || "Signed";
  const displayInitials = typedInitials || initials || "—";

  return (
    <div className="completed-signature-preview">
      <div className="completed-signature-block">
        <span className="completed-signature-label">Signed by:</span>
        <span className="completed-signature-value">
          {isImage && (
            <img src={signatureData} alt="Your signature" className="completed-signature-img" />
          )}
          {isTyped && (
            <span className="completed-signature-text" style={{ fontFamily: font }}>
              {displayName}
            </span>
          )}
          {!isImage && !isTyped && (
            <span className="completed-signature-text completed-signature-fallback">
              {displayName}
            </span>
          )}
        </span>
        <span className="completed-signature-id">••••••••</span>
      </div>
      <div className="completed-initials-block">
        <span className="completed-initials-label">Initials</span>
        {isImage && <img src={signatureData} alt="" className="completed-initials-img" />}
        {(isTyped || (!isImage && !isTyped)) && (
          <span className="completed-initials-text" style={isTyped ? { fontFamily: font } : {}}>
            {displayInitials}
          </span>
        )}
      </div>
    </div>
  );
}
