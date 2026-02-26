import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { useAuth } from "../auth/AuthContext.jsx";
import { apiClient, getProfileImageUrl } from "../api/client";
import TopNavLayout from "../components/TopNavLayout.jsx";

/** Create a circular cropped image blob from image URL and crop area (from react-easy-crop). */
async function getCroppedImgCircle(imageSrc, pixelCrop) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });
  const size = Math.min(pixelCrop.width, pixelCrop.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, size, size
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))), "image/jpeg", 0.92);
  });
}

const PROFILE_NAV = [
  { id: "profile", label: "My Profile" },
  { id: "privacy", label: "Privacy & Security" },
  { id: "connected", label: "Connected Apps" },
  { id: "identity", label: "Identity Wallet" },
  { id: "signatures", label: "Signatures" },
  { id: "stamps", label: "Stamps" },
  { id: "language", label: "Language & Region" },
];

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [selectedSection, setSelectedSection] = useState("profile");
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [editingName, setEditingName] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  // Password change (Privacy & Security)
  const [passwordStep, setPasswordStep] = useState("verify"); // 'verify' | 'change'
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // OTP verification modal
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [otpStep, setOtpStep] = useState("send"); // 'send' | 'verify'
  const [otpValue, setOtpValue] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(null); // { type: 'name' | 'email' }

  // Profile photo upload modal
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const fileInputRef = useRef(null);

  const onCropComplete = useCallback((_croppedArea, pixels) => {
    setCroppedAreaPixels(pixels);
  }, []);

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setEmail(user.email ?? "");
    }
  }, [user]);

  const openOtpModal = (type) => {
    setPendingUpdate({ type });
    setOtpStep("send");
    setOtpValue("");
    setOtpModalOpen(true);
    setMessage({ type: "", text: "" });
  };

  const closeOtpModal = () => {
    setOtpModalOpen(false);
    setPendingUpdate(null);
    setOtpStep("send");
    setOtpValue("");
  };

  const handleSendOtp = async () => {
    setSendingOtp(true);
    setMessage({ type: "", text: "" });
    try {
      await apiClient.post("/auth/send-profile-otp");
      setOtpStep("verify");
      setMessage({ type: "success", text: "Verification code sent to your email." });
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Failed to send code." });
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyAndUpdate = async (e) => {
    e.preventDefault();
    if (!pendingUpdate || !otpValue.trim()) return;
    setVerifying(true);
    setMessage({ type: "", text: "" });
    try {
      const body = { otp: otpValue.trim() };
      if (pendingUpdate.type === "name") body.name = name.trim();
      if (pendingUpdate.type === "email") body.email = email.trim();
      const { data } = await apiClient.post("/auth/verify-profile-update", body);
      updateUser(data.user);
      closeOtpModal();
      if (pendingUpdate.type === "name") setEditingName(false);
      if (pendingUpdate.type === "email") setEditingEmail(false);
      setMessage({ type: "success", text: pendingUpdate.type === "name" ? "Name updated." : "Email updated." });
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Invalid or expired code." });
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveName = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setMessage({ type: "", text: "" });
    if (name.trim() === (user?.name ?? "")) {
      setEditingName(false);
      return;
    }
    openOtpModal("name");
  };

  const handleSaveEmail = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setMessage({ type: "", text: "" });
    if (email.trim() === (user?.email ?? "")) {
      setEditingEmail(false);
      return;
    }
    openOtpModal("email");
  };

  const handleVerifyPassword = async (e) => {
    e?.preventDefault();
    if (!currentPassword.trim()) {
      setMessage({ type: "error", text: "Enter your current password." });
      return;
    }
    setMessage({ type: "", text: "" });
    setVerifyingPassword(true);
    try {
      await apiClient.post("/auth/verify-password", { currentPassword: currentPassword.trim() });
      setPasswordStep("change");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: "Current password verified. Enter your new password." });
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Current password is incorrect." });
    } finally {
      setVerifyingPassword(false);
    }
  };

  const handleChangePassword = async (e) => {
    e?.preventDefault();
    setMessage({ type: "", text: "" });
    if (!newPassword.trim()) {
      setMessage({ type: "error", text: "Enter a new password." });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "New password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New password and confirmation do not match." });
      return;
    }
    setChangingPassword(true);
    try {
      await apiClient.post("/auth/change-password", {
        currentPassword: currentPassword.trim(),
        newPassword: newPassword.trim(),
      });
      setPasswordStep("verify");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: "Password updated successfully." });
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Failed to update password." });
    } finally {
      setChangingPassword(false);
    }
  };

  const resetPasswordForm = () => {
    setPasswordStep("verify");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const openPhotoModal = () => {
    setPhotoModalOpen(true);
    setSelectedFile(null);
    setPhotoPreview(null);
    setCropZoom(1);
    setCropPosition({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
    setPhotoError("");
  };

  const closePhotoModal = () => {
    setPhotoModalOpen(false);
    setSelectedFile(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCroppedAreaPixels(null);
    setPhotoError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePhotoFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(file.type)) {
      setPhotoError("Please choose a JPEG, PNG, GIF, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("Image must be 5MB or smaller.");
      return;
    }
    setPhotoError("");
    setSelectedFile(file);
    setCropZoom(1);
    setCropPosition({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const handlePhotoDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) handlePhotoFileChange({ target: { files: [file] } });
  };

  const handlePhotoDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSavePhoto = async () => {
    if (!selectedFile || !photoPreview) {
      setPhotoError("Please choose an image first.");
      return;
    }
    if (!croppedAreaPixels) {
      setPhotoError("Please position the crop, then save.");
      return;
    }
    setUploadingPhoto(true);
    setPhotoError("");
    try {
      const blob = await getCroppedImgCircle(photoPreview, croppedAreaPixels);
      const file = new File([blob], selectedFile.name.replace(/\.[^.]+$/, ".jpg") || "photo.jpg", { type: "image/jpeg" });
      const formData = new FormData();
      formData.append("photo", file);
      const token = localStorage.getItem("auth_token");
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const { data } = await apiClient.post("/auth/upload-profile-photo", formData, {
        headers,
      });
      updateUser(data.user);
      closePhotoModal();
      setMessage({ type: "success", text: "Profile photo updated." });
    } catch (err) {
      const msg = err.response?.status === 401
        ? "Please log in again and try again."
        : (err.response?.data?.error || "Upload failed. Try again.");
      setPhotoError(msg);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const profileImageUrl = getProfileImageUrl(user?.profileImageUrl);

  return (
    <TopNavLayout>
      <div className="profile-page">
        <div className="profile-body">
        <nav className="profile-sidebar" aria-label="Profile settings">
          <ul className="profile-nav-list">
            {PROFILE_NAV.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`profile-nav-link ${selectedSection === item.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedSection(item.id);
                    setMessage({ type: "", text: "" });
                    if (item.id !== "privacy") resetPasswordForm();
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="profile-main">
          {selectedSection === "profile" && (
            <>
              <h1 className="profile-title">My Profile</h1>
              <p className="profile-subtitle">
                Manage your personal profile information to control what details are
                shared with other Collings eSign users.
              </p>
            </>
          )}
          {selectedSection === "privacy" && (
            <>
              <h1 className="profile-title">Privacy & Security</h1>
              <p className="profile-subtitle">
                Manage your security settings and change your password.
              </p>
            </>
          )}
          {selectedSection !== "profile" && selectedSection !== "privacy" && (
            <>
              <h1 className="profile-title">{PROFILE_NAV.find((n) => n.id === selectedSection)?.label || selectedSection}</h1>
              <p className="profile-subtitle">Coming soon.</p>
            </>
          )}

          {message.text && (
            <div className={`profile-flash profile-flash-${message.type}`}>
              {message.text}
            </div>
          )}

          {selectedSection === "profile" && (
          <div className="profile-sections">
            <section className="profile-section">
              <div className="profile-section-head">
                <h2 className="profile-section-label">Profile Image</h2>
                <button type="button" className="profile-btn-update" onClick={openPhotoModal}>
                  UPDATE
                </button>
              </div>
              <div className="profile-section-row">
                {profileImageUrl ? (
                  <img src={profileImageUrl} alt="" className="profile-avatar-img" />
                ) : (
                  <div className="profile-avatar-placeholder" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>
                )}
              </div>
            </section>

            <section className="profile-section">
              <div className="profile-section-head">
                <h2 className="profile-section-label">Name</h2>
                {!editingName ? (
                  <button
                    type="button"
                    className="profile-btn-update"
                    onClick={() => setEditingName(true)}
                  >
                    UPDATE
                  </button>
                ) : (
                  <span className="profile-edit-actions">
                    <button
                      type="button"
                      className="profile-btn-cancel"
                      onClick={() => { setEditingName(false); setName(user?.name ?? ""); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="profile-btn-save"
                      onClick={handleSaveName}
                    >
                      Save
                    </button>
                  </span>
                )}
              </div>
              <div className="profile-section-row">
                {editingName ? (
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(e); }}
                    className="profile-input"
                    placeholder="Your name"
                    autoFocus
                  />
                ) : (
                  <span className="profile-value">{user?.name || "—"}</span>
                )}
              </div>
            </section>

            <section className="profile-section">
              <div className="profile-section-head">
                <h2 className="profile-section-label">Email Address</h2>
                {/* {!editingEmail ? (
                  <button
                    type="button"
                    className="profile-btn-update"
                    onClick={() => setEditingEmail(true)}
                  >
                    UPDATE
                  </button>
                ) : (
                  <span className="profile-edit-actions">
                    <button
                      type="button"
                      className="profile-btn-cancel"
                      onClick={() => { setEditingEmail(false); setEmail(user?.email ?? ""); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="profile-btn-save"
                      onClick={handleSaveEmail}
                    >
                      Save
                    </button>
                  </span>
                )} */}
              </div>
              <div className="profile-section-row">
                {editingEmail ? (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="profile-input"
                    placeholder="you@example.com"
                    autoFocus
                  />
                ) : (
                  <span className="profile-value">{user?.email || "—"}</span>
                )}
              </div>
            </section>
          </div>
          )}

          {selectedSection === "privacy" && (
            <div className="profile-sections">
              <section className="profile-section">
                <div className="profile-section-head">
                  <h2 className="profile-section-label">Password</h2>
                </div>
                <div className="profile-section-row">
                  {passwordStep === "verify" ? (
                    <form onSubmit={handleVerifyPassword} className="profile-password-form">
                      <p className="profile-password-hint">Enter your current password to verify your identity, then you can set a new password.</p>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="profile-input"
                        placeholder="Current password"
                        autoComplete="current-password"
                        aria-label="Current password"
                      />
                      <div className="profile-edit-actions" style={{ marginTop: "0.75rem" }}>
                        <button
                          type="submit"
                          className="profile-btn-save"
                          disabled={verifyingPassword || !currentPassword.trim()}
                        >
                          {verifyingPassword ? "Verifying…" : "Verify"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={handleChangePassword} className="profile-password-form">
                      <p className="profile-password-hint">Enter your new password and confirm it.</p>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="profile-input"
                        placeholder="New password"
                        autoComplete="new-password"
                        aria-label="New password"
                        style={{ marginBottom: "0.5rem" }}
                      />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="profile-input"
                        placeholder="Confirm new password"
                        autoComplete="new-password"
                        aria-label="Confirm new password"
                      />
                      <div className="profile-edit-actions" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
                        <button
                          type="button"
                          className="profile-btn-cancel"
                          onClick={resetPasswordForm}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="profile-btn-save"
                          disabled={changingPassword || !newPassword.trim() || newPassword !== confirmPassword}
                        >
                          {changingPassword ? "Updating…" : "Change password"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {/* Update Profile Photo modal */}
      {photoModalOpen &&
        createPortal(
          <div
            className="profile-otp-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-modal-title"
            onClick={closePhotoModal}
          >
            <div className="profile-photo-modal" onClick={(e) => e.stopPropagation()}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handlePhotoFileChange}
                className="profile-photo-file-input"
                aria-label="Choose profile photo"
              />
              <div className="profile-photo-modal-head">
                <h2 id="photo-modal-title" className="profile-otp-modal-title">
                  Update Profile Photo
                </h2>
                <button type="button" className="profile-photo-modal-close" onClick={closePhotoModal} aria-label="Close">
                  <i className="lni lni-xmark" aria-hidden />
                </button>
              </div>
              {photoPreview ? (
                <>
                  <div className="profile-photo-crop-wrap">
                    <Cropper
                      image={photoPreview}
                      crop={cropPosition}
                      zoom={cropZoom}
                      aspect={1}
                      cropShape="round"
                      showGrid={false}
                      onCropChange={setCropPosition}
                      onZoomChange={setCropZoom}
                      onCropComplete={onCropComplete}
                    />
                  </div>
                  <div className="profile-photo-zoom-row">
                    <span className="profile-photo-zoom-icon" aria-hidden="true">−</span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.1}
                      value={cropZoom}
                      onChange={(e) => setCropZoom(Number(e.target.value))}
                      className="profile-photo-zoom-slider"
                      aria-label="Zoom"
                    />
                    <span className="profile-photo-zoom-icon" aria-hidden="true">+</span>
                  </div>
                  <button type="button" className="profile-photo-browse profile-photo-change" onClick={() => { setPhotoPreview((p) => { if (p) URL.revokeObjectURL(p); return null; }); setSelectedFile(null); setCroppedAreaPixels(null); fileInputRef.current?.click(); }}>
                    BROWSE (choose different)
                  </button>
                </>
              ) : (
                <div
                  className="profile-photo-dropzone"
                  onDrop={handlePhotoDrop}
                  onDragOver={handlePhotoDragOver}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="profile-photo-dropzone-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>
                  <span className="profile-photo-dropzone-text">Drop your files here</span>
                  <button type="button" className="profile-photo-browse">BROWSE</button>
                </div>
              )}
              {photoError && <div className="profile-flash profile-flash-error">{photoError}</div>}
              <div className="profile-otp-modal-actions">
                <button type="button" className="profile-btn-cancel" onClick={closePhotoModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="profile-btn-save"
                  onClick={handleSavePhoto}
                  disabled={uploadingPhoto || !selectedFile || !croppedAreaPixels}
                >
                  {uploadingPhoto ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* OTP verification modal – rendered in portal so it always appears on top */}
      {otpModalOpen &&
        createPortal(
          <div
            className="profile-otp-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="otp-modal-title"
            onClick={closeOtpModal}
          >
            <div className="profile-otp-modal" onClick={(e) => e.stopPropagation()}>
              <h2 id="otp-modal-title" className="profile-otp-modal-title">
                Verify your email
              </h2>
              {otpStep === "send" ? (
                <>
                  <p className="profile-otp-modal-text">
                    We&apos;ll send a 6-digit verification code to <strong>{user?.email}</strong>. Enter it in the next step to update your {pendingUpdate?.type === "name" ? "name" : "email"}.
                  </p>
                  {message.text && (
                    <div className={`profile-flash profile-flash-${message.type}`}>{message.text}</div>
                  )}
                  <div className="profile-otp-modal-actions">
                    <button type="button" className="profile-btn-cancel" onClick={closeOtpModal}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="profile-btn-save"
                      onClick={handleSendOtp}
                      disabled={sendingOtp}
                    >
                      {sendingOtp ? "Sending…" : "Send code"}
                    </button>
                  </div>
                </>
              ) : (
                <form onSubmit={handleVerifyAndUpdate}>
                  <p className="profile-otp-modal-text">
                    Enter the 6-digit code we sent to <strong>{user?.email}</strong>.
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={otpValue}
                    onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, ""))}
                    className="profile-otp-input"
                    autoFocus
                    aria-label="Verification code"
                  />
                  {message.text && (
                    <div className={`profile-flash profile-flash-${message.type}`}>{message.text}</div>
                  )}
                  <div className="profile-otp-modal-actions">
                    <button type="button" className="profile-btn-cancel" onClick={() => setOtpStep("send")}>
                      Back
                    </button>
                    <button
                      type="submit"
                      className="profile-btn-save"
                      disabled={verifying || otpValue.length !== 6}
                    >
                      {verifying ? "Verifying…" : "Verify and update"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body
        )}

        <footer className="profile-footer">
          <div className="profile-footer-inner">
            <span className="profile-footer-powered">Powered by Collings</span>
            {/* <nav className="profile-footer-links" aria-label="Footer links">
              <a href="#contact">Contact Us</a>
              <a href="#terms">Terms of Use</a>
              <a href="#privacy">Privacy</a>
              <a href="#ip">Intellectual Property</a>
              <a href="#trust">Trust</a>
            </nav> */}
            <p className="profile-footer-copy">
              Copyright © {new Date().getFullYear()} Collings, Inc. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </TopNavLayout>
  );
}
