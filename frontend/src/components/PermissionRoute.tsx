import { Navigate, Outlet } from 'react-router-dom';
import { auth } from '../services/auth';

type Props = {
  permission: string;
  redirectTo?: string;
};

/** Bloquea rutas por permiso real (no solo ocultar menú). */
const PermissionRoute = ({ permission, redirectTo = '/pos' }: Props) => {
  if (!auth.hasPermission(permission)) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Outlet />;
};

export default PermissionRoute;
