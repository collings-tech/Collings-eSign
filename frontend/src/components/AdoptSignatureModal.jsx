import { useState, useRef, useCallback, useEffect } from "react";
import SignatureCanvas from "react-signature-canvas";

const SIGNATURE_FONTS = [
  "Dancing Script",
  "Great Vibes",
  "Allura",
  "Pacifico",
  "Sacramento",
];

function getInitials(name) {
  if (!name || !name.trim()) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export default function AdoptSignatureModal({ open, onClose, signerName = "", signerEmail = "", initialSignatureData, onAdoptAndSign }) {
  const [fullName, setFullName] = useState(signerName);
  const [initials, setInitials] = useState(getInitials(signerName));
  const [tab, setTab] = useState("style");
  const [styleIndex, setStyleIndex] = useState(0);
  const [showFontList, setShowFontList] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [error, setError] = useState("");
  const drawRef = useRef(null);
  const fontListRef = useRef(null);

  const font = SIGNATURE_FONTS[styleIndex % SIGNATURE_FONTS.length];
  const displayName = (fullName || "").replace(/\s+/g, " ").trim() || "Your name";
  const displayInitials = initials.trim() || "??";

  const [uploadDataUrl, setUploadDataUrl] = useState(null);

  useEffect(() => {
    if (!open) {
      setShowFontList(false);
      return;
    }
    setFullName(signerName || "");
    setInitials(getInitials(signerName));
    if (initialSignatureData && typeof initialSignatureData === "string") {
      if (initialSignatureData.startsWith("typed::")) {
        const parts = initialSignatureData.split("::");
        if (parts[1]) setFullName(parts[1].trim());
        if (parts[3]) setInitials(parts[3].trim());
        const fontName = parts[2];
        const idx = SIGNATURE_FONTS.indexOf(fontName);
        if (idx >= 0) setStyleIndex(idx);
        setTab("style");
      } else if (initialSignatureData.startsWith("data:image/")) {
        setUploadDataUrl(initialSignatureData);
        setTab("upload");
      }
    }
  }, [open, signerName, initialSignatureData]);

  useEffect(() => {
    if (!showFontList) return;
    const close = (e) => {
      if (fontListRef.current && !fontListRef.current.contains(e.target)) setShowFontList(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showFontList]);

  const handleFileChange = useCallback((e) => {
    const file = e.target?.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setUploadedImage(url);
      const reader = new FileReader();
      reader.onload = () => setUploadDataUrl(reader.result);
      reader.readAsDataURL(file);
    } else {
      setUploadedImage(null);
      setUploadDataUrl(null);
    }
  }, []);

  const handleAdopt = async () => {
    setError("");
    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!initials.trim()) {
      setError("Please enter your initials.");
      return;
    }
    let signatureData = "";
    if (tab === "draw") {
      if (!drawRef.current || drawRef.current.isEmpty()) {
        setError("Please draw your signature.");
        return;
      }
      signatureData = drawRef.current.toDataURL("image/png");
    } else if (tab === "upload") {
      if (!uploadDataUrl) {
        setError("Please upload an image of your signature.");
        return;
      }
      signatureData = uploadDataUrl;
    } else {
      signatureData = `typed::${displayName}::${font}::${displayInitials}`;
    }
    try {
      await onAdoptAndSign({ signatureData, fullName: fullName.trim(), initials: initials.trim() });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to submit signature.");
    }
  };

  const handleClose = () => {
    setError("");
    setUploadedImage((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="adopt-modal-backdrop" onClick={handleClose} role="dialog" aria-modal="true" aria-labelledby="adopt-modal-title">
      <div className="adopt-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="adopt-modal-close" onClick={handleClose} aria-label="Close">
          ×
        </button>
        <h2 id="adopt-modal-title" className="adopt-modal-title">Adopt Your Signature</h2>
        <p className="adopt-modal-subtitle">Confirm your name, initials, and signature.</p>

        <div className="adopt-modal-fields">
          <label className="adopt-modal-field">
            <span>Full Name *</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
            />
          </label>
          <label className="adopt-modal-field">
            <span>Initials *</span>
            <input
              type="text"
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="e.g. WG"
            />
          </label>
        </div>

        <div className="adopt-modal-tabs">
          {["style", "draw", "upload"].map((t) => (
            <button
              key={t}
              type="button"
              className={`adopt-modal-tab ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "style" ? "Select style" : t === "draw" ? "Draw" : "Upload"}
            </button>
          ))}
        </div>

        <div className="adopt-modal-tab-content">
          {tab === "style" && (
            <>
              <div className="adopt-style-preview-wrap" ref={fontListRef}>
                <div className="adopt-style-preview" style={{ fontFamily: font, fontSize: "16px" }}>
                  {displayName}
                </div>
                <div className="adopt-change-style-wrap">
                  <button
                    type="button"
                    className="adopt-change-style"
                    onClick={() => setShowFontList((v) => !v)}
                    aria-expanded={showFontList}
                    aria-haspopup="listbox"
                    aria-label="Change signature font style"
                  >
                    Change style
                  </button>
                  {showFontList && (
                    <ul
                      className="adopt-font-list"
                      role="listbox"
                      aria-label="Signature font styles"
                    >
                      {SIGNATURE_FONTS.map((f, idx) => (
                        <li key={f}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={styleIndex === idx}
                            className="adopt-font-option"
                            style={{ fontFamily: f }}
                            onClick={() => {
                              setStyleIndex(idx);
                              setShowFontList(false);
                            }}
                          >
                            {displayName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <p className="adopt-style-hint">Your signature will appear in the PDF in this style.</p>
            </>
          )}
          {tab === "draw" && (
            <div className="adopt-draw-wrap">
              <SignatureCanvas
                ref={drawRef}
                penColor="black"
                minWidth={2}
                maxWidth={4}
                canvasProps={{ width: 400, height: 120, className: "adopt-draw-canvas" }}
              />
              <button type="button" className="adopt-draw-clear" onClick={() => drawRef.current?.clear()}>
                Clear
              </button>
            </div>
          )}
          {tab === "upload" && (
            <div className="adopt-upload-wrap">
              <label className="adopt-upload-label">
                <input type="file" accept="image/*" onChange={handleFileChange} className="adopt-upload-input" />
                <span className="adopt-upload-btn">Choose image</span>
              </label>
              {(uploadedImage || uploadDataUrl) && (
                <div className="adopt-upload-preview">
                  <img src={uploadedImage || uploadDataUrl} alt="Signature" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="adopt-preview-section">
          <div className="adopt-preview-box">
            <span className="adopt-preview-label">Signed by:</span>
            {tab === "style" && <span className="adopt-preview-sig" style={{ fontFamily: font }}>{displayName}</span>}
            {tab === "draw" && drawRef.current && !drawRef.current.isEmpty() && (
              <img src={drawRef.current.toDataURL("image/png")} alt="" className="adopt-preview-img" />
            )}
            {tab === "upload" && uploadedImage && <img src={uploadedImage} alt="" className="adopt-preview-img" />}
            {tab === "draw" && (!drawRef.current || drawRef.current.isEmpty()) && (
              <span className="adopt-preview-placeholder">Draw above</span>
            )}
          </div>
          <div className="adopt-preview-box adopt-preview-initials">
            <span className="adopt-preview-label">Initials</span>
            <span className="adopt-preview-initials-text" style={{ fontFamily: font }}>{displayInitials}</span>
          </div>
        </div>

        <p className="adopt-legal">
          By selecting Adopt and Sign, I agree that the signature and initials will be the electronic representation of my signature and initials for all purposes when I (or my agent) use them on documents, including legally binding contracts.
        </p>

        {error && <p className="adopt-error">{error}</p>}

        <div className="adopt-modal-actions">
          <button type="button" className="adopt-btn secondary" onClick={handleClose}>
            Cancel
          </button>
          <button type="button" className="adopt-btn primary" onClick={handleAdopt}>
            Adopt and Sign
          </button>
        </div>
      </div>
    </div>
  );
}
