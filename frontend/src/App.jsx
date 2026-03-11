import { Routes, Route, Navigate } from "react-router-dom";
import "./App.css";
import LoginPage from "./pages/LoginPage.jsx";
import SignupPage from "./pages/SignupPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AgreementsPage from "./pages/AgreementsPage.jsx";
import NewAgreementPage from "./pages/NewAgreementPage.jsx";
import DocumentDetailPage from "./pages/DocumentDetailPage.jsx";
import TemplatesPage from "./pages/TemplatesPage.jsx";
import TemplateViewPage from "./pages/TemplateViewPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import SigningPage from "./pages/SigningPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import UserRequestsPage from "./pages/UserRequestsPage.jsx";
import ForceChangePasswordModal from "./components/ForceChangePasswordModal.jsx";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";

function PrivateRoute({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <div className="auth-loading" aria-label="Loading">
        <span>Loading…</span>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AdminRoute({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <div className="auth-loading" aria-label="Loading">
        <span>Loading…</span>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!Array.isArray(user.roles) || !user.roles.includes("admin")) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function AppContent() {
  const { user } = useAuth();
  if (user && user.mustChangePassword) {
    return (
      <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
        <ForceChangePasswordModal />
      </div>
    );
  }
  return <AppRoutes />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <DashboardPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/agreements"
        element={
          <PrivateRoute>
            <AgreementsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/templates"
        element={
          <PrivateRoute>
            <TemplatesPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/templates/:id"
        element={
          <PrivateRoute>
            <TemplateViewPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/documents/new"
        element={
          <PrivateRoute>
            <NewAgreementPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/documents/:id"
        element={
          <PrivateRoute>
            <DocumentDetailPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <PrivateRoute>
            <ProfilePage />
          </PrivateRoute>
        }
      />
      <Route
        path="/users"
        element={
          <AdminRoute>
            <UsersPage />
          </AdminRoute>
        }
      />
      <Route
        path="/user-requests"
        element={
          <AdminRoute>
            <UserRequestsPage />
          </AdminRoute>
        }
      />
      <Route path="/sign/:token" element={<SigningPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
