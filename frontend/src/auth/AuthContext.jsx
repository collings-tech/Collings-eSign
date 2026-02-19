import { createContext, useContext, useEffect, useState } from 'react';
import { apiClient, setAuthToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      setAuthToken(token);
      apiClient
        .get('/auth/me')
        .then((res) => {
          setUser(res.data.user);
        })
        .catch(() => {
          setAuthToken(null);
          localStorage.removeItem('auth_token');
        })
        .finally(() => setInitializing(false));
    } else {
      setInitializing(false);
    }
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('auth_token', token);
    setAuthToken(token);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setAuthToken(null);
    setUser(null);
  };

  const updateUser = (userData) => {
    if (userData) setUser(userData);
  };

  const value = { user, login, logout, updateUser, initializing };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

