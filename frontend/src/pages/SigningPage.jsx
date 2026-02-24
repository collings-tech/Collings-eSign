import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import PdfViewer from "../components/PdfViewer.jsx";
import AdoptSignatureModal from "../components/AdoptSignatureModal.jsx";

export default function SigningPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signFieldId, setSignFieldId] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [showSigningCompletedMessage, setShowSigningCompletedMessage] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const [page1Rect, setPage1Rect] = useState(null);
  /** Per-page rects so fields on page 2+ are positioned correctly (same format as page1Rect: viewport-relative to inner) */
  const [pageRects, setPageRects] = useState([]);
  const [linkExpired, setLinkExpired] = useState(false);
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

  // Fetch view URL for PDF (signed URL from storage or /uploads path). Refetch when info changes (e.g. after complete → signed PDF).
  useEffect(() => {
    if (!info) {
      setFileUrl(null);
      return;
    }
    let cancelled = false;
    apiClient.get(`/signing/${token}/file-url`).then((res) => {
      if (!cancelled && res.data?.url) setFileUrl(res.data.url);
    }).catch(() => {
      if (!cancelled) setFileUrl(null);
    });
    return () => { cancelled = true; };
  }, [token, info]);

  // ResizeObserver must run at top level (same hook order every render)
  const showDoc = !!info;
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

  // Measure all PDF page positions/sizes so overlay matches prepare-view placement (including page 2+)
  const measurePages = useCallback(() => {
    const inner = pdfInnerRef.current;
    if (!inner) return;
    const innerRect = inner.getBoundingClientRect();
    // react-pdf-viewer: .rpv-core__inner-page per page; fallback: data-rp="page-N" (react-pdf) or single .rpv-core__page-layer
    let pageEls = Array.from(inner.querySelectorAll(".rpv-core__inner-page"));
    if (pageEls.length === 0) {
      pageEls = Array.from(inner.querySelectorAll('[data-rp^="page-"]'));
    }
    if (pageEls.length === 0) {
      const single = inner.querySelector('[data-rp="page-1"]') ||
        inner.querySelector('[data-testid="page-1"]') ||
        inner.querySelector(".rpv-core__inner-page") ||
        inner.querySelector(".rpv-core__page-layer");
      if (single) {
        const pageRect = single.getBoundingClientRect();
        setPage1Rect({
          left: pageRect.left - innerRect.left,
          top: pageRect.top - innerRect.top,
          width: pageRect.width,
          height: pageRect.height,
        });
        setPageRects([{
          left: pageRect.left - innerRect.left,
          top: pageRect.top - innerRect.top,
          width: pageRect.width,
          height: pageRect.height,
        }]);
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

  useEffect(() => {
    if (!showDoc) return;
    measurePages();
    const t1 = setTimeout(measurePages, 300);
    const t2 = setTimeout(measurePages, 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [showDoc, contentSize.width, contentSize.height, zoom, measurePages]);

  const handleAdoptAndSign = async ({ signatureData }) => {
    await apiClient.post(`/signing/${token}/sign`, { signatureData });
    setSignModalOpen(false);
    setSignFieldId(null);
    // Refetch so we get updated document with signedFilePath and show the signed PDF
    await fetchInfo();
  };

  const openSignModal = (fieldId) => {
    setSignFieldId(fieldId);
    setSignModalOpen(true);
  };

  const handleComplete = async () => {
    setCompleteError("");
    setCompleting(true);
    try {
      await apiClient.post(`/signing/${token}/complete`);
      await fetchInfo();
      // Force viewer to unload current PDF, then load the signed one (avoids cache showing original)
      setFileUrl(null);
      const urlRes = await apiClient.get(`/signing/${token}/file-url`);
      const signedUrl = urlRes.data?.url;
      if (signedUrl) {
        setTimeout(() => setFileUrl(signedUrl), 1000);
      }
      setShowSigningCompletedMessage(true);
    } catch (err) {
      setCompleteError(err.response?.data?.error || "Could not complete");
    } finally {
      setCompleting(false);
    }
  };

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
  const isSigned = signRequest.status === "signed";
  const fields = signRequest.signatureFields?.length
    ? signRequest.signatureFields
    : [{ id: "default", page: 1, x: 100, y: 400, width: 180, height: 36, type: "signature" }];
  const signatureData = signRequest.signatureData;
  const allFieldsAreInitial = fields.every((f) => (f.type || "signature").toLowerCase() === "initial");

  const scale = zoom / 100;
  const hasSize = contentSize.width > 0 && contentSize.height > 0;
  const wrapWidth = hasSize ? Math.round(contentSize.width * scale) : undefined;
  const wrapHeight = hasSize ? Math.round(contentSize.height * scale) : undefined;

  const scaleFactor = scale;
  const renderW = doc.page1RenderWidth > 0 ? doc.page1RenderWidth : (page1Rect ? page1Rect.width / scaleFactor : contentSize.width);
  const renderH = doc.page1RenderHeight > 0 ? doc.page1RenderHeight : (page1Rect ? page1Rect.height / scaleFactor : contentSize.height);
  const page1LayoutWidth = page1Rect ? page1Rect.width / scaleFactor : contentSize.width;
  const page1LayoutHeight = page1Rect ? page1Rect.height / scaleFactor : contentSize.height;
  const scaleOverlayX = renderW > 0 ? (page1Rect ? page1LayoutWidth / renderW : (hasSize ? contentSize.width / renderW : 1)) : 1;
  const scaleOverlayY = renderH > 0 ? (page1Rect ? page1LayoutHeight / renderH : (hasSize ? contentSize.height / renderH : 1)) : 1;
  const offsetOverlayX = page1Rect ? page1Rect.left / scaleFactor : 0;
  const offsetOverlayY = page1Rect ? page1Rect.top / scaleFactor : 0;

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
          <span className="signing-review-title">Review and complete</span>
        </div>
        <div className="signing-review-header-center">
          <span className="signing-envelope-id">Envelope ID: {doc.id}</span>
        </div>
        <div className="signing-review-header-right">
          {isSigned ? (
            <span className="signing-complete-btn signing-signed-label" style={{ cursor: "default", pointerEvents: "none" }} tabIndex={-1} aria-hidden>Signed</span>
          ) : (
            <button
              type="button"
              className="signing-complete-btn"
              onClick={handleComplete}
              disabled={completing}
            >
              {completing ? "…" : "Complete"}
            </button>
          )}
          {completeError && (
            <span className="signing-complete-error" role="alert">{completeError}</span>
          )}
          {/* <button type="button" className="signing-more-btn" aria-label="More options">
            ⋮
          </button> */}
        </div>
      </header>

      <div className="signing-review-body">
        <main className="signing-review-main">
          <div ref={containerRef} className="signing-doc-canvas">
              <div
                className="signing-pdf-wrap"
                style={{
                  minWidth: hasSize ? `max(100%, ${wrapWidth}px)` : "100%",
                  minHeight: hasSize ? `max(100%, ${wrapHeight}px)` : "100%",
                }}
              >
                <div
                  ref={pdfInnerRef}
                  className="signing-pdf-inner"
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "center center",
                  }}
                >
                  {fileUrl ? (
                    <PdfViewer
                      key={isSigned ? `signed-${doc?.id}-${fileUrl}` : `draft-${fileUrl}`}
                      fileUrl={fileUrl}
                    />
                  ) : (
                    <div className="signing-loading">Loading PDF…</div>
                  )}
                  {/* Placeholder overlay until Complete (then PDF has the signature, no overlay) */}
                  {!isSigned && (
                  <div className="signing-fields-overlay">
                    {fields.map((f) => {
                      const typeLower = (f.type || "signature").toLowerCase();
                      const isSig = typeLower === "signature" || typeLower === "initial";
                      if (!isSig) return null;
                      const isInitialField = typeLower === "initial";
                      const blockHeight = Math.max(28, (f.height || 36) * scaleOverlayY);
                      const blockWidth = Math.max(120, (f.width || 180) * scaleOverlayX);
                      const hasSigned = !!signatureData;
                      const pageNum = Math.max(1, f.page || 1);
                      const fieldPageRect = pageRects.length >= pageNum ? pageRects[pageNum - 1] : page1Rect;
                      const fieldOffsetX = fieldPageRect ? fieldPageRect.left / scaleFactor : offsetOverlayX;
                      const fieldOffsetY = fieldPageRect ? fieldPageRect.top / scaleFactor : offsetOverlayY;
                      const left = fieldOffsetX + (Number(f.x) || 0) * scaleOverlayX;
                      const top = fieldOffsetY + (Number(f.y) || 0) * scaleOverlayY;
                      return (
                        <div
                          key={f.id || `${f.page}-${f.x}-${f.y}`}
                          className={`signing-field-block ${hasSigned ? "signed" : "unsigned"}`}
                          style={{
                            left,
                            top,
                            width: blockWidth,
                            height: blockHeight,
                            minWidth: 120,
                            minHeight: 28,
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
                                  signatureData={signatureData}
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
                              <span className="signing-field-icon" aria-hidden>✒</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
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
          {isSigned ? (
            <span className="signing-sidebar-item">
              <span className="signing-sidebar-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              </span>
              Signed
            </span>
          ) : (
            <>
              {fileUrl ? (
                <a href={fileUrl} download={doc?.title ? (doc.title.endsWith(".pdf") ? doc.title : `${doc.title}.pdf`) : "document.pdf"} className="signing-sidebar-item">
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
          <div className="signing-sidebar-zoom">
            <button
              type="button"
              className="signing-zoom-btn signing-zoom-in"
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
        </aside>
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
                ? "The envelope is complete. You can download the document through the link in your email."
                : "You can download the document through email once the envelope is completed. We'll email you when all recipients have signed."}
            </p>
            <button type="button" className="signing-completed-dismiss" onClick={() => setShowSigningCompletedMessage(false)}>
              OK
            </button>
          </div>
        </div>
      )}

      <AdoptSignatureModal
        open={signModalOpen}
        onClose={() => { setSignModalOpen(false); setSignFieldId(null); }}
        signerName={signRequest.signerName}
        signerEmail={signRequest.signerEmail}
        initialSignatureData={signatureData}
        onAdoptAndSign={handleAdoptAndSign}
        initialsOnly={allFieldsAreInitial}
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
  const fontSize = Math.max(11, Math.min(24, Number(parts[4]) || 14));

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
