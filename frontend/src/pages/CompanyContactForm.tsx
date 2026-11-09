import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { companiesService } from '../services/companies';
import { contactsService, type ContactUpsertInput } from '../services/contacts';
import type { Company } from '../types/dashboard';
import SearchableSelect from '../components/SearchableSelect';
import PageHeading from '../components/ui/PageHeading';
import Alert from '../components/ui/Alert';
import { notify } from '../utils/notify';

const CompanyContactForm = () => {
  const params = useParams();
  const navigate = useNavigate();
  const companyId = params.companyID ? Number(params.companyID) : NaN;
  const contactId = params.id ? Number(params.id) : null;
  const isEdit = Boolean(contactId);

  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState('');

  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [priority, setPriority] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!companyId || Number.isNaN(companyId)) return;

    const run = async () => {
      try {
        setLoading(true);
        setError('');
        const c = await companiesService.get(companyId);
        setCompany(c);

        if (isEdit && contactId) {
          const contact = await contactsService.get(companyId, contactId);
          setFullName(contact.full_name ?? '');
          setPosition(contact.position ?? '');
          setPriority(contact.priority ?? '');
          setPhone(contact.phone ?? '');
          setEmail(contact.email ?? '');
          setNotes(contact.notes ?? '');
        }
      } catch (e) {
        console.error(e);
        setError('Error al cargar el contacto');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [companyId, contactId, isEdit]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!companyId || Number.isNaN(companyId)) return;

    try {
      setError('');
      const payload: ContactUpsertInput = {
        full_name: fullName.trim(),
        position: position.trim(),
        priority,
        phone: phone.trim(),
        email: email.trim(),
        notes: notes,
      };

      if (isEdit && contactId) {
        await contactsService.update(companyId, contactId, payload);
      } else {
        await contactsService.create(companyId, payload);
      }

      notify.fromMessage('success', isEdit ? 'Contacto actualizado.' : 'Contacto creado.');
      navigate(`/companies/${companyId}/contacts`, { replace: true });
    } catch (e) {
      console.error(e);
      notify.error('No se pudo guardar el contacto');
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Alert variant="error">
          {error || 'Empresa no encontrada'}
        </Alert>
        <Link
          to="/companies"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver a empresas
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <PageHeading hint={`${isEdit ? 'Editar contacto' : 'Nuevo contacto'} responsable.`}>{company.business_name}</PageHeading>
        </div>
        <Link
          to={`/companies/${company.id}/contacts`}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver a contactos
        </Link>
      </div>

      {error ? (
        <Alert variant="error">{error}</Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="full_name" className="block text-sm font-medium text-slate-700 mb-1">
            Nombre completo
          </label>
          <input
            type="text"
            id="full_name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="position" className="block text-sm font-medium text-slate-700 mb-1">
              Cargo
            </label>
            <input
              type="text"
              id="position"
              required
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="priority" className="block text-sm font-medium text-slate-700 mb-1">
              Prioridad
            </label>
            <SearchableSelect
              id="priority"
              name="priority"
              value={priority}
              onChange={setPriority}
              options={[
                { value: '', label: 'Sin definir' },
                { value: 'alta', label: 'Alta' },
                { value: 'media', label: 'Media' },
                { value: 'baja', label: 'Baja' },
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
              Teléfono / Celular
            </label>
            <input
              type="text"
              id="phone"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Correo electrónico
            </label>
            <input
              type="email"
              id="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-slate-700 mb-1">
            Observaciones
          </label>
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
          />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500"
          >
            <i className="fas fa-save mr-2 text-xs"></i>
            {isEdit ? 'Guardar cambios' : 'Crear contacto'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CompanyContactForm;
