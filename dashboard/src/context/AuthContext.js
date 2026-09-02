import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios'

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [authSessionRevision, setAuthSessionRevision] = useState(0);
  const authGeneration = React.useRef(0);
  const pendingLogout = React.useRef(null);

  // Check authentication status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const generation = ++authGeneration.current;
    try {
      const response = await api.get('/check-auth', { credentials: 'include' });
      if (generation !== authGeneration.current) return false;
      if (response.status === 200) {
        setUser(response.data.user);
        setMemberships(response.data.memberships || []);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        setUser(null);
        setMemberships([]);
      }
      setAuthSessionRevision((value) => value + 1);
      return response.status === 200;
    } catch (error) {
      if (generation !== authGeneration.current) return false;
      console.error('Auth check failed:', error);
      setIsAuthenticated(false);
      setUser(null);
      setMemberships([]);
      setAuthSessionRevision((value) => value + 1);
      return false;
    } finally {
      if (generation === authGeneration.current) setIsLoading(false);
    }
  };

  const login = async (username, password) => {
    const generation = ++authGeneration.current;
    try {
      await pendingLogout.current?.catch(() => {});
      if (generation !== authGeneration.current) return false;
      const response = await api.post('/login', { username, password });
      if (generation !== authGeneration.current) return false;
      setIsAuthenticated(true);
      setUser(response.data.user);
      setMemberships(response.data.memberships || []);
      setAuthSessionRevision((value) => value + 1);
      return true;
    } catch (error) {
      if (generation === authGeneration.current) console.error('Login error:', error);
      return false;
    }
  };

  const logout = async () => {
    if (pendingLogout.current) return pendingLogout.current;
    const generation = ++authGeneration.current;
    setIsAuthenticated(false);
    setUser(null);
    setMemberships([]);
    setAuthSessionRevision((value) => value + 1);
    const request = api.post('/logout');
    pendingLogout.current = request;
    try {
      await request;
    } catch (error) {
      if (generation === authGeneration.current) console.error('Logout error:', error);
    } finally {
      if (pendingLogout.current === request) pendingLogout.current = null;
    }
  };

  const roleRank = React.useMemo(() => ({ viewer: 10, analyst: 20, editor: 30, admin: 40, owner: 50 }), []);
  const hasSurveyRole = React.useCallback((survey, minimumRole) => {
    if (user?.isPlatformAdmin) return true;
    return (roleRank[survey?.role] || 0) >= (roleRank[minimumRole] || 0);
  }, [user?.isPlatformAdmin, roleRank]);
  const canViewSensitiveSurveyData = React.useCallback((survey) => hasSurveyRole(survey, 'analyst'), [hasSurveyRole]);
  const canEditSurvey = React.useCallback((survey) => hasSurveyRole(survey, 'editor'), [hasSurveyRole]);
  const canArchiveSurvey = React.useCallback((survey) => hasSurveyRole(survey, 'admin'), [hasSurveyRole]);

  return (
    <AuthContext.Provider 
      value={{ 
        isAuthenticated, 
        isLoading, 
        user,
        memberships,
        authSessionRevision,
        hasSurveyRole,
        canViewSensitiveSurveyData,
        canEditSurvey,
        canArchiveSurvey,
        login, 
        logout 
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
