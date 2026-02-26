import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiClient } from "../api/client";
import TopNavLayout from "../components/TopNavLayout.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import PdfViewer from "../components/PdfViewer.jsx";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const REMINDER_OPTIONS = [
  { value: "every_day", label: "Every day" },
  { value: "every_3_days", label: "Every 3 days" },
  { value: "every_5_days", label: "Every 5 days" },
  { value: "weekly", label: "Every week" },
  { value: "never", label: "Never" },
];

const SUBJECT_MAX = 100;
const MESSAGE_MAX = 10000;
const DEFAULT_SUBJECT = "Please complete with Collings eSign:";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function DocThumbnail({ id, file, onView, onRemove, pageCount, onPageCount }) {
  return (
    <div className="new-agreement-doc-card">
      <button
        type="button"
        className="new-agreement-doc-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(id); }}
        title={`Delete ${file.name}`}
        aria-label={`Delete ${file.name}`}
      >
        <i className="lni lni-xmark" aria-hidden />
      </button>
      <div className="new-agreement-doc-thumb-wrap" onClick={() => onView(file)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onView(file)}>
        <div className="new-agreement-doc-thumb">
          <Document
            file={file}
            onLoadSuccess={({ numPages }) => onPageCount?.(file, numPages)}
            loading={<span className="new-agreement-doc-thumb-loading">Loading…</span>}
            error={<span className="new-agreement-doc-thumb-error">PDF</span>}
          >
            <Page pageNumber={1} width={100} renderTextLayer={false} renderAnnotationLayer={false} />
          </Document>
        </div>
        <span className="new-agreement-doc-view-overlay">View</span>
      </div>
      <div className="new-agreement-doc-info">
        <span className="new-agreement-doc-name" title={file.name}>
          {file.name.length > 20 ? `${file.name.slice(0, 17)}...` : file.name}
        </span>
        <span className="new-agreement-doc-pages">
          {pageCount != null ? `${pageCount} pages` : "—"}
        </span>
      </div>
    </div>
  );
}

function ExistingDocCard({ title, fileUrl, pageCount, onView, onPageCount }) {
  const displayName = title?.length > 20 ? `${title.slice(0, 17)}...` : (title || "Document");
  return (
    <div className="new-agreement-doc-card new-agreement-doc-card-existing">
      <div
        className="new-agreement-doc-thumb-wrap"
        onClick={() => onView(fileUrl)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onView(fileUrl)}
      >
        <div className="new-agreement-doc-thumb">
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages }) => onPageCount?.(numPages)}
            loading={<span className="new-agreement-doc-thumb-loading">Loading…</span>}
            error={<span className="new-agreement-doc-thumb-error">PDF</span>}
          >
            <Page pageNumber={1} width={100} renderTextLayer={false} renderAnnotationLayer={false} />
          </Document>
        </div>
        <span className="new-agreement-doc-view-overlay">View</span>
      </div>
      <div className="new-agreement-doc-info">
        <span className="new-agreement-doc-name" title={title}>
          {displayName}
        </span>
        <span className="new-agreement-doc-pages">
          {pageCount != null ? `${pageCount} pages` : "—"}
        </span>
      </div>
    </div>
  );
}

