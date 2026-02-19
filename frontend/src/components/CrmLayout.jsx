import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { getProfileImageUrl } from '../api/client';

export default function CrmLayout({ children, shellClassName = '' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/', label: 'Dashboard' },
    { to: '/documents/new', label: 'New document' },
  ];

  return (
    <div className={`crm-shell ${shellClassName}`.trim()}>
      <aside className="crm-sidebar">
        <div className="crm-brand">
          <span className="logo-mark" aria-hidden="true">
            ✦
          </span>
          <div>
            <span className="logo-text">Collings eSign</span>
            <span className="logo-subtitle">Workspace</span>
          </div>
        </div>

        <nav className="crm-nav" aria-label="Primary">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`crm-nav-link ${active ? 'active' : ''}`.trim()}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="crm-sidebar-footer">
          <div className="user-chip">
            <span className="user-avatar">
              {getProfileImageUrl(user?.profileImageUrl) ? (
                <img src={getProfileImageUrl(user.profileImageUrl)} alt="" className="user-avatar-img" />
              ) : (
                user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'
              )}
            </span>
            <div className="user-meta">
              <span className="user-name">{user?.name || 'User'}</span>
              <span className="user-email">{user?.email}</span>
            </div>
          </div>
          <button className="secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>

      <div className="crm-content">
        <main className="crm-main">{children}</main>
      </div>
    </div>
  );
}
