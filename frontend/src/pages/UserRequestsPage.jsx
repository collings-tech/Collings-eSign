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

export default function UserRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    apiClient
      .get("/user-requests")
      .then((res) => setRequests(res.data || []))
      .catch((err) => {
        console.error(err);
        setError(err.response?.data?.error || "Failed to load requests");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) => (r.email || "").toLowerCase().includes(q));
  }, [requests, query]);

  const handleApprove = async (id) => {
    setSavingId(id);
    setError("");
    try {
      await apiClient.post(`/user-requests/${id}/approve`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to approve request");
    } finally {
      setSavingId(null);
    }
  };

  const handleReject = async (id) => {
    setSavingId(id);
    setError("");
    try {
      await apiClient.post(`/user-requests/${id}/reject`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to reject request");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <TopNavLayout>
      <section className="ds-section">
        <div className="agreements-header">
          <div>
            <h1 className="agreements-title">Account Requests</h1>
            <p className="agreements-empty-hint" style={{ marginTop: "0.25rem" }}>
              Approve or reject new account requests for the eSign system.
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
              placeholder="Search by email"
            />
          </label>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <div className="agreements-table user-requests-table">
          <div className="agreements-table-head user-requests-table-head">
            <div className="agreements-col-name">EMAIL</div>
            <div className="agreements-col-last">STATUS</div>
            <div className="agreements-col-last">REQUESTED</div>
            <div className="agreements-col-actions" />
          </div>

          {loading ? (
            <div className="agreements-row muted">Loading…</div>
          ) : !filtered.length ? (
            <div className="agreements-row muted">No pending requests.</div>
          ) : (
            filtered.map((r) => {
              const saving = savingId === r.id;
              return (
                <div key={r.id} className="agreements-row">
                  <div className="agreements-col-name">
                    <div className="agreements-name-link" style={{ cursor: "default" }}>
                      {r.email}
                    </div>
                  </div>
                  <div className="agreements-col-last">
                    <span className="status-pill status-pending">Pending</span>
                  </div>
                  <div className="agreements-col-last">
                    <div className="agreements-last">{formatDateTime(r.createdAt)}</div>
                  </div>
                  <div className="agreements-col-actions">
                    <div className="agreements-actions-group">
                      <button
                        type="button"
                        className="agreements-action agreements-action-secondary"
                        onClick={() => handleReject(r.id)}
                        disabled={saving}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="agreements-action agreements-action-primary"
                        onClick={() => handleApprove(r.id)}
                        disabled={saving}
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </TopNavLayout>
  );
}

