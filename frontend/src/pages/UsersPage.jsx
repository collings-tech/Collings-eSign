import { useEffect, useMemo, useState } from "react";
import TopNavLayout from "../components/TopNavLayout.jsx";
import { apiClient } from "../api/client";

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function normalizeRoles(roles) {
  const arr = Array.isArray(roles) ? roles : [];
  const cleaned = arr.map((r) => String(r || "").trim().toLowerCase()).filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  unique.sort((a, b) => (a === "admin" ? -1 : 1) - (b === "admin" ? -1 : 1));
  return unique;
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [page, setPage] = useState(1);
  const perPage = 10;
  const [editUser, setEditUser] = useState(null);
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    apiClient
      .get("/users")
      .then((res) => setUsers(res.data || []))
      .catch((err) => {
        console.error(err);
        setError(err.response?.data?.error || "Failed to load users");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const closeEdit = () => {
    setEditUser(null);
    setEditIsAdmin(false);
    setEditSaving(false);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      return (
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.role || "").toLowerCase().includes(q)
      );
    });
  }, [users, query]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, currentPage]);

  const saveAdminForUser = async (userId, setAdmin) => {
    setSavingId(userId);
    setError("");
    try {
      const res = await apiClient.patch(`/users/${userId}`, { setAdmin });
      const updated = res.data?.user;
      if (updated?.id) {
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      } else {
        load();
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update user");
    } finally {
      setSavingId(null);
    }
  };

  const openEdit = (u) => {
    setError("");
    setEditUser(u);
    setEditIsAdmin(Array.isArray(u.roles) && u.roles.includes("admin"));
  };

  const handleEditSave = async () => {
    if (!editUser?.id) return;
    const userId = editUser.id;
    const nextIsAdmin = !!editIsAdmin;
    setEditSaving(true);
    try {
      await saveAdminForUser(userId, nextIsAdmin);
      closeEdit();
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <TopNavLayout>
      <section className="ds-section">
        <div className="agreements-header">
          <div>
            <h1 className="agreements-title">Users</h1>
            <p className="agreements-empty-hint" style={{ marginTop: "0.25rem" }}>
              Manage access for everyone in the eSign system.
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
              placeholder="Search users"
            />
          </label>
          <div className="agreements-filters">
            {query && (
              <button type="button" className="agreements-clear" onClick={() => setQuery("")}>
                Clear
              </button>
            )}
          </div>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <div className="agreements-table users-table">
          <div className="agreements-table-head users-table-head">
            <div className="agreements-col-name">NAME</div>
            <div className="agreements-col-status">EMAIL</div>
            <div className="agreements-col-last">ROLE</div>
            <div className="agreements-col-last">CREATED</div>
            <div className="agreements-col-actions" />
          </div>

          {loading ? (
            <div className="agreements-row muted">Loading…</div>
          ) : !filtered.length ? (
            <div className="agreements-row muted">No users found.</div>
          ) : (
            paginated.map((u) => {
              const saving = savingId === u.id;
              const roles = normalizeRoles(u.roles);
              const isAdmin = roles.includes("admin");
              return (
                <div key={u.id} className="agreements-row">
                  <div className="agreements-col-name">
                    <div className="agreements-name-link" style={{ cursor: "default" }}>
                      {u.name || "—"}
                    </div>
                    <div className="agreements-sub templates-sub">
                      {isAdmin ? "Administrator" : "Standard user"}
                    </div>
                  </div>
                  <div className="agreements-col-status">
                    <span className="agreements-recipients-line">{u.email}</span>
                  </div>
                  <div className="agreements-col-last">
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-start" }}>
                      {roles.length ? (
                        roles.map((r) => (
                          <span key={r} className={`status-pill ${r === "admin" ? "status-admin" : "status-draft"}`}>
                            {String(r).toUpperCase()}
                          </span>
                        ))
                      ) : (
                        <span className="status-pill status-draft">USER</span>
                      )}
                    </div>
                  </div>
                  <div className="agreements-col-last">
                    <div className="agreements-last">{formatDateTime(u.createdAt)}</div>
                  </div>
                  <div className="agreements-col-actions">
                    <div className="agreements-actions-group">
                      <button
                        type="button"
                        className="agreements-action agreements-action-primary"
                        onClick={() => openEdit(u)}
                        disabled={saving}
                      >
                        Edit
                      </button>
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

      {editUser && (
        <div
          className="adopt-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-title"
          onClick={closeEdit}
        >
          <div className="adopt-modal use-template-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="adopt-modal-close" onClick={closeEdit} aria-label="Close">
              <i className="lni lni-xmark" aria-hidden />
            </button>
            <h2 id="edit-user-title" className="adopt-modal-title">
              Edit user
            </h2>
            <p className="adopt-modal-subtitle">
              {editUser.name || "—"} • {editUser.email}
            </p>

            <div className="users-edit-row">
              <div className="users-edit-row-text">
                <div className="users-edit-row-title">Admin access</div>
                <div className="users-edit-row-subtitle">Admins can manage users and system settings.</div>
              </div>
              <label className="users-toggle" aria-label="Toggle admin access">
                <input
                  type="checkbox"
                  checked={editIsAdmin}
                  onChange={(e) => setEditIsAdmin(e.target.checked)}
                  disabled={editSaving}
                />
                <span className="users-toggle-track" aria-hidden="true">
                  <span className="users-toggle-thumb" aria-hidden="true" />
                </span>
              </label>
            </div>

            <div className="adopt-modal-actions">
              <button type="button" className="agreements-action agreements-action-secondary" onClick={closeEdit} disabled={editSaving}>
                Cancel
              </button>
              <button type="button" className="agreements-action agreements-action-primary" onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </TopNavLayout>
  );
}

