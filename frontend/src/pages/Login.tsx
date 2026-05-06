import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../services/auth';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await auth.login(username.trim(), password);
      navigate('/dashboard');
    } catch (err: unknown) {
      console.error(err);
      const ax = err as { response?: { data?: { error?: string } } };
      setError(ax.response?.data?.error || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans text-slate-800 bg-[url('/login.png')] bg-cover bg-center bg-no-repeat">
      <div className="w-full max-w-lg">
        <div className="shadow-sm p-1">
          <div className="bg-white rounded-[1.75rem] shadow-xl px-8 py-10 border border-slate-100">
            <div className="text-center mb-8">
              <img
                src="/logo_login.png"
                alt="ZContable"
                className="mx-auto mb-5 h-8 w-auto max-w-full object-contain"
              />
              <p className="text-slate-500 text-sm">Inicia sesión para continuar</p>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm text-left">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
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
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition shadow-inner"
                  placeholder="Su nombre de usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  required
                  autoComplete="current-password"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition shadow-inner"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-full transition shadow-lg shadow-emerald-800/20 focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 text-sm disabled:opacity-70"
              >
                {loading ? 'Iniciando sesión...' : 'Entrar al panel'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
