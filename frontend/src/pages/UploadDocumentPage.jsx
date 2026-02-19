import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import TopNavLayout from "../components/TopNavLayout.jsx";

export default function UploadDocumentPage() {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a PDF file");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("file", file);
      const res = await apiClient.post("/documents", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      navigate(`/documents/${res.data._id}`);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <TopNavLayout>
      <div className="narrow">
        <h1>New document</h1>
        {error && <p className="auth-error">{error}</p>}
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label>
            PDF file
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? "Uploading…" : "Create document"}
          </button>
        </form>
      </div>
    </TopNavLayout>
  );
}
