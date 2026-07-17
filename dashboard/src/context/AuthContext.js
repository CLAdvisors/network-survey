import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios'

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);

  // Check authentication status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await api.get('/check-auth', {
        credentials: 'include'
      });
      
      if (response.status === 200) {
        setUser(response.data.user);
        setMemberships(response.data.memberships || []);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        setUser(null);
        setMemberships([]);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setIsAuthenticated(false);
      setUser(null);
      setMemberships([]);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username, password) => {
    try {
      const response = await api.post('/login', { username, password });
      setIsAuthenticated(true);
      setUser(response.data.user);
      setMemberships(response.data.memberships || []);
      return true;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const logout = async () => {
    try {
      await api.post('/logout');
    } finally {
      setIsAuthenticated(false);
      setUser(null);
      setMemberships([]);
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
