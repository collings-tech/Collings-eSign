import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import TopNavLayout from "../components/TopNavLayout.jsx";
import PdfMainView from "../components/PdfMainView.jsx";

const RECIPIENT_COLORS = [
  { border: "#5eb8d4", bg: "rgba(94, 184, 212, 0.5)" },
  { border: "#e8a0b8", bg: "rgba(232, 160, 184, 0.5)" },
  { border: "#7bc9a4", bg: "rgba(123, 201, 164, 0.5)" },
  { border: "#b8a5e0", bg: "rgba(184, 165, 224, 0.5)" },
  { border: "#f0b88a", bg: "rgba(240, 184, 138, 0.5)" },
  { border: "#e8d478", bg: "rgba(232, 212, 120, 0.5)" },
  { border: "#a8d4e0", bg: "rgba(168, 212, 224, 0.5)" },
  { border: "#d4a8c8", bg: "rgba(212, 168, 200, 0.5)" },
];

const FIELD_ICONS = {
  Signature: <i className="lni lni-pen-to-square" aria-hidden />,
  Initial: <i className="lni lni-pen-to-square" aria-hidden />,
  Stamp: <i className="lni lni-stamp" aria-hidden />,
  "Date Signed": <i className="lni lni-calendar-days" aria-hidden />,
  Name: <i className="lni lni-user-4" aria-hidden />,
  Email: "@",
  Company: <i className="lni lni-buildings-1" aria-hidden />,
  Title: <i className="lni lni-briefcase-1" aria-hidden />,
  Text: "T",
  Number: "#",
  Checkbox: <i className="lni lni-check-square-2" aria-hidden />,
  Dropdown: <i className="lni lni-angle-double-down" aria-hidden />,
  Radio: "○",
};

const FIELD_TYPE_LABELS = {
  signature: "Signature",
  initial: "Initial",
  stamp: "Stamp",
  date: "Date Signed",
  name: "Name",
  email: "Email",
  company: "Company",
  title: "Title",
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  radio: "Radio",
};

function getFieldTypeLabel(type) {
  if (!type) return "Signature";
  const lower = String(type).toLowerCase();
  return FIELD_TYPE_LABELS[lower] || type;
}

function getRoleLabel(role) {
  if (role === "signer") return "Needs to sign";
  if (role === "cc") return "CC – receives a copy";
  if (role === "approver") return "Approver";
  if (role === "viewer") return "Viewer";
  return role || "Signer";
}

function getRecipientColor(signRequestId, signers) {
  if (!signRequestId || !signers?.length) return RECIPIENT_COLORS[0];
  const idx = signers.findIndex((sr) => String(sr._id) === String(signRequestId));
  return RECIPIENT_COLORS[idx >= 0 ? idx % RECIPIENT_COLORS.length : 0];
}

function getDisplayType(type) {
  if (!type) return "Signature";
  const lower = String(type).toLowerCase();
  const map = {
    signature: "Signature",
    initial: "Initial",
    stamp: "Stamp",
    date: "Date Signed",
    name: "Name",
    email: "Email",
    company: "Company",
    title: "Title",
    text: "Text",
    number: "Number",
    checkbox: "Checkbox",
    dropdown: "Dropdown",
    radio: "Radio",
  };
  return map[lower] || type;
}

