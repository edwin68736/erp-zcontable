import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { companiesService } from '../services/companies';
import { contactsService } from '../services/contacts';
import type { Company, Contact } from '../types/dashboard';

const CompanyContacts = () => {
  const params = useParams();
  const navigate = useNavigate();
  const companyId = params.companyID ? Number(params.companyID) : NaN;

  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!companyId || Number.isNaN(companyId)) return;

    const run = async () => {
      try {
        setLoading(true);
        setError('');
        const [c, list] = await Promise.all([
          companiesService.get(companyId),
          contactsService.listByCompany(companyId),
        ]);
        setCompany(c);
        setContacts(list);
      } catch (e) {
        console.error(e);
        setError('Error al cargar contactos');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [companyId]);

  const handleDelete = async (id: number) => {
    if (!companyId || Number.isNaN(companyId)) return;
    if (!confirm('¿Eliminar este contacto?')) return;

    try {
      await contactsService.delete(companyId, id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Contacto eliminado correctamente.' } }),
      );
    } catch (e) {
      console.error(e);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al eliminar contacto' } }),
      );
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Empresa no encontrada'}
        </div>
        <button
          type="button"
          onClick={() => navigate('/companies')}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver a empresas
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Empresa</p>
          <h2 className="text-xl font-semibold text-slate-800">{company.business_name}</h2>
          <p className="text-sm text-slate-500">Contactos responsables para la comunicación con el estudio.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/companies"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <i className="fas fa-arrow-left text-xs"></i> Volver a empresas
          </Link>
          <Link
            to={`/companies/${company.id}/contacts/new`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 transition"
          >
            <i className="fas fa-plus text-xs"></i>
            <span>Nuevo contacto</span>
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Cargo</th>
                <th className="px-4 py-3">Teléfono</th>
                <th className="px-4 py-3">Correo</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contacts.length > 0 ? (
                contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{c.full_name}</td>
                    <td className="px-4 py-3 text-slate-700">{c.position}</td>
                    <td className="px-4 py-3 text-slate-700">{c.phone}</td>
                    <td className="px-4 py-3 text-slate-700">{c.email}</td>
                    <td className="px-4 py-3 text-slate-700">{c.priority}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/companies/${company.id}/contacts/${c.id}/edit`}
                          className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <i className="fas fa-pen mr-1"></i> Editar
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          className="inline-flex items-center px-3 py-1.5 rounded-full border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <i className="fas fa-trash mr-1"></i> Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500 text-sm">
                    No hay contactos registrados para esta empresa.
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

export default CompanyContacts;
