import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../services/auth';
import { usersService } from '../services/users';
import type { User } from '../types/dashboard';

const Users = () => {
  const role = auth.getRole() ?? '';
  const isAdmin = useMemo(() => role === 'Administrador', [role]);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const list = await usersService.list();
      setUsers(list);
    } catch (e) {
      console.error(e);
      setError('Error cargando usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchUsers();
  }, [isAdmin]);

  const handleDelete = async (id: number) => {
    if (!isAdmin) return;
    if (!confirm('¿Eliminar este usuario?')) return;
    try {
      setError('');
      await usersService.delete(id);
      await fetchUsers();
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Usuario eliminado correctamente.' } }),
      );
    } catch (e) {
      console.error(e);
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? ((e as { response?: { data?: unknown } }).response?.data as { error?: unknown } | undefined)?.error
          : undefined;
      setError(typeof msg === 'string' && msg.trim() ? msg : 'Error al eliminar usuario');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Usuarios</h2>
          <p className="text-sm text-slate-500">Gestión de usuarios y roles del sistema.</p>
        </div>
        <Link
          to="/users/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 transition disabled:opacity-60"
          aria-disabled={!isAdmin}
          onClick={(e) => {
            if (!isAdmin) e.preventDefault();
          }}
        >
          <i className="fas fa-plus text-xs"></i>
          <span>Nuevo usuario</span>
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {!isAdmin ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No tienes permisos para acceder a esta pantalla
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">DNI</th>
                <th className="px-4 py-3">Teléfono</th>
                <th className="px-4 py-3">Dirección</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
                  </td>
                </tr>
              ) : !isAdmin ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-500 text-sm">
                    No hay usuarios registrados.
                  </td>
                </tr>
              ) : users.length > 0 ? (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600 text-xs">#{user.id}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium">{user.name}</td>
                    <td className="px-4 py-3 text-slate-700 font-mono text-xs">{user.username}</td>
                    <td className="px-4 py-3 text-slate-700">{user.email?.trim() ? user.email : '—'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {user.active === false ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          Inactivo
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Activo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{user.dni?.trim() ? user.dni : '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{user.phone?.trim() ? user.phone : '-'}</td>
                    <td className="px-4 py-3 text-slate-700 max-w-[260px] truncate" title={user.address ?? ''}>
                      {user.address?.trim() ? user.address : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link to={`/users/${user.id}/edit`}
                           className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100">
                          <i className="fas fa-pen mr-1"></i> Editar
                        </Link>
                        <button 
                          onClick={() => handleDelete(user.id)}
                          disabled={!isAdmin}
                          className="inline-flex items-center px-3 py-1.5 rounded-full border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50">
                          <i className="fas fa-trash mr-1"></i> Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-500 text-sm">
                    No hay usuarios registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Users;
