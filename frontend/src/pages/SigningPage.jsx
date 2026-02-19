import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import PdfViewer from "../components/PdfViewer.jsx";
import AdoptSignatureModal from "../components/AdoptSignatureModal.jsx";

export default function SigningPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signFieldId, setSignFieldId] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const [page1Rect, setPage1Rect] = useState(null);
  const containerRef = useRef(null);
  const pdfInnerRef = useRef(null);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await apiClient.get(`/signing/${token}`);
      setInfo(res.data);
      setError("");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Link not found");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

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

  // Measure first PDF page position/size so overlay matches prepare-view placement exactly
  const measurePage1 = useCallback(() => {
    const inner = pdfInnerRef.current;
    if (!inner) return;
    const firstPage =
      inner.querySelector('[data-rp="page-1"]') ||
      inner.querySelector('[data-testid="page-1"]') ||
      inner.querySelector(".rpv-core__inner-page") ||
      inner.querySelector(".rpv-core__page-layer");
    if (!firstPage) return;
    const innerRect = inner.getBoundingClientRect();
    const pageRect = firstPage.getBoundingClientRect();
    setPage1Rect({
      left: pageRect.left - innerRect.left,
      top: pageRect.top - innerRect.top,
      width: pageRect.width,
      height: pageRect.height,
    });
  }, []);

  useEffect(() => {
    if (!showDoc) return;
    measurePage1();
    const t1 = setTimeout(measurePage1, 300);
    const t2 = setTimeout(measurePage1, 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [showDoc, contentSize.width, contentSize.height, zoom, measurePage1]);

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
  if (error || !info) {
    return (
      <div className="signing-shell review-complete">
        <p className="signing-error">{error || "Not found"}</p>
      </div>
    );
  }

  const { document: doc, signRequest } = info;
  const isSigned = signRequest.status === "signed";
  const fileUrl = `${import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"}/uploads/${
    isSigned && doc.signedFilePath ? doc.signedFilePath : doc.originalFilePath
  }`;
  const fields = signRequest.signatureFields?.length
    ? signRequest.signatureFields
    : [{ id: "default", page: 1, x: 100, y: 400, width: 180, height: 36, type: "signature" }];
  const signatureData = signRequest.signatureData;

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
      <header className="signing-review-header">
        <div className="signing-review-header-left">
          <span className="signing-review-title">Review and complete</span>
        </div>
        <div className="signing-review-header-center">
          <span className="signing-envelope-id">Envelope ID: {doc.id}</span>
        </div>
        <div className="signing-review-header-right">
          {isSigned ? (
            <span className="signing-finish-badge">Complete</span>
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
          <button type="button" className="signing-more-btn" aria-label="More options">
            ⋮
          </button>
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
                  <PdfViewer fileUrl={fileUrl} />
                  {/* Placeholder overlay until Complete (then PDF has the signature, no overlay) */}
                  {!isSigned && (
                  <div className="signing-fields-overlay">
                    {fields.map((f) => {
                      const typeLower = (f.type || "signature").toLowerCase();
                      const isSig = typeLower === "signature" || typeLower === "initial";
                      if (!isSig) return null;
                      const blockHeight = Math.max(28, (f.height || 36) * scaleOverlayY);
                      const blockWidth = Math.max(120, (f.width || 180) * scaleOverlayX);
                      const hasSigned = !!signatureData;
                      const isPage1 = (f.page || 1) === 1;
                      const left = offsetOverlayX + (Number(f.x) || 0) * scaleOverlayX;
                      const top = offsetOverlayY + (Number(f.y) || 0) * scaleOverlayY;
                      return (
                        <div
                          key={f.id || `${f.page}-${f.x}-${f.y}`}
                          className={`signing-field-block ${hasSigned ? "signed" : "unsigned"}`}
                          style={{
                            left: isPage1 ? left : (Number(f.x) || 0) * scaleOverlayX,
                            top: isPage1 ? top : (Number(f.y) || 0) * scaleOverlayY,
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
                              aria-label="Change signature"
                            >
                              <span className="signing-field-signed-by">Signed by:</span>
                              <div className="signing-field-signature-inner">
                                <SigningFieldSignature
                                  signatureData={signatureData}
                                  signerName={signRequest.signerName}
                                  initials={getInitials(signRequest.signerName)}
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
                              aria-label="Click to sign"
                            >
                              <span className="signing-field-label">Sign</span>
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
          <button type="button" className="signing-sidebar-item summarize">
            <span className="signing-sidebar-icon" aria-hidden>★</span>
            Summarize
          </button>
          <button type="button" className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>🔍</span>
            Search
          </button>
          <button type="button" className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>📄</span>
            View Pages
          </button>
          <button type="button" className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>💬</span>
            Comment
          </button>
          <a href={fileUrl} download className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>↓</span>
            Download
          </a>
          <button type="button" className="signing-sidebar-item" onClick={() => window.print()}>
            <span className="signing-sidebar-icon" aria-hidden>🖨</span>
            Print
          </button>
          <button type="button" className="signing-sidebar-item">
            <span className="signing-sidebar-icon" aria-hidden>🎧</span>
            Counsel
          </button>
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

      <AdoptSignatureModal
        open={signModalOpen}
        onClose={() => { setSignModalOpen(false); setSignFieldId(null); }}
        signerName={signRequest.signerName}
        signerEmail={signRequest.signerEmail}
        initialSignatureData={signatureData}
        onAdoptAndSign={handleAdoptAndSign}
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

function SigningFieldSignature({ signatureData, signerName, initials }) {
  const isImage = typeof signatureData === "string" && (signatureData.startsWith("data:image") || signatureData.startsWith("http"));
  const isTyped = typeof signatureData === "string" && signatureData.startsWith("typed::");
  const parts = isTyped ? signatureData.split("::") : [];
  const typedName = (parts[1] != null && parts[1] !== "") ? parts[1] : signerName;
  const font = parts[2] || "cursive";
  const typedInitials = (parts[3] != null && parts[3] !== "") ? parts[3] : initials;
  const displayName = typedName || signerName || "Signed";
  const displayInitials = typedInitials || initials || "—";
  const fontSize = Math.max(11, Math.min(24, Number(parts[4]) || 14));

  return (
    <div className="signing-field-signature">
      {isImage && (
        <img src={signatureData} alt="" className="signing-field-signature-img" />
      )}
      {isTyped && (
        <span className="signing-field-signature-text" style={{ fontFamily: font, fontSize: `${fontSize}px` }}>
          {displayName}
        </span>
      )}
      {!isImage && !isTyped && (
        <span className="signing-field-signature-text" style={{ fontSize: `${fontSize}px` }}>
          {displayName}
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
