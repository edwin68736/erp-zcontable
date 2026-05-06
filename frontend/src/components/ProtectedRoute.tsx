import { Navigate, Outlet } from 'react-router-dom';
import { auth } from '../services/auth';

const ProtectedRoute = () => {
  const token = auth.getToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};

export default ProtectedRoute;