export default function TemplateViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [signers, setSigners] = useState([]);
  const [fileUrl, setFileUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [docRes, signRes] = await Promise.all([
          apiClient.get(`/documents/${id}`),
          apiClient.get(`/sign-requests/${id}`),
        ]);
        const document = docRes.data;
        if (!document?.isTemplate) {
          navigate("/templates");
          return;
        }
        setDoc(document);
        setSigners(signRes.data || []);
      } catch (err) {
        console.error(err);
        setError("Failed to load template");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, navigate]);

  useEffect(() => {
    if (!doc?._id) return;
    let cancelled = false;
    apiClient
      .get(`/documents/${doc._id}/file-url`)
      .then((res) => {
        if (!cancelled && res.data?.url) setFileUrl(res.data.url);
      })
      .catch(() => {
        if (!cancelled) setFileUrl(null);
      });
    return () => { cancelled = true; };
  }, [doc?._id]);

  const handleBack = () => navigate("/templates");

  if (loading) {
    return (
      <TopNavLayout>
        <p className="muted">Loading…</p>
      </TopNavLayout>
    );
  }
  if (error || !doc) {
    return (
      <TopNavLayout>
        <p className="auth-error">{error || "Template not found"}</p>
        <button type="button" className="prepare-btn secondary" onClick={handleBack}>
          Back to Templates
        </button>
      </TopNavLayout>
    );
  }

  const recipients = doc.recipients || [];
  const totalFields = signers.reduce((sum, sr) => sum + (sr.signatureFields || []).length, 0);

  const placedFields = signers.flatMap((sr) =>
    (sr.signatureFields || []).map((f) => ({
      ...f,
      signRequestId: sr._id,
      type: getDisplayType(f.type),
    }))
  );

  return (
    <TopNavLayout>
      <div className="template-view-shell">
        <header className="template-view-header">
          <button
            type="button"
            className="template-view-back"
            onClick={handleBack}
            aria-label="Back to templates"
          >
            ‹ Back
          </button>
          <h1 className="template-view-title">{doc.title || "Template"}</h1>
        </header>

        <div className="template-view-body">
          <aside className="template-view-sidebar">
            <section className="template-view-section">
              <h2 className="template-view-section-title">Recipients</h2>
              {recipients.length === 0 ? (
                <p className="template-view-muted">No recipients set</p>
              ) : (
                <ul className="template-view-recipients">
                  {recipients.map((r, i) => (
                    <li key={i} className="template-view-recipient">
                      <span className="template-view-recipient-name">{r.name || r.email || "—"}</span>
                      {r.email && r.name && (
                        <span className="template-view-recipient-email">{r.email}</span>
                      )}
                      <span className="template-view-recipient-role">{getRoleLabel(r.role)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="template-view-section">
              <h2 className="template-view-section-title">Fields placed</h2>
              {totalFields === 0 ? (
                <p className="template-view-muted">No fields placed</p>
              ) : (
                <ul className="template-view-fields">
                  {signers.map((sr) =>
                    (sr.signatureFields || []).map((f, idx) => (
                      <li key={`${sr._id}-${idx}`} className="template-view-field">
                        <span className="template-view-field-type">
                          {getFieldTypeLabel(f.type)}
                        </span>
                        <span className="template-view-field-assignee">
                          → {sr.signerName || sr.signerEmail || "Recipient"}
                        </span>
                        <span className="template-view-field-page">Page {f.page ?? 1}</span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </section>
          </aside>

          <main className="template-view-document">
            <h2 className="template-view-section-title">Document</h2>
            {fileUrl ? (
              <div className="template-view-pdf-wrap template-view-pdf-main">
                <PdfMainView
                  fileUrl={fileUrl}
                  onPageCount={() => {}}
                  renderPageOverlay={(pageNum) => {
                    const pageFields = placedFields.filter((f) => (f.page ?? 1) === pageNum);
                    return pageFields.map((f, idx) => {
                      const color = getRecipientColor(f.signRequestId, signers);
                      const isSignatureType = f.type === "Signature" || f.type === "Initial";
                      const xPct = f.xPct != null ? f.xPct : 8;
                      const yPct = f.yPct != null ? f.yPct : 10;
                      const wPct = f.wPct != null ? f.wPct : 14;
                      const hPct = f.hPct != null ? f.hPct : 6;
                      return (
                        <div
                          key={`${f.signRequestId}-${idx}`}
                          className={`template-view-placed-field ${isSignatureType ? "template-view-placed-field-sign" : ""}`}
                          style={{
                            position: "absolute",
                            left: `${xPct}%`,
                            top: `${yPct}%`,
                            width: `${wPct}%`,
                            height: `${hPct}%`,
                            borderColor: color.border,
                            backgroundColor: color.bg,
                            pointerEvents: "none",
                          }}
                          aria-hidden
                        >
                          <span className="prepare-placed-field-icon" aria-hidden>
                            {FIELD_ICONS[f.type] || "•"}
                          </span>
                          <span className="prepare-placed-field-label">
                            {f.type === "Signature" ? "Sign" : f.type}
                          </span>
                        </div>
                      );
                    });
                  }}
                />
              </div>
            ) : (
              <p className="template-view-muted">Document not available</p>
            )}
          </main>
        </div>
      </div>
    </TopNavLayout>
  );
}
