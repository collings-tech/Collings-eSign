import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import TopNavLayout from "../components/TopNavLayout.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function mapDocStatusToBucket(status) {
  if (status === "draft") return "drafts";
  if (status === "pending") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "deleted") return "deleted";
  return "all";
}

function getStatusLabel(agreement, userEmail) {
  if (agreement.status === "draft") return "Draft";
  if (agreement.status === "completed") return "Completed";
  if (agreement.status === "deleted") return "Deleted";
  if (agreement.mySignRequest && agreement.mySignRequest.status !== "signed") return "Need to sign";
  const signRequests = agreement.signRequests || [];
  const unsigned = signRequests.filter((sr) => sr.status !== "signed");
  if (unsigned.length === 0) return "Completed";
  if (unsigned.length === 1) return `Waiting for ${unsigned[0].signerName || unsigned[0].signerEmail || "signer"}`;
  return `Waiting for ${unsigned.length} others`;
}

function getRecipientsLine(agreement) {
  const signRequests = agreement.signRequests || [];
  if (!signRequests.length) return "Recipients not set";
  return "To: " + signRequests.map((sr) => sr.signerName || sr.signerEmail || "—").join(", ");
}

export default function AgreementsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [deletedDocs, setDeletedDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [resendModalDoc, setResendModalDoc] = useState(null);
  const [resendEdits, setResendEdits] = useState({});
  const [resendSubmitting, setResendSubmitting] = useState(false);
  const [resendError, setResendError] = useState("");

  const [bucket, setBucket] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const fetchAgreements = useCallback(async (includeDeleted = false) => {
    const endpoint = includeDeleted ? "/documents/agreements?deleted=1" : "/documents/agreements";
    const res = await apiClient.get(endpoint);
    return res.data;
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      fetchAgreements(false).then(setDocs).catch(() => []),
      fetchAgreements(true).then(setDeletedDocs).catch(() => []),
    ])
      .catch((err) => {
        console.error(err);
        setError("Failed to load agreements");
      })
      .finally(() => setLoading(false));
  }, [fetchAgreements]);

  const refetch = useCallback(() => {
    Promise.all([
      fetchAgreements(false).then(setDocs).catch(() => []),
      fetchAgreements(true).then(setDeletedDocs).catch(() => []),
    ]).catch(() => {});
  }, [fetchAgreements]);

  const listForBucket = bucket === "deleted" ? deletedDocs : docs;
  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listForBucket
      .filter((d) => {
        if (bucket === "deleted") return d.status === "deleted";
        if (bucket === "all") return true;
        return mapDocStatusToBucket(d.status) === bucket;
      })
      .filter((d) => {
        if (!q) return true;
        return (d.title || "").toLowerCase().includes(q);
      });
  }, [listForBucket, bucket, query]);

  const totalItems = filteredDocs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const paginatedDocs = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filteredDocs.slice(start, start + perPage);
  }, [filteredDocs, currentPage, perPage]);

  useEffect(() => {
    setPage(1);
  }, [bucket, query]);

  const counts = useMemo(() => {
    const next = { all: docs.length, drafts: 0, in_progress: 0, completed: 0, deleted: deletedDocs.length };
    for (const d of docs) {
      const b = mapDocStatusToBucket(d.status);
      if (b in next) next[b] += 1;
    }
    return next;
  }, [docs, deletedDocs]);

  const title =
    bucket === "drafts"
      ? "Drafts"
      : bucket === "in_progress"
        ? "In Progress"
        : bucket === "completed"
          ? "Completed"
          : bucket === "deleted"
            ? "Deleted"
            : "All agreements";

  const openResendModal = (agreement) => {
    const waiting = (agreement.signRequests || []).filter((sr) => sr.status !== "signed");
    const edits = {};
    waiting.forEach((sr) => {
      const id = sr._id?.toString?.() || sr.signLinkToken;
      if (id) edits[id] = { email: sr.signerEmail || "", name: sr.signerName || "" };
    });
    setResendEdits(edits);
    setResendError("");
    setResendModalDoc(agreement);
  };

  const closeResendModal = () => {
    setResendModalDoc(null);
    setResendEdits({});
    setResendError("");
  };

  const setResendEdit = (signRequestId, field, value) => {
    setResendEdits((prev) => ({
      ...prev,
      [signRequestId]: { ...(prev[signRequestId] || {}), [field]: value },
    }));
  };

  const handleResendSubmit = async () => {
    if (!resendModalDoc) return;
    const waiting = (resendModalDoc.signRequests || []).filter((sr) => sr.status !== "signed");
    const hasEmptyEmail = waiting.some((sr) => {
      const id = sr._id?.toString?.() || sr.signLinkToken;
      const e = resendEdits[id];
      return !(e?.email || sr.signerEmail || "").trim();
    });
    if (hasEmptyEmail) {
      setResendError("Each recipient must have an email address.");
      return;
    }
    setResendSubmitting(true);
    setResendError("");
    try {
      const recipients = waiting.map((sr) => {
        const id = sr._id?.toString?.() || sr.signLinkToken;
        const e = resendEdits[id] || {};
        return {
          signRequestId: sr._id,
          email: (e.email || sr.signerEmail || "").trim(),
          name: (e.name ?? sr.signerName ?? "").trim() || (e.email || sr.signerEmail || "").trim(),
        };
      });
      await apiClient.post(`/documents/${resendModalDoc._id}/resend`, { recipients });
      closeResendModal();
      refetch();
    } catch (err) {
      console.error(err);
      setResendError(err.response?.data?.error || err.message || "Failed to resend");
    } finally {
      setResendSubmitting(false);
    }
  };

  const handleSign = (agreement) => {
    const token = agreement.mySignRequest?.signLinkToken;
    if (token) navigate(`/sign/${token}`);
  };

  const handleDownload = async (doc) => {
    if (!doc.originalKey && !doc.originalFilePath) return;
    try {
      const res = await apiClient.get(`/documents/${doc._id}/file-url`);
      if (res.data?.url) window.open(res.data.url, "_blank", "noopener");
    } catch (err) {
      console.error(err);
      const file = doc.signedFilePath || doc.originalFilePath;
      if (file) window.open(`${API_BASE}/uploads/${file}`, "_blank", "noopener");
    }
  };

  const handleTrash = async (doc) => {
    setActionLoading(doc._id);
    setMenuOpenId(null);
    try {
      await apiClient.patch(`/documents/${doc._id}/trash`);
      refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveAsTemplate = (doc) => {
    setMenuOpenId(null);
    // Placeholder: could duplicate doc as template
  };

  const isOwner = (doc) => doc.ownerId && user?.id && String(doc.ownerId) === String(user.id);

  return (
    <TopNavLayout>
      <div className="agreements-shell">
        <aside className="agreements-sidebar">
          <div className="agreements-sidebar-top">
            <Link to="/documents/new" className="agreements-primary">
              New agreement
            </Link>
          </div>

          <div className="agreements-nav">
            <button
              type="button"
              className={`agreements-nav-item ${bucket === "all" ? "active" : ""}`}
              onClick={() => setBucket("all")}
            >
              <span>All agreements</span>
              <span className="agreements-count">{counts.all}</span>
            </button>

            <div className="agreements-nav-group">
              <button
                type="button"
                className={`agreements-nav-sub ${bucket === "drafts" ? "active" : ""}`}
                onClick={() => setBucket("drafts")}
              >
                Drafts
                <span className="agreements-count">{counts.drafts}</span>
              </button>
              <button
                type="button"
                className={`agreements-nav-sub ${bucket === "in_progress" ? "active" : ""}`}
                onClick={() => setBucket("in_progress")}
              >
                In Progress
                <span className="agreements-count">{counts.in_progress}</span>
              </button>
              <button
                type="button"
                className={`agreements-nav-sub ${bucket === "completed" ? "active" : ""}`}
                onClick={() => setBucket("completed")}
              >
                Completed
                <span className="agreements-count">{counts.completed}</span>
              </button>
              <button
                type="button"
                className={`agreements-nav-sub ${bucket === "deleted" ? "active" : ""}`}
                onClick={() => setBucket("deleted")}
              >
                Deleted
                <span className="agreements-count">{counts.deleted}</span>
              </button>
            </div>

            <div className="agreements-divider" />

            <button type="button" className="agreements-nav-item" disabled>
              <span>Folders</span>
              <span className="agreements-count">—</span>
            </button>
            <button type="button" className="agreements-nav-item" disabled>
              <span>PowerForms</span>
              <span className="agreements-count">—</span>
            </button>
            <button type="button" className="agreements-nav-item" disabled>
              <span>Bulk Send</span>
              <span className="agreements-count">—</span>
            </button>
          </div>
        </aside>

        <section className="agreements-content">
          <div className="agreements-header">
            <div>
              <h1 className="agreements-title">{title}</h1>
            </div>
            <div className="agreements-header-actions">
             
            </div>
          </div>

          <div className="agreements-controls">
            <label className="agreements-search">
              <span className="sr-only">Search</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${title.toLowerCase()}`}
              />
            </label>

            <div className="agreements-filters">
              {/* <button type="button" className="agreements-filter" disabled>
                Date
              </button>
              <button type="button" className="agreements-filter" disabled>
                Status
              </button>
              <button type="button" className="agreements-filter" disabled>
                Sender
              </button>
              <button type="button" className="agreements-filter" disabled>
                More
              </button>
              <button
                type="button"
                className="agreements-clear"
                onClick={() => {
                  setQuery("");
                  setBucket("all");
                }}
              >
                Clear
              </button> */}
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <div className="agreements-table">
            <div className="agreements-table-head">
              <div className="agreements-col-select" />
              <div className="agreements-col-name">NAME</div>
              <div className="agreements-col-status">STATUS</div>
              <div className="agreements-col-last">LAST CHANGE</div>
              <div className="agreements-col-actions" />
            </div>

            {loading ? (
              <div className="agreements-row muted">Loading…</div>
            ) : bucket === "deleted" && !filteredDocs.length ? (
              <div className="agreements-row muted">No deleted agreements.</div>
            ) : !filteredDocs.length ? (
              <div className="agreements-row muted">No agreements found.</div>
            ) : (
              paginatedDocs.map((agreement) => {
                const statusLabel = getStatusLabel(agreement, user?.email);
                const needToSign = agreement.mySignRequest && agreement.mySignRequest.status !== "signed";
                const isPending = agreement.status === "pending";
                const isCompleted = agreement.status === "completed";
                const canOpen = agreement.status !== "deleted" && (isOwner(agreement) || needToSign);
                const loadingThis = actionLoading === agreement._id;
                const menuOpen = menuOpenId === agreement._id;
                return (
                  <div key={agreement._id} className="agreements-row">
                    <div className="agreements-col-select">
                      <input type="checkbox" aria-label={`Select ${agreement.title}`} disabled={agreement.status === "deleted"} />
                    </div>
                    <div className="agreements-col-name">
                      {canOpen ? (
                        <Link to={`/documents/${agreement._id}`} className="agreements-name-link">
                          {agreement.title}
                        </Link>
                      ) : (
                        <span className="agreements-name-link">{agreement.title}</span>
                      )}
                      <div className="agreements-sub">{getRecipientsLine(agreement)}</div>
                    </div>
                    <div className="agreements-col-status">
                      <span className={`status-pill status-${agreement.status} ${isCompleted ? "status-completed" : ""}`}>
                        {isCompleted && <span className="agreements-status-icon" aria-hidden>✓</span>}
                        {statusLabel}
                      </span>
                    </div>
                    <div className="agreements-col-last">
                      <div className="agreements-last">
                        {formatDateTime(agreement.updatedAt || agreement.createdAt)}
                      </div>
                    </div>
                    <div className="agreements-col-actions">
                      {agreement.status !== "deleted" && (
                        <div className="agreements-actions-group">
                          {needToSign && (
                            <button
                              type="button"
                              className="agreements-action agreements-action-primary"
                              onClick={() => handleSign(agreement)}
                            >
                              Sign
                            </button>
                          )}
                          {isPending && isOwner(agreement) && !needToSign && (
                            <button
                              type="button"
                              className="agreements-action agreements-action-secondary"
                              onClick={() => openResendModal(agreement)}
                              disabled={loadingThis}
                            >
                              Resend
                            </button>
                          )}
                          {isCompleted && (
                            <button
                              type="button"
                              className="agreements-action agreements-action-secondary"
                              onClick={() => handleDownload(agreement)}
                            >
                              Download
                            </button>
                          )}
                          {!needToSign && !isPending && !isCompleted && isOwner(agreement) && (
                            <Link to={`/documents/${agreement._id}`} className="agreements-action agreements-action-secondary">
                              Open
                            </Link>
                          )}
                          <div className="agreements-menu-wrap">
                            <button
                              type="button"
                              className="agreements-action agreements-action-menu"
                              onClick={() => setMenuOpenId(menuOpen ? null : agreement._id)}
                              aria-expanded={menuOpen}
                              aria-haspopup="true"
                              aria-label="Options"
                            >
                              <span className="agreements-dots-icon" aria-hidden>
                                <span /><span /><span />
                              </span>
                            </button>
                            {menuOpen && (
                              <>
                                <div className="agreements-menu-backdrop" onClick={() => setMenuOpenId(null)} aria-hidden />
                                <div className="agreements-menu-dropdown" role="menu">
                                  <button type="button" className="agreements-menu-item" role="menuitem" onClick={() => handleSaveAsTemplate(agreement)}>
                                    Save as template
                                  </button>
                                  {isOwner(agreement) && (
                                    <button type="button" className="agreements-menu-item agreements-menu-item-danger" role="menuitem" onClick={() => handleTrash(agreement)}>
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
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

      {resendModalDoc && (
        <div
          className="adopt-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resend-modal-title"
          onClick={closeResendModal}
        >
          <div className="adopt-modal resend-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="adopt-modal-close"
              onClick={closeResendModal}
              aria-label="Close"
            >
              ×
            </button>
            <h2 id="resend-modal-title" className="adopt-modal-title">
              Resend to recipients
            </h2>
            <p className="adopt-modal-subtitle">
              Update email or name below if needed, then click Resend. The signing link will be sent to each recipient.
            </p>
            {(() => {
              const waiting = (resendModalDoc.signRequests || []).filter((sr) => sr.status !== "signed");
              return (
                <div className="resend-modal-recipients">
                  {waiting.map((sr, idx) => {
                    const id = sr._id?.toString?.() || sr.signLinkToken;
                    const edit = resendEdits[id] || {};
                    const email = edit.email ?? sr.signerEmail ?? "";
                    const name = edit.name ?? sr.signerName ?? "";
                    return (
                      <div key={id || idx} className="resend-modal-row">
                        <label className="adopt-modal-field">
                          <span>Name</span>
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setResendEdit(id, "name", e.target.value)}
                            placeholder="Recipient name"
                          />
                        </label>
                        <label className="adopt-modal-field">
                          <span>Email</span>
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setResendEdit(id, "email", e.target.value)}
                            placeholder="email@example.com"
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {resendError && <p className="adopt-error">{resendError}</p>}
            <div className="adopt-modal-actions">
              <button type="button" className="adopt-btn secondary" onClick={closeResendModal}>
                Cancel
              </button>
              <button
                type="button"
                className="adopt-btn primary"
                onClick={handleResendSubmit}
                disabled={resendSubmitting}
              >
                {resendSubmitting ? "Sending…" : "Resend"}
              </button>
            </div>
          </div>
        </div>
      )}
    </TopNavLayout>
  );
}
