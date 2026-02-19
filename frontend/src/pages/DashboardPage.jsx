import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext.jsx";
import TopNavLayout from "../components/TopNavLayout.jsx";

function toPascalCase(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient
      .get("/documents/agreements")
      .then((res) => setAgreements(res.data || []))
      .catch((err) => {
        console.error(err);
        setError("Failed to load documents");
      })
      .finally(() => setLoading(false));
  }, []);

  // Total = all agreements (owned + docs awaiting user's signature)
  const total = agreements.length;
  // Awaiting signatures = docs I sent that are still pending (waiting for others to sign)
  const isOwner = (a) => a.ownerId && user?.id && String(a.ownerId) === String(user.id);
  const awaitingSignatures = agreements.filter(
    (a) => isOwner(a) && a.status === "pending"
  ).length;
  // Needs my signature = docs that require my signature (from others or from myself)
  const needsMySignature = agreements.filter(
    (a) => a.mySignRequest && a.mySignRequest.status !== "signed"
  ).length;
  const completed = agreements.filter((d) => d.status === "completed").length;

  return (
    <TopNavLayout>
      <section className="ds-hero">
        <div className="ds-hero-grid">
          <div>
            <h1>Welcome{user?.name ? `, ${toPascalCase(user.name)}` : ""}</h1>
            <p>
              Send documents for signature, track progress, and review audit
              activity in one workspace.
            </p>
            <div className="dashboard-hero-actions tight">
              <Link to="/documents/new" className="primary-btn hero-cta-btn">
                Send a document
              </Link>
              {total > 0 && (
                <span className="dashboard-helper">
                  Tip: open any document to manage signers.
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {error && <p className="auth-error">{error}</p>}

      <section className="ds-section">
        <div className="ds-section-header">
          <h2>Overview</h2>
        </div>
        <div className="dashboard-stats">
          <div className="stat-card">
            <span className="stat-label">Total docs</span>
            <span className="stat-value">{total}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Awaiting signatures</span>
            <span className="stat-value">{awaitingSignatures}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Needs my signature</span>
            <span className="stat-value">{needsMySignature}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Completed</span>
            <span className="stat-value">{completed}</span>
          </div>
        </div>
      </section>

      <section className="ds-section">
        <div className="ds-section-header">
          <h2>Recent documents</h2>
        </div>
        {loading ? (
          <p className="muted">Loading your documents…</p>
        ) : !agreements.length ? (
          <div className="empty-state" style={{ marginTop: 0 }}>
            <div className="empty-illustration" aria-hidden="true" />
            <h2>Start with your first document</h2>
            <p>
              Upload a PDF, add a signer, and we&apos;ll handle the signing flow
              and audit trail for you.
            </p>
            <Link to="/documents/new" className="primary-btn">
              Upload a PDF
            </Link>
          </div>
        ) : (
          <div className="card-list">
            {agreements.map((doc) => {
              const needToSign = doc.mySignRequest && doc.mySignRequest.status !== "signed";
              const isOwner = doc.ownerId && user?.id && String(doc.ownerId) === String(user.id);
              const signHref = needToSign && doc.mySignRequest?.signLinkToken
                ? `/sign/${doc.mySignRequest.signLinkToken}`
                : null;
              const cardContent = (
                <>
                  <div className="doc-card-header">
                    <h3>{doc.title}</h3>
                    <p className={`status-pill status-${doc.status} ${needToSign ? "status-need-sign" : ""}`}>
                      {needToSign ? "Need to sign" : doc.status}
                    </p>
                  </div>
                  <p className="doc-meta">
                    {needToSign && !isOwner ? "Sent to you" : "Created"}{" "}
                    {new Date(doc.updatedAt || doc.createdAt).toLocaleString()}
                  </p>
                </>
              );
              return signHref ? (
                <div
                  key={doc._id}
                  className="doc-card doc-card-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(signHref)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(signHref)}
                >
                  {cardContent}
                </div>
              ) : (
                <Link key={doc._id} to={`/documents/${doc._id}`} className="doc-card">
                  {cardContent}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </TopNavLayout>
  );
}
