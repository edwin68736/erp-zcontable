import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { auth } from '../services/auth';
import { usersService, type UserUpsertInput } from '../services/users';
import SearchableSelect from '../components/SearchableSelect';

function getErrorMessage(e: unknown): string {
  if (!e || typeof e !== 'object') return 'Error al guardar el usuario';
  if (!('response' in e)) return 'Error al guardar el usuario';
  const maybe = e as { response?: { data?: unknown } };
  const data = maybe.response?.data;
  if (data && typeof data === 'object' && 'error' in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return 'Error al guardar el usuario';
}

/** Misma lógica que el backend (12 caracteres por defecto). */
function generateRandomPassword(length = 12): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (x) => chars[x % chars.length]).join('');
}

const UserForm = () => {
  const navigate = useNavigate();
  const params = useParams();
  const userId = params.id ? Number(params.id) : null;
  const isEdit = Boolean(userId);

  const role = auth.getRole() ?? '';
  const isAdmin = useMemo(() => role === 'Administrador', [role]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userRole, setUserRole] = useState('Asistente');
  const [active, setActive] = useState(true);
  const [dni, setDni] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const passwordAutoManaged = useRef(true);
  const usernameHadContentRef = useRef(false);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError('');

        if (isEdit && userId) {
          const u = await usersService.get(userId);
          setUsername(u.username ?? '');
          setName(u.name ?? '');
          setEmail(u.email ?? '');
          setUserRole(u.role ?? 'Asistente');
          setActive(Boolean(u.active ?? true));
          setDni(u.dni ?? '');
          setPhone(u.phone ?? '');
          setAddress(u.address ?? '');
          setPassword('');
          passwordAutoManaged.current = false;
          usernameHadContentRef.current = true;
        } else {
          setPassword('');
          passwordAutoManaged.current = true;
          usernameHadContentRef.current = false;
        }
      } catch (e) {
        console.error(e);
        setError('Error al cargar el usuario');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [isEdit, userId]);

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    if (isEdit) return;
    const t = value.trim();
    if (t.length === 0) {
      usernameHadContentRef.current = false;
      if (passwordAutoManaged.current) setPassword('');
      return;
    }
    if (!usernameHadContentRef.current && passwordAutoManaged.current) {
      setPassword(generateRandomPassword(12));
    }
    usernameHadContentRef.current = true;
  };

  const handleGenerarPassword = () => {
    setPassword(generateRandomPassword(12));
    passwordAutoManaged.current = true;
    if (!isEdit) usernameHadContentRef.current = true;
  };

  const handlePasswordChange = (value: string) => {
    passwordAutoManaged.current = false;
    setPassword(value);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAdmin) {
      setError('No tienes permisos para realizar esta acción');
      return;
    }
    if (!username.trim()) {
      setError('El usuario es requerido');
      return;
    }
    if (!name.trim()) {
      setError('El nombre es requerido');
      return;
    }
    if (!isEdit) {
      if (password.trim().length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres (use Generar o escriba una)');
        return;
      }
    }

    const payload: UserUpsertInput = {
      username: username.trim(),
      name: name.trim(),
      email: email.trim() || undefined,
      role: userRole,
      password: isEdit ? (password.trim() ? password : undefined) : password.trim(),
      active,
      dni: dni.trim(),
      phone: phone.trim(),
      address: address.trim(),
    };

    try {
      setSaving(true);
      setError('');
      if (isEdit && userId) {
        await usersService.update(userId, payload);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'success', message: 'Usuario actualizado correctamente.' },
          }),
        );
      } else {
        await usersService.create(payload);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'success', message: 'Usuario creado correctamente.' },
          }),
        );
      }
      navigate('/users', { replace: true });
    } catch (e2) {
      console.error(e2);
      setError(getErrorMessage(e2));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto w-full space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-5xl mx-auto w-full space-y-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No tienes permisos para acceder a esta pantalla
        </div>
        <Link
          to="/users"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver al listado
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">{isEdit ? 'Editar usuario' : 'Nuevo usuario'}</h2>
          <p className="text-sm text-slate-500">Define los datos de acceso y el rol del usuario.</p>
        </div>
        <Link
          to="/users"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver al listado
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-1">
              Usuario
            </label>
            <input
              type="text"
              id="username"
              name="username"
              required
              autoComplete="username"
              value={username}
              onChange={(ev) => handleUsernameChange(ev.target.value)}
              placeholder="3-32 caracteres: letras, números, . _ -"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
              Nombre completo
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Contraseña
            </label>
            <div className="flex rounded-lg border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
              <input
                type="text"
                id="password"
                name="password"
                autoComplete="new-password"
                value={password}
                onChange={(ev) => handlePasswordChange(ev.target.value)}
                placeholder={isEdit ? 'Vacío = no cambiar' : 'Se genera al escribir el usuario o con Generar'}
                className="flex-1 min-w-0 px-3 py-2.5 border-0 text-sm outline-none bg-white font-mono"
              />
              <button
                type="button"
                onClick={handleGenerarPassword}
                className="shrink-0 px-3 py-2 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border-l border-slate-200"
              >
                Generar
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="role" className="block text-sm font-medium text-slate-700 mb-1">
              Rol
            </label>
            <SearchableSelect
              id="role"
              name="role"
              value={userRole}
              onChange={setUserRole}
              options={[
                { value: 'Administrador', label: 'Administrador' },
                { value: 'Supervisor', label: 'Supervisor' },
                { value: 'Contador', label: 'Contador' },
                { value: 'Asistente', label: 'Asistente' },
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div>
            <label htmlFor="active" className="block text-sm font-medium text-slate-700 mb-1">
              Estado
            </label>
            <select
              id="active"
              name="active"
              value={active ? '1' : '0'}
              onChange={(ev) => setActive(ev.target.value === '1')}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
            >
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </select>
          </div>

          <div>
            <label htmlFor="dni" className="block text-sm font-medium text-slate-700 mb-1">
              DNI
            </label>
            <input
              type="text"
              id="dni"
              name="dni"
              value={dni}
              onChange={(ev) => setDni(ev.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
              Teléfono
            </label>
            <input
              type="text"
              id="phone"
              name="phone"
              value={phone}
              onChange={(ev) => setPhone(ev.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="address" className="block text-sm font-medium text-slate-700 mb-1">
            Dirección
          </label>
          <input
            type="text"
            id="address"
            name="address"
            value={address}
            onChange={(ev) => setAddress(ev.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>

        <div className="border-t border-slate-200 pt-5">
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
            Correo electrónico <span className="text-slate-400 font-normal">(opcional)</span>
          </label>
          <input
            type="email"
            id="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            className="w-full max-w-xl px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 disabled:opacity-60"
          >
            <i className="fas fa-save mr-2 text-xs"></i>
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default UserForm;
