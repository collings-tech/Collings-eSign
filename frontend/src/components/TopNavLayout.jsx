import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { getProfileImageUrl } from "../api/client";
import collingsLogo from "../assets/collings-logo-1.png";

export default function TopNavLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  useEffect(() => {
    if (sidebarOpen) document.body.classList.add("top-sidebar-open");
    else document.body.classList.remove("top-sidebar-open");
    return () => document.body.classList.remove("top-sidebar-open");
  }, [sidebarOpen]);

  const handleLogout = () => {
    setUserMenuOpen(false);
    setSidebarOpen(false);
    logout();
    navigate("/login");
  };

  const closeSidebar = () => setSidebarOpen(false);

  const path = location.pathname;
  const isHome = path === "/";
  const isAgreements =
    path.startsWith("/agreements") || path.startsWith("/documents/");
  const isTemplates = path.startsWith("/templates");

  const navLinks = (
    <>
      <Link to="/" className={`top-nav-link ${isHome ? "active" : ""}`.trim()} onClick={closeSidebar}>
        Home
      </Link>
      <Link to="/agreements" className={`top-nav-link ${isAgreements ? "active" : ""}`.trim()} onClick={closeSidebar}>
        Agreements
      </Link>
      <Link to="/templates" className={`top-nav-link ${isTemplates ? "active" : ""}`.trim()} onClick={closeSidebar}>
        Templates
      </Link>
      <span className="top-nav-link muted-link" aria-current="false">Reports</span>
    </>
  );

  return (
    <div className="top-shell">
      <header className="top-header">
        <div className="top-header-left">
          <button
            type="button"
            className="top-header-hamburger"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <span className="top-header-hamburger-icon" aria-hidden>☰</span>
          </button>
          <Link to="/" className="top-brand">
            <span className="top-brand-text">
              <img src={collingsLogo} alt="Collings" className="top-brand-logo" />
              <span className="top-brand-esign">eSign</span>
            </span>
          </Link>
          <nav className="top-nav" aria-label="Primary">
            {navLinks}
          </nav>
        </div>

        <div className="top-header-right" ref={userMenuRef}>
          <button
            type="button"
            className="top-header-user-trigger"
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
            aria-label="User menu"
          >
            <span className="user-avatar">
              {getProfileImageUrl(user?.profileImageUrl) ? (
                <img src={getProfileImageUrl(user.profileImageUrl)} alt="" className="user-avatar-img" />
              ) : (
                user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?"
              )}
            </span>
            <div className="user-meta">
              <span className="user-name">{user?.name || "User"}</span>
              <span className="user-email">{user?.email}</span>
            </div>
          </button>

          {userMenuOpen && (
            <div className="top-header-user-menu" role="menu">
              <div className="top-header-user-menu-head">
                <div className="top-header-user-menu-name">{user?.name || "User"}</div>
                <div className="top-header-user-menu-email">{user?.email}</div>
                <Link
                  to="/profile"
                  className="top-header-user-menu-manage"
                  aria-label="Manage profile"
                  onClick={() => setUserMenuOpen(false)}
                >
                  Manage Profile
                </Link>
              </div>
              <div className="top-header-user-menu-sep" aria-hidden="true" />
              <div className="top-header-user-menu-links" role="none">
                <span className="top-header-user-menu-link muted-link" role="menuitem" tabIndex={0}>My Preferences</span>
                <button type="button" className="top-header-user-menu-link top-header-user-menu-logout" role="menuitem" onClick={handleLogout}>
                  Log Out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Sidebar overlay (mobile) */}
      <div
        className="top-sidebar-backdrop"
        aria-hidden={!sidebarOpen}
        onClick={closeSidebar}
      />
      <aside className="top-sidebar" aria-label="Main menu">
        <div className="top-sidebar-header">
          <Link to="/" className="top-sidebar-brand" onClick={closeSidebar}>
            <span className="top-brand-text">
              <img src={collingsLogo} alt="Collings" className="top-brand-logo" />
              <span className="top-brand-esign">eSign</span>
            </span>
          </Link>
        </div>
        <nav className="top-sidebar-nav" aria-label="Primary">
          {navLinks}
        </nav>
        <div className="top-sidebar-footer">
          <div className="top-sidebar-user">
            <span className="user-avatar">
              {getProfileImageUrl(user?.profileImageUrl) ? (
                <img src={getProfileImageUrl(user.profileImageUrl)} alt="" className="user-avatar-img" />
              ) : (
                user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?"
              )}
            </span>
            <div className="user-meta">
              <span className="user-name">{user?.name || "User"}</span>
              <span className="user-email">{user?.email}</span>
            </div>
          </div>
          <button type="button" className="top-sidebar-logout" onClick={handleLogout}>
            Log Out
          </button>
        </div>
      </aside>

      <main className="top-main">{children}</main>
    </div>
  );
}