export default function NewAgreementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const editDocumentId = location.state?.editDocumentId ?? null;

  const [files, setFiles] = useState([]); // { id, file }
  const fileIdRef = useRef(0);
  const [filePageCounts, setFilePageCounts] = useState({});
  const [fileError, setFileError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewFileUrl, setPreviewFileUrl] = useState(null);
  const previewUrlRef = useRef(null);

  const [existingDocument, setExistingDocument] = useState(null);
  const [existingDocPageCount, setExistingDocPageCount] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const openPreview = useCallback((fileOrUrl) => {
    if (typeof fileOrUrl === "string") {
      setPreviewFile(null);
      setPreviewFileUrl(fileOrUrl);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    } else {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = fileOrUrl ? URL.createObjectURL(fileOrUrl) : null;
      setPreviewFile(fileOrUrl);
      setPreviewFileUrl(null);
    }
  }, []);

  const closePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewFile(null);
    setPreviewFileUrl(null);
  }, []);

  const [recipients, setRecipients] = useState([
    { id: 1, name: "", email: "", role: "signer", order: 1 },
  ]);
  const [onlySigner, setOnlySigner] = useState(false);
  const [signingOrder, setSigningOrder] = useState(false);

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [message, setMessage] = useState("");
  const [reminderFrequency, setReminderFrequency] = useState("every_day");

  const [docsCollapsed, setDocsCollapsed] = useState(false);
  const [recipientsCollapsed, setRecipientsCollapsed] = useState(false);
  const [messageCollapsed, setMessageCollapsed] = useState(false);
  const [recipientInfoDismissed, setRecipientInfoDismissed] = useState(false);
  const [pastRecipients, setPastRecipients] = useState([]);
  const [suggestionOpen, setSuggestionOpen] = useState(null); // { recipientId, field: 'name' | 'email' }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get("/documents/past-recipients");
        if (!cancelled) setPastRecipients(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (!cancelled) setPastRecipients([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!suggestionOpen) return;
    const handleMouseDown = (e) => {
      if (e.target.closest(".new-agreement-field-with-suggest")) return;
      setSuggestionOpen(null);
    };
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => document.removeEventListener("mousedown", handleMouseDown, true);
  }, [suggestionOpen]);

  const openSuggestion = (recipientId, field) => {
    setSuggestionOpen({ recipientId, field });
  };

  const selectPastRecipient = (recipientId, past) => {
    updateRecipient(recipientId, "name", past.name || "");
    updateRecipient(recipientId, "email", past.email || "");
    setSuggestionOpen(null);
  };

  const filteredPastRecipients = (recipientId, field, currentValue) => {
    const val = (currentValue || "").toLowerCase().trim();
    if (!val) return pastRecipients;
    return pastRecipients.filter((p) => {
      if (field === "name") return (p.name || "").toLowerCase().includes(val) || (p.email || "").toLowerCase().includes(val);
      return (p.email || "").toLowerCase().includes(val) || (p.name || "").toLowerCase().includes(val);
    });
  };

  useEffect(() => {
    if (files.length > 0) {
      const names = files.map(({ file }) => file.name).join(", ");
      const next = `${DEFAULT_SUBJECT} ${names}`.slice(0, SUBJECT_MAX);
      setSubject(next);
    } else if (!existingDocument) {
      setSubject(DEFAULT_SUBJECT);
    }
  }, [files, existingDocument]);

  useEffect(() => {
    if (!editDocumentId) return;
    let cancelled = false;
    setLoadingExisting(true);
    (async () => {
      try {
        const [docRes, signRes] = await Promise.all([
          apiClient.get(`/documents/${editDocumentId}`),
          apiClient.get(`/sign-requests/${editDocumentId}`),
        ]);
        if (cancelled) return;
        const doc = docRes.data;
        const signers = signRes.data || [];
        let fileUrl = null;
        if (doc.originalKey || doc.originalFilePath) {
          try {
            const urlRes = await apiClient.get(`/documents/${doc._id}/file-url`);
            if (urlRes.data?.url) fileUrl = urlRes.data.url;
          } catch {
            fileUrl = doc.originalFilePath ? `${API_BASE}/uploads/${doc.originalFilePath}` : null;
          }
        }
        setExistingDocument({
          id: doc._id,
          title: doc.title || "Document",
          fileUrl,
        });
        setSubject(doc.subject || DEFAULT_SUBJECT);
        setMessage(doc.message || "");
        setReminderFrequency(doc.reminderFrequency || "every_day");
        setSigningOrder(Boolean(doc.signingOrder));
        if (signers.length > 0) {
          const myEmail = (user?.email || "").toLowerCase();
          const onlyMe = signers.length === 1 && (signers[0].signerEmail || "").toLowerCase() === myEmail;
          setOnlySigner(onlyMe);
          setRecipients(
            signers.map((sr, i) => ({
              id: i + 1,
              name: sr.signerName || "",
              email: sr.signerEmail || "",
              role: "signer",
              order: sr.order ?? i + 1,
            }))
          );
        }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || "Failed to load document");
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editDocumentId, user?.email]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const ROLE_OPTIONS = [
    { value: "signer", label: "Needs to Sign" },
    { value: "viewer", label: "Needs to View" },
  ];
  const RECIPIENT_BAR_COLORS = ["#55c5d0", "#45b5c0", "#57595c", "#7dd4dc", "#38a5b0"];

  const signerRecipients = recipients.filter((r) => r.role === "signer" && r.name && r.email);
  const hasDocument = files.length >= 1 || existingDocument != null;
  const canSubmit = hasDocument && (onlySigner || signerRecipients.length >= 1);

  const duplicateEmails = useMemo(() => {
    const seen = new Map();
    const dups = new Set();
    recipients.forEach((r) => {
      const email = (r.email || "").trim().toLowerCase();
      if (!email) return;
      if (seen.has(email)) dups.add(email);
      else seen.set(email, true);
    });
    return dups;
  }, [recipients]);

  const isDuplicateRecipient = useCallback((email) => {
    const normalized = (email || "").trim().toLowerCase();
    return normalized && duplicateEmails.has(normalized);
  }, [duplicateEmails]);

  const hasDuplicateRecipients = duplicateEmails.size > 0;

  const handlePageCount = useCallback((file, numPages) => {
    setFilePageCounts((prev) => ({ ...prev, [file.name + file.size]: numPages }));
  }, []);

  const removeFile = useCallback((idToRemove) => {
    setFiles((prev) => prev.filter(({ id }) => id !== idToRemove));
  }, []);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const addFiles = useCallback((fileList) => {
    if (!fileList?.length) return;
    const pdfs = Array.from(fileList).filter((f) => f.type === "application/pdf");
    const invalid = Array.from(fileList).filter((f) => f.type !== "application/pdf");
    if (invalid.length) {
      setFileError("Only PDF files are allowed");
    } else {
      setFileError("");
    }
    if (pdfs.length) {
      setFiles((prev) => [
        ...prev,
        ...pdfs.map((file) => ({ id: ++fileIdRef.current, file })),
      ]);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    addFiles(e.dataTransfer?.files);
  }, [addFiles]);

  const handleFileSelect = (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  };

  const addRecipient = () => {
    const nextOrder = signingOrder ? Math.max(0, ...recipients.map((r) => r.order), 0) + 1 : recipients.length + 1;
    const nextId = Math.max(0, ...recipients.map((r) => r.id), 0) + 1;
    setRecipients((prev) => [...prev, { id: nextId, name: "", email: "", role: "signer", order: nextOrder }]);
  };

  const setSigningOrderEnabled = (enabled) => {
    setSigningOrder(enabled);
    if (enabled) {
      setRecipients((prev) => prev.map((r, i) => ({ ...r, order: i + 1 })));
    }
  };

  const updateRecipient = (id, field, value) => {
    setRecipients((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const removeRecipient = (id) => {
    setRecipients((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSubmit = async () => {
    setError("");
    if (!canSubmit) return;
    if (editDocumentId && existingDocument) {
      setLoading(true);
      try {
        const signRes = await apiClient.get(`/sign-requests/${editDocumentId}`);
        const existingSigners = signRes.data || [];
        const existingEmails = new Set(existingSigners.map((sr) => (sr.signerEmail || "").toLowerCase().trim()));
        const signerRecipients = recipients.filter((r) => r.role === "signer" && r.name?.trim() && r.email?.trim());
        for (let i = 0; i < signerRecipients.length; i++) {
          const r = signerRecipients[i];
          const email = r.email.trim().toLowerCase();
          if (!existingEmails.has(email)) {
            await apiClient.post(`/sign-requests/${editDocumentId}`, {
              signerEmail: r.email.trim(),
              signerName: r.name.trim(),
              skipEmail: true,
              keepDraft: true,
              order: signingOrder ? (r.order ?? i + 1) : i + 1,
            });
            existingEmails.add(email);
          }
        }
        const isTemplateFlow = location.state?.isTemplateFlow === true;
        navigate(`/documents/${editDocumentId}`, { state: { openPrepare: true, ...(isTemplateFlow ? { isTemplateFlow: true } : {}) } });
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.error || "Failed to add recipients");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (onlySigner && recipients.length > 1) {
      setRecipients([recipients[0]]);
    }
    setLoading(true);
    try {
      const primaryFile = files[0]?.file;
      const title = primaryFile?.name?.replace(/\.pdf$/i, "") || "Document";
      const form = new FormData();
      form.append("title", title);
      files.forEach(({ file }) => form.append("files", file));

      const recipientPayload = onlySigner && user
        ? [{ name: user.name || "", email: (user.email || "").trim(), role: "signer", order: 1 }]
        : recipients
            .filter((r) => r.name?.trim() && r.email?.trim())
            .map((r, i) => ({
              name: r.name.trim(),
              email: r.email.trim(),
              role: r.role,
              order: signingOrder ? (r.order ?? i + 1) : i,
            }));
      form.append("recipients", JSON.stringify(recipientPayload));
      form.append("onlySigner", onlySigner ? "true" : "false");
      form.append("subject", subject);
      form.append("message", message);
      form.append("reminderFrequency", reminderFrequency);
      form.append("signingOrder", signingOrder ? "true" : "false");

      const res = await apiClient.post("/documents", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const isTemplateFlow = location.state?.isTemplateFlow === true;
      navigate(`/documents/${res.data._id}`, { state: isTemplateFlow ? { isTemplateFlow: true } : undefined });
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to create agreement");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => navigate(location.state?.isTemplateFlow ? "/templates" : "/agreements");

  return (
    <TopNavLayout>
      <div className="new-agreement">
        <header className="new-agreement-header">
          <button
            type="button"
            className="new-agreement-close"
            onClick={handleClose}
            aria-label="Close"
          >
            <i className="lni lni-xmark" aria-hidden />
          </button>
          <h1 className="new-agreement-title">
            {loadingExisting
                ? "Loading…"
                : existingDocument
                  ? `Complete with Collings eSign: ${existingDocument.title}${files.length > 0 ? `, ${files.map(({ file }) => file.name).join(", ")}` : ""}`
                  : files.length > 0
                    ? `Complete with Collings eSign: ${files.map(({ file }) => file.name).join(", ")}`
                    : "Upload a Document and Add Envelope Recipients"}
          </h1>
          <div className="new-agreement-header-actions">
            
          </div>
        </header>

        <div className="new-agreement-body">
          <section className="new-agreement-section">
            <button
              type="button"
              className="new-agreement-section-head"
              onClick={() => setDocsCollapsed(!docsCollapsed)}
            >
              <h2>Add documents</h2>
              <span className="new-agreement-caret" aria-hidden>
                {docsCollapsed ? "▼" : "▲"}
              </span>
            </button>
            {!docsCollapsed && (
              <div className="new-agreement-docs-wrap">
                {(existingDocument || files.length > 0) && (
                  <div className="new-agreement-doc-cards">
                    {existingDocument && (
                      <ExistingDocCard
                        title={existingDocument.title}
                        fileUrl={existingDocument.fileUrl}
                        pageCount={existingDocPageCount}
                        onView={openPreview}
                        onPageCount={setExistingDocPageCount}
                      />
                    )}
                    {files.map(({ id, file }) => (
                      <DocThumbnail
                        key={id}
                        id={id}
                        file={file}
                        onView={openPreview}
                        onRemove={removeFile}
                        pageCount={filePageCounts[file.name + file.size]}
                        onPageCount={handlePageCount}
                      />
                    ))}
                  </div>
                )}
                <div
                  className={`new-agreement-upload ${dragActive ? "drag-active" : ""} ${(existingDocument || files.length > 0) ? "has-file" : ""}`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <span className="new-agreement-upload-icon">↑</span>
                  <p className="new-agreement-upload-text">
                    Drop your files here or
                  </p>
                  <label className="new-agreement-upload-btn-wrap">
                    <span className="new-agreement-btn primary upload">Upload</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={handleFileSelect}
                      className="sr-only"
                    />
                  </label>
                  {fileError && (
                    <p className="auth-error new-agreement-inline-error">{fileError}</p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="new-agreement-section">
                <button
                  type="button"
                  className="new-agreement-section-head"
                  onClick={() => setRecipientsCollapsed(!recipientsCollapsed)}
                >
                  <h2>Add recipients</h2>
                  <span className="new-agreement-caret" aria-hidden>
                    {recipientsCollapsed ? "▼" : "▲"}
                  </span>
                </button>
                {!recipientsCollapsed && (
                  <div className="new-agreement-recipients">
                    <label className="new-agreement-check-row">
                      <input
                        type="checkbox"
                        checked={onlySigner}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setOnlySigner(checked);
                          if (checked && user) {
                            setRecipients([{ id: 1, name: user.name || "", email: user.email || "", role: "signer", order: 1 }]);
                          } else if (!checked) {
                            setRecipients([{ id: 1, name: "", email: "", role: "signer", order: 1 }]);
                            setSigningOrderEnabled(false);
                          }
                        }}
                      />
                      <span>I'm the only signer</span>
                      <span className="new-agreement-info-icon" title="You will be the only person who needs to sign. No other recipients; no email will be sent when you send." aria-hidden><i className="lni lni-question-mark-circle" aria-hidden /></span>
                    </label>
                    {!onlySigner && (
                      <>
                        <div className="new-agreement-check-row">
                          <input
                            id="signing-order-checkbox"
                            type="checkbox"
                            checked={signingOrder}
                            onChange={(e) => setSigningOrderEnabled(e.target.checked)}
                            disabled={recipients.length < 2}
                          />
                          <label htmlFor="signing-order-checkbox">
                            <span>Set signing order</span>
                          </label>
                         
                        </div>

                    {recipients.map((r, index) => {
                      const duplicate = isDuplicateRecipient(r.email);
                      return (
                      <div
                        key={r.id}
                        className={`new-agreement-recipient-row${duplicate ? " new-agreement-recipient-row-duplicate" : ""}`}
                      >
                        {signingOrder && (
                          <label className="new-agreement-order-wrap" title="Signing order: 1 = first to receive and sign">
                            <input
                              type="number"
                              min={1}
                              max={Math.max(recipients.length, r.order ?? index + 1)}
                              value={r.order ?? index + 1}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                if (!Number.isNaN(v) && v >= 1) updateRecipient(r.id, "order", v);
                              }}
                              className="new-agreement-order-input"
                              aria-label={`Signing order for ${r.name || r.email || "recipient"}`}
                            />
                          </label>
                        )}
                        <div
                          className="new-agreement-recipient-bar"
                          style={{ background: RECIPIENT_BAR_COLORS[index % RECIPIENT_BAR_COLORS.length] }}
                          aria-hidden
                        />
                        <div className="new-agreement-recipient-card">
                          <div className="new-agreement-recipient-fields">
                            <div className="new-agreement-field-with-suggest">
                              <label className="new-agreement-field-label">
                                <span>Name *</span>
                                <span className="new-agreement-field-with-icon">
                                  <i className="lni lni-user-4 new-agreement-person-icon" aria-hidden />
                                  <input
                                    type="text"
                                    placeholder="Name"
                                    value={r.name}
                                    onChange={(e) => updateRecipient(r.id, "name", e.target.value)}
                                    onFocus={() => openSuggestion(r.id, "name")}
                                    onBlur={() => {}}
                                    autoComplete="off"
                                  />
                                </span>
                              </label>
                              {suggestionOpen?.recipientId === r.id && suggestionOpen?.field === "name" && (() => {
                                const list = filteredPastRecipients(r.id, "name", r.name);
                                return list.length > 0 && (
                                <ul
                                  className="new-agreement-past-recipients-list"
                                  role="listbox"
                                  onMouseDown={(e) => e.preventDefault()}
                                >
                                  {list.map((past, idx) => (
                                    <li
                                      key={`${past.email}-${idx}`}
                                      role="option"
                                      className="new-agreement-past-recipient-item"
                                      onMouseDown={() => selectPastRecipient(r.id, past)}
                                    >
                                      {past.name || "—"} : {past.email}
                                    </li>
                                  ))}
                                </ul>
                                );
                              })()}
                            </div>
                            <div className="new-agreement-field-with-suggest">
                              <label className="new-agreement-field-label">
                                <span>Email *</span>
                                <span className="new-agreement-field-with-icon">
                                  <i className="lni lni-envelope-1 new-agreement-person-icon" aria-hidden />
                                  <input
                                    type="email"
                                    placeholder="Email"
                                    value={r.email}
                                    onChange={(e) => updateRecipient(r.id, "email", e.target.value)}
                                    onFocus={() => openSuggestion(r.id, "email")}
                                    onBlur={() => {}}
                                    autoComplete="off"
                                  />
                                </span>
                              </label>
                              {suggestionOpen?.recipientId === r.id && suggestionOpen?.field === "email" && (() => {
                                const list = filteredPastRecipients(r.id, "email", r.email);
                                return list.length > 0 && (
                                <ul
                                  className="new-agreement-past-recipients-list"
                                  role="listbox"
                                  onMouseDown={(e) => e.preventDefault()}
                                >
                                  {list.map((past, idx) => (
                                    <li
                                      key={`${past.email}-${idx}`}
                                      role="option"
                                      className="new-agreement-past-recipient-item"
                                      onMouseDown={() => selectPastRecipient(r.id, past)}
                                    >
                                      {past.name || "—"} : {past.email}
                                    </li>
                                  ))}
                                </ul>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="new-agreement-recipient-actions">
                            <label className="new-agreement-role-dropdown-wrap">
                              <i className="lni lni-pencil-1 new-agreement-role-icon" aria-hidden />
                              <select
                                value={r.role === "viewer" ? "viewer" : "signer"}
                                onChange={(e) => updateRecipient(r.id, "role", e.target.value)}
                                className="new-agreement-role-select"
                                aria-label="Recipient role"
                              >
                                {ROLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="new-agreement-customize-wrap">
                              {/* <button type="button" className="new-agreement-customize-btn" aria-haspopup="listbox" aria-label="Customize">
                                Customize <span aria-hidden>▼</span>
                              </button> */}
                            </div>
                            <button
                              type="button"
                              className="new-agreement-remove-recipient"
                              onClick={() => removeRecipient(r.id)}
                              aria-label="Remove recipient"
                              disabled={recipients.length <2}
                            >
                              <i className="lni lni-trash-3" aria-hidden />
                            </button>
                          </div>
                          {duplicate && (
                            <p className="new-agreement-recipient-duplicate-warning" role="alert">
                              This recipient is already in the list
                            </p>
                          )}
                        </div>
                      </div>
                    );
                    })}

                    {!recipientInfoDismissed && (
                      <div className="new-agreement-recipient-info">
                        <span className="new-agreement-info-icon" aria-hidden><i className="lni lni-question-mark-circle" aria-hidden /></span>
                        <p>
                          Fields are not automatically included in the document when new signers are added. Add new fields in the next step.
                        </p>
                        <button
                          type="button"
                          className="new-agreement-dismiss-info"
                          onClick={() => setRecipientInfoDismissed(true)}
                          aria-label="Dismiss"
                        >
                          <i className="lni lni-xmark" aria-hidden />
                        </button>
                      </div>
                    )}

                    <div className="new-agreement-add-recipient-wrap">
                      <button
                        type="button"
                        className="new-agreement-add-recipient-btn"
                        onClick={addRecipient}
                      >
                        <i className="lni lni-user-4 new-agreement-add-person-icon" aria-hidden />
                        Add Recipient
                        <span aria-hidden>▼</span>
                      </button>
                    </div>
                      </>
                    )}
                  </div>
                )}
              </section>

          <section className="new-agreement-section">
                <button
                  type="button"
                  className="new-agreement-section-head"
                  onClick={() => setMessageCollapsed(!messageCollapsed)}
                >
                  <h2>Add message</h2>
                  <span className="new-agreement-caret" aria-hidden>
                    {messageCollapsed ? "▼" : "▲"}
                  </span>
                </button>
                {!messageCollapsed && (
                  <div className="new-agreement-message">
                    <label className="new-agreement-message-field">
                      <span>Subject *</span>
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value.slice(0, SUBJECT_MAX))}
                        maxLength={SUBJECT_MAX}
                      />
                      <span className="new-agreement-char-count">
                        {subject.length}/{SUBJECT_MAX}
                      </span>
                    </label>
                    <label className="new-agreement-message-field">
                      <span>Message</span>
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
                        placeholder="Enter Message"
                        rows={4}
                        maxLength={MESSAGE_MAX}
                      />
                      <span className="new-agreement-char-count">
                        {message.length}/{MESSAGE_MAX}
                      </span>
                    </label>
                  </div>
                )}
              </section>

          {/* <section className="new-agreement-section reminder-section">
            <label className="new-agreement-reminder">
              <span>Frequency of reminders</span>
              <select
                value={reminderFrequency}
                onChange={(e) => setReminderFrequency(e.target.value)}
              >
                {REMINDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </section> */}

          {error && <p className="auth-error new-agreement-error">{error}</p>}

          <div className="new-agreement-footer">
            <button
              type="button"
              className="new-agreement-btn primary next"
              onClick={handleSubmit}
              disabled={!canSubmit || loading || loadingExisting || hasDuplicateRecipients}
            >
              {loading ? "Creating…" : loadingExisting ? "Loading…" : existingDocument ? "Next" : "Next"}
            </button>
          </div>
        </div>

        {((previewFile && previewUrlRef.current) || previewFileUrl) && (
          <div className="new-agreement-preview-overlay" onClick={closePreview} role="presentation">
            <div className="new-agreement-preview-modal" onClick={(e) => e.stopPropagation()}>
              <div className="new-agreement-preview-header">
                <h3>Document Preview</h3>
                <button
                  type="button"
                  className="new-agreement-preview-close"
                  onClick={closePreview}
                  aria-label="Close"
                >
                  <i className="lni lni-xmark" aria-hidden />
                </button>
              </div>
              <div className="new-agreement-preview-body">
                <PdfViewer fileUrl={previewFileUrl || previewUrlRef.current} />
              </div>
              <div className="new-agreement-preview-footer">
                {previewFile?.name ?? existingDocument?.title ?? "Document"}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          className="new-agreement-fab"
          onClick={addRecipient}
          aria-label="Add recipient"
        >
          +
        </button>
      </div>
    </TopNavLayout>
  );
}
