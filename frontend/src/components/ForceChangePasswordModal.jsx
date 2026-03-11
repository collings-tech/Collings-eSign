import { useState, useEffect } from "react";
import { apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext.jsx";

export default function ForceChangePasswordModal() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [retypePassword, setRetypePassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const trimmedName = (name || "").trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    if (newPassword !== retypePassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post("/auth/change-password", {
        newPassword,
        name: trimmedName,
      });
      const updated = res.data?.user;
      if (updated) {
        updateUser(updated);
      } else {
        updateUser({ ...user, mustChangePassword: false });
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="adopt-modal-backdrop"
      style={{ pointerEvents: "auto", cursor: "default" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-change-password-title"
    >
      <div className="adopt-modal use-template-modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="force-change-password-title" className="adopt-modal-title">
          Set your password
        </h2>
        <p className="adopt-modal-subtitle">
          You signed in with a temporary password. Please create a new password to continue.
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              disabled={loading}
              placeholder="Your full name"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              disabled={loading}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={retypePassword}
              onChange={(e) => setRetypePassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              disabled={loading}
            />
          </label>
          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? "Updating…" : "Set password"}
          </button>
        </form>
      </div>
    </div>
  );
}
