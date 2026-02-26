import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import TopNavLayout from "../components/TopNavLayout.jsx";

function formatDateTime(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function getRecipientsLine(template) {
  const recipients = template.recipients || [];
  if (!recipients.length) return "Recipients not set";
  return "To: " + recipients.map((r) => r.name || r.email || "—").join(", ");
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [useModalTemplate, setUseModalTemplate] = useState(null);
  const [useModalRecipients, setUseModalRecipients] = useState([]);
  const [useModalLoadingRecipients, setUseModalLoadingRecipients] = useState(false);
  const [useModalSubject, setUseModalSubject] = useState("");
  const [useModalMessage, setUseModalMessage] = useState("");
  const [useModalSending, setUseModalSending] = useState(false);
  const [useModalError, setUseModalError] = useState("");
  const [useModalSuccess, setUseModalSuccess] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => (t.title || "").toLowerCase().includes(q));
  }, [templates, query]);

  const totalItems = filteredTemplates.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const paginatedTemplates = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filteredTemplates.slice(start, start + perPage);
  }, [filteredTemplates, currentPage, perPage]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const openUseModal = useCallback((template) => {
    setUseModalTemplate(template);
    setUseModalRecipients((template.recipients || []).length > 0
      ? (template.recipients || []).map((r, i) => ({ ...r, _idx: i }))
      : []);
    setUseModalSubject(template.subject || "");
    setUseModalMessage(template.message || "");
    setUseModalError("");
    setUseModalSuccess(false);
    setUseModalLoadingRecipients(true);
  }, []);

  // When Use modal opens, fetch sign-requests so we show all recipients (signers from template)
  const useModalTemplateId = useModalTemplate?._id;
  useEffect(() => {
    if (!useModalTemplateId || !useModalLoadingRecipients) return;
    const template = useModalTemplate;
    let cancelled = false;
    (async () => {
      try {
        const signRes = await apiClient.get(`/sign-requests/${useModalTemplateId}`);
        if (cancelled) return;
        const signRequests = signRes.data || [];
        const signerEmails = new Set(signRequests.map((sr) => (sr.signerEmail || "").toLowerCase().trim()));
        const fromSigners = signRequests
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((sr) => ({
            name: sr.signerName || "",
            email: sr.signerEmail || "",
            role: "signer",
            order: sr.order ?? 0,
          }));
        const templateRecipients = (template && template.recipients) ? template.recipients : [];
        const viewersAndCc = templateRecipients.filter(
          (r) => (r.role || "signer") !== "signer" || !signerEmails.has((r.email || "").toLowerCase().trim())
        );
        const merged = [...fromSigners];
        viewersAndCc.forEach((r) => {
          const email = (r.email || "").toLowerCase().trim();
          if (email && !signerEmails.has(email)) {
            signerEmails.add(email);
            merged.push({
              name: r.name || "",
              email: r.email || "",
              role: r.role || "viewer",
              order: r.order ?? merged.length,
            });
          }
        });
        if (merged.length === 0 && templateRecipients.length > 0) {
          setUseModalRecipients(
            templateRecipients.map((r, i) => ({ ...r, _idx: i }))
          );
        } else {
          setUseModalRecipients(merged.map((r, i) => ({ ...r, _idx: i })));
        }
      } catch {
        if (!cancelled) setUseModalRecipients((prev) => (prev.length ? prev : [{ name: "", email: "", role: "signer", _idx: 0 }]));
      } finally {
        if (!cancelled) setUseModalLoadingRecipients(false);
      }
    })();
    return () => { cancelled = true; };
  }, [useModalTemplateId, useModalLoadingRecipients, useModalTemplate]);

  const closeUseModal = useCallback(() => {
    setUseModalTemplate(null);
    setUseModalRecipients([]);
    setUseModalLoadingRecipients(false);
    setUseModalError("");
    setUseModalSuccess(false);
  }, []);

  const updateUseModalRecipient = useCallback((index, field, value) => {
    setUseModalRecipients((prev) => {
      const next = [...prev];
      if (next[index]) next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);


  const fetchTemplates = useCallback(async () => {
    const res = await apiClient.get("/documents/templates");
    return res.data;
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetchTemplates()
      .then(setTemplates)
      .catch((err) => {
        console.error(err);
        setError("Failed to load templates");
        setTemplates([]);
      })
      .finally(() => setLoading(false));
  }, [fetchTemplates]);

  const handleUseTemplateAdvanced = (template) => {
    closeUseModal();
    setMenuOpenId(null);
    // Route to NewAgreementPage first so user can add recipients, then Next → DocumentDetailPage
    navigate("/documents/new", { state: { editDocumentId: template._id } });
  };

  const handleDeleteTemplate = async (template) => {
    setMenuOpenId(null);
    setActionLoading(template._id);
    try {
      await apiClient.patch(`/documents/${template._id}/trash`);
      setTemplates((prev) => prev.filter((t) => t._id !== template._id));
      if (useModalTemplate?._id === template._id) closeUseModal();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to delete template");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUseTemplateSend = async () => {
    if (!useModalTemplate) return;
    const signers = useModalRecipients.filter((r) => (r.role || "signer") === "signer" && r.name?.trim() && r.email?.trim());
    if (!signers.length) {
      setUseModalError("At least one signer with name and email is required.");
      return;
    }
    setUseModalSending(true);
    setUseModalError("");
    try {
      const recipients = useModalRecipients.map((r, i) => ({
        name: (r.name || "").trim(),
        email: (r.email || "").trim().toLowerCase(),
        role: r.role || "signer",
        order: i + 1,
      })).filter((r) => r.name && r.email);
      const res = await apiClient.post(`/documents/use-template/${useModalTemplate._id}`, {
        recipients,
        subject: useModalSubject,
        message: useModalMessage,
      });
      setUseModalSuccess(true);
      setTimeout(() => {
        closeUseModal();
        navigate("/agreements");
      }, 1500);
    } catch (err) {
      console.error(err);
      setUseModalError(err.response?.data?.error || "Failed to send document");
    } finally {
      setUseModalSending(false);
    }
  };

  return (
    <TopNavLayout>
      <div className="agreements-shell">
        <aside className="agreements-sidebar">
          <div className="agreements-sidebar-top">
            <Link to="/documents/new" className="agreements-primary" state={{ isTemplateFlow: true }}>
              Create template
            </Link>
          </div>

          <div className="agreements-nav">
            <button type="button" className="agreements-nav-item active">
              <span>All templates</span>
              <span className="agreements-count">{templates.length}</span>
            </button>
          </div>
        </aside>

        <section className="agreements-content">
          <div className="agreements-header">
            <div>
              <h1 className="agreements-title">Templates</h1>
              <p className="agreements-empty-hint" style={{ marginTop: "0.25rem" }}>
                Create templates with fields already placed. When using a template, just update recipients and send.
              </p>
            </div>
          </div>

          <div className="agreements-controls">
            <label className="agreements-search">
              <span className="sr-only">Search</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates"
              />
            </label>
            <div className="agreements-filters">
              {query && (
                <button type="button" className="agreements-clear" onClick={() => { setQuery(""); setPage(1); }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <div className="agreements-table templates-table">
            <div className="agreements-table-head templates-table-head">
              <div className="agreements-col-select" />
              <div className="agreements-col-name">NAME</div>
              <div className="agreements-col-status">RECIPIENTS</div>
              <div className="agreements-col-last">LAST CHANGE</div>
              <div className="agreements-col-actions" />
            </div>

            {loading ? (
              <div className="agreements-row muted">Loading…</div>
            ) : !templates.length ? (
              <div className="agreements-row muted">
                No templates yet.{" "}
                <Link to="/documents/new" className="agreements-inline-link" state={{ isTemplateFlow: true }}>
                  Create your first template
                </Link>
              </div>
            ) : !filteredTemplates.length ? (
              <div className="agreements-row muted">No templates found.</div>
            ) : (
              paginatedTemplates.map((template) => {
                const loadingThis = actionLoading === template._id;
                return (
                  <div key={template._id} className="agreements-row">
                    <div className="agreements-col-select">
                      <input type="checkbox" aria-label={`Select ${template.title}`} disabled />
                    </div>
                    <div className="agreements-col-name">
                      <Link to={`/documents/${template._id}`} className="agreements-name-link">
                        {template.title}
                      </Link>
                      <div className="agreements-sub templates-sub">{getRecipientsLine(template)}</div>
                    </div>
                    <div className="agreements-col-status templates-col-recipients">
                      <span className="agreements-recipients-line">{getRecipientsLine(template)}</span>
                    </div>
                    <div className="agreements-col-last">
                      <div className="agreements-last">
                        {formatDateTime(template.updatedAt || template.createdAt)}
                      </div>
                    </div>
                    <div className="agreements-col-actions">
                      <div className="agreements-actions-group">
                        <button
                          type="button"
                          className="agreements-action agreements-action-primary"
                          onClick={() => openUseModal(template)}
                          disabled={loadingThis}
                        >
                          Use
                        </button>
                        <button
                          type="button"
                          className="agreements-action agreements-action-secondary templates-action-edit"
                          onClick={() => handleUseTemplateAdvanced(template)}
                          disabled={loadingThis}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="agreements-action agreements-action-secondary"
                          onClick={() => navigate(`/templates/${template._id}`)}
                          disabled={loadingThis}
                        >
                          View
                        </button>
                        <div className="agreements-menu-wrap">
                          <button
                            type="button"
                            className="agreements-action agreements-action-menu"
                            onClick={() => setMenuOpenId(menuOpenId === template._id ? null : template._id)}
                            aria-expanded={menuOpenId === template._id}
                            aria-haspopup="true"
                            aria-label="Options"
                          >
                            <span className="agreements-dots-icon" aria-hidden>
                              <span /><span /><span />
                            </span>
                          </button>
                          {menuOpenId === template._id && (
                            <>
                              <div className="agreements-menu-backdrop" onClick={() => setMenuOpenId(null)} aria-hidden />
                              <div className="agreements-menu-dropdown" role="menu">
                                <button
                                  type="button"
                                  className="agreements-menu-item agreements-menu-item-danger"
                                  role="menuitem"
                                  onClick={() => handleDeleteTemplate(template)}
                                  disabled={loadingThis}
                                >
                                  Delete
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {!loading && totalItems > 0 && (
            <div className="agreements-pagination">
              <span className="agreements-pagination-summary">
                Showing {Math.min((currentPage - 1) * perPage + 1, totalItems)}–
                {Math.min(currentPage * perPage, totalItems)} of {totalItems}
              </span>
              <div className="agreements-pagination-controls">
                <button
                  type="button"
                  className="agreements-pagination-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <span className="agreements-pagination-pages">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  className="agreements-pagination-btn"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {useModalTemplate && (
        <div
          className="adopt-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="use-template-modal-title"
          onClick={(e) => e.target === e.currentTarget && !useModalSending && closeUseModal()}
        >
          <div className="adopt-modal use-template-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="adopt-modal-close"
              onClick={closeUseModal}
              aria-label="Close"
              disabled={useModalSending}
            >
              <i className="lni lni-xmark" aria-hidden />
            </button>
            <h2 id="use-template-modal-title" className="adopt-modal-title">
              {useModalTemplate.title}
            </h2>
            <p className="adopt-modal-subtitle">
              Update recipients below, then click Send to send the document. No need to place fields again.
            </p>

            <div className="use-template-section">
              <h3 className="use-template-section-title">Recipients</h3>
              {useModalLoadingRecipients ? (
                <p className="use-template-loading">Loading recipients…</p>
              ) : (
                <>
                  <div className="resend-modal-recipients">
                    {useModalRecipients.map((r, idx) => (
                      <div key={r._idx != null ? r._idx : idx} className="resend-modal-row use-template-recipient-row">
                        <label className="adopt-modal-field">
                          <span>Name *</span>
                          <input
                            type="text"
                            value={r.name || ""}
                            onChange={(e) => updateUseModalRecipient(idx, "name", e.target.value)}
                            placeholder="Recipient name"
                          />
                        </label>
                        <label className="adopt-modal-field">
                          <span>Email *</span>
                          <input
                            type="email"
                            value={r.email || ""}
                            onChange={(e) => updateUseModalRecipient(idx, "email", e.target.value)}
                            placeholder="email@example.com"
                          />
                        </label>
                        <span className="use-template-role-badge">
                          {(r.role || "signer") === "signer" ? "NEEDS TO SIGN" : r.role === "viewer" ? "NEEDS TO VIEW" : r.role === "cc" ? "CC RECEIVES A COPY" : r.role || "signer"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="use-template-section">
              <h3 className="use-template-section-title">Message</h3>
              <label className="adopt-modal-field">
                <span>Subject</span>
                <input
                  type="text"
                  value={useModalSubject}
                  onChange={(e) => setUseModalSubject(e.target.value)}
                  placeholder="Email subject"
                />
              </label>
              <label className="adopt-modal-field">
                <span>Message</span>
                <textarea
                  value={useModalMessage}
                  onChange={(e) => setUseModalMessage(e.target.value)}
                  placeholder="Email message"
                  rows={3}
                />
              </label>
            </div>

            {useModalError && <p className="auth-error use-template-error">{useModalError}</p>}
            {useModalSuccess && <p className="use-template-success">Document sent successfully.</p>}

            <div className="adopt-modal-actions">
              <button type="button" className="adopt-btn secondary" onClick={closeUseModal} disabled={useModalSending}>
                Discard
              </button>
              <button
                type="button"
                className="adopt-btn secondary"
                onClick={() => handleUseTemplateAdvanced(useModalTemplate)}
                disabled={useModalSending}
              >
                Edit
              </button>
              <button
                type="button"
                className="adopt-btn primary"
                onClick={handleUseTemplateSend}
                disabled={useModalSending}
              >
                {useModalSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </TopNavLayout>
  );
}
