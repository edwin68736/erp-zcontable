import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { companiesService, type CompanyUpsertInput } from '../services/companies';
import { usersService } from '../services/users';
import { contactsService, type ContactUpsertInput } from '../services/contacts';
import { subscriptionPlansService } from '../services/subscriptionPlans';
import { auth } from '../services/auth';
import type { Contact, SubscriptionPlan, User } from '../types/dashboard';
import SearchableSelect from '../components/SearchableSelect';
import { dateInputToRFC3339MidnightPeru, todayDateInputInPeru } from '../utils/peruDates';
import { formatUserPickLabel } from '../utils/userLabel';

function toDateInput(value?: string): string {
  if (!value) return '';
  if (value.length >= 10) return value.slice(0, 10);
  return value;
}

function rucDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 11);
}

const CompanyForm = () => {
  const navigate = useNavigate();
  const params = useParams();
  const companyId = params.id ? Number(params.id) : null;
  const isEdit = Boolean(companyId);

  const role = auth.getRole() ?? '';
  const isAdmin = role === 'Administrador';
  const canUpsert = role === 'Administrador' || role === 'Supervisor';

  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState('');
  const [validatingRuc, setValidatingRuc] = useState(false);
  const lastSuccessfulRucLookup = useRef<string>('');
  const rucLookupInFlight = useRef(false);

  const [users, setUsers] = useState<User[]>([]);
  const [code, setCode] = useState('');
  const [ruc, setRuc] = useState('');
  const [status, setStatus] = useState('activo');
  const [businessName, setBusinessName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [serviceStartAt, setServiceStartAt] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [supervisorUserId, setSupervisorUserId] = useState('');
  const [assistantUserId, setAssistantUserId] = useState('');
  const [accountantUserId, setAccountantUserId] = useState('');
  const [supervisorLabel, setSupervisorLabel] = useState('');
  const [assistantLabel, setAssistantLabel] = useState('');
  const [accountantLabel, setAccountantLabel] = useState('');

  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptionPlanId, setSubscriptionPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState('start_month');
  const [subscriptionStartedAt, setSubscriptionStartedAt] = useState('');
  const [subscriptionEndedAt, setSubscriptionEndedAt] = useState('');
  const [subscriptionActive, setSubscriptionActive] = useState(true);
  const [declaredBilling, setDeclaredBilling] = useState('');

  const [activeTab, setActiveTab] = useState<'company' | 'team' | 'contacts'>('company');

  const [contactsLoading, setContactsLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [draftContacts, setDraftContacts] = useState<Array<{ tempId: string; payload: ContactUpsertInput }>>([]);
  const [newContact, setNewContact] = useState<ContactUpsertInput>({
    full_name: '',
    position: '',
    phone: '',
    email: '',
    priority: '',
    notes: '',
  });

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError('');
        const [c, list, contactsList, plans, suggestedCode] = await Promise.all([
          isEdit && companyId ? companiesService.get(companyId) : Promise.resolve(null),
          isAdmin ? usersService.list() : Promise.resolve([] as User[]),
          isEdit && companyId ? contactsService.listByCompany(companyId) : Promise.resolve([] as Contact[]),
          subscriptionPlansService.list().catch(() => [] as SubscriptionPlan[]),
          !isEdit ? companiesService.getNextInternalCode().catch(() => null as string | null) : Promise.resolve(null),
        ]);

        setUsers(list);
        setContacts(contactsList);
        setSubscriptionPlans(plans.filter((p) => p.active !== false));

        if (c) {
          setCode(c.code ?? '');
          setRuc(c.ruc ?? '');
          setStatus(c.status ?? 'activo');
          setBusinessName(c.business_name ?? '');
          setTradeName(c.trade_name ?? '');
          setServiceStartAt(toDateInput(c.service_start_at));
          setAddress(c.address ?? '');
          setPhone(c.phone ?? '');
          setEmail(c.email ?? '');
          setSupervisorUserId(c.supervisor_user_id ? String(c.supervisor_user_id) : '');
          setAssistantUserId(c.assistant_user_id ? String(c.assistant_user_id) : '');
          setAccountantUserId(c.accountant_user_id ? String(c.accountant_user_id) : '');
          setSupervisorLabel(c.supervisor ? formatUserPickLabel(c.supervisor) : '');
          setAssistantLabel(c.assistant ? formatUserPickLabel(c.assistant) : '');
          setAccountantLabel(c.accountant ? formatUserPickLabel(c.accountant) : '');
          setSubscriptionPlanId(c.subscription_plan_id ? String(c.subscription_plan_id) : '');
          setBillingCycle(c.billing_cycle === 'end_month' ? 'end_month' : 'start_month');
          setSubscriptionStartedAt(toDateInput(c.subscription_started_at));
          setSubscriptionEndedAt(toDateInput(c.subscription_ended_at));
          setSubscriptionActive(c.subscription_active !== false);
          setDeclaredBilling(
            c.declared_billing_amount != null && Number.isFinite(Number(c.declared_billing_amount))
              ? String(c.declared_billing_amount)
              : '',
          );
        } else {
          setServiceStartAt(todayDateInputInPeru());
          if (suggestedCode) setCode(suggestedCode);
        }
      } catch (e) {
        console.error(e);
        setError(isEdit ? 'Error al cargar la empresa' : 'Error al cargar datos');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [companyId, isAdmin, isEdit]);

  useEffect(() => {
    lastSuccessfulRucLookup.current = '';
  }, [companyId]);

  const runRucLookup = useCallback(
    async (rawInput: string, mode: 'auto' | 'manual') => {
      if (!canUpsert || rucLookupInFlight.current) return;
      const trimmed = rawInput.trim();
      const digits = rucDigits(trimmed);
      if (digits.length !== 11) {
        if (mode === 'manual') {
          setError('El RUC debe tener 11 dígitos');
          window.dispatchEvent(
            new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'El RUC debe tener 11 dígitos' } }),
          );
        }
        return;
      }
      if (mode === 'auto' && digits === lastSuccessfulRucLookup.current) return;

      setError('');
      rucLookupInFlight.current = true;
      setValidatingRuc(true);
      try {
        const data = await companiesService.validateRuc(trimmed);
        setRuc(data.ruc ?? '');
        if (data.business_name) {
          setBusinessName(data.business_name);
          setTradeName(data.business_name);
        }
        if (data.address) setAddress(data.address);
        lastSuccessfulRucLookup.current = rucDigits(data.ruc ?? trimmed);

        const estado = (data.estado ?? '').toUpperCase();
        const extra =
          estado && estado !== 'ACTIVO'
            ? ` Estado SUNAT: ${data.estado}${data.condicion ? ` · ${data.condicion}` : ''}.`
            : '';
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'success', message: `Datos obtenidos desde SUNAT (ApiPeru.dev).${extra}` },
          }),
        );
        if (estado && estado !== 'ACTIVO') {
          window.dispatchEvent(
            new CustomEvent('miweb:toast', {
              detail: {
                type: 'info',
                message: 'Revisa la razón social y el estado del contribuyente antes de guardar.',
              },
            }),
          );
        }
      } catch (e: unknown) {
        console.error(e);
        const ax = e as { response?: { data?: { error?: string } } };
        const msg = ax.response?.data?.error ?? 'No se pudo validar el RUC';
        setError(msg);
        window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'error', message: msg } }));
      } finally {
        rucLookupInFlight.current = false;
        setValidatingRuc(false);
      }
    },
    [canUpsert],
  );

  useEffect(() => {
    if (isEdit || !canUpsert || loading) return;
    const digits = rucDigits(ruc);
    if (digits.length !== 11 || digits === lastSuccessfulRucLookup.current) return;

    const id = window.setTimeout(() => {
      const d = rucDigits(ruc);
      if (d.length !== 11 || d === lastSuccessfulRucLookup.current) return;
      void runRucLookup(ruc, 'auto');
    }, 450);

    return () => window.clearTimeout(id);
  }, [ruc, isEdit, canUpsert, loading, runRucLookup]);

  const handleValidateRuc = () => {
    if (!canUpsert) return;
    lastSuccessfulRucLookup.current = '';
    void runRucLookup(ruc, 'manual');
  };

  const handleAddContact = async () => {
    const payload: ContactUpsertInput = {
      full_name: newContact.full_name.trim(),
      position: newContact.position.trim(),
      phone: newContact.phone.trim(),
      email: newContact.email.trim(),
      priority: newContact.priority,
      notes: newContact.notes,
    };

    if (!payload.full_name) {
      setError('El nombre del contacto es requerido');
      return;
    }
    if (!payload.position) {
      setError('El cargo del contacto es requerido');
      return;
    }
    if (!payload.phone) {
      setError('El teléfono del contacto es requerido');
      return;
    }
    if (!payload.email) {
      setError('El correo del contacto es requerido');
      return;
    }

    setError('');

    if (isEdit && companyId) {
      try {
        setContactsLoading(true);
        const created = await contactsService.create(companyId, payload);
        setContacts((prev) => [created, ...prev]);
        setNewContact({ full_name: '', position: '', phone: '', email: '', priority: '', notes: '' });
      } catch (e) {
        console.error(e);
        setError('Error al registrar el contacto');
      } finally {
        setContactsLoading(false);
      }
      return;
    }

    const tempId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setDraftContacts((prev) => [{ tempId, payload }, ...prev]);
    setNewContact({ full_name: '', position: '', phone: '', email: '', priority: '', notes: '' });
  };

  const handleRemoveDraftContact = (tempId: string) => {
    setDraftContacts((prev) => prev.filter((c) => c.tempId !== tempId));
  };

  const handleDeleteContact = async (id: number) => {
    if (!isEdit || !companyId) return;
    if (!confirm('¿Eliminar este contacto?')) return;

    try {
      setContactsLoading(true);
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
    } finally {
      setContactsLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canUpsert) {
      setError('No tienes permisos para esta acción');
      return;
    }

    let declaredBillingAmount: number | null = null;
    if (declaredBilling.trim() !== '') {
      const n = Number(declaredBilling.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        setError('La facturación declarada debe ser un número válido');
        return;
      }
      declaredBillingAmount = n;
    }

    try {
      setError('');
      const payload: CompanyUpsertInput = {
        code: code.trim(),
        ruc: ruc.trim(),
        status: isEdit ? status : 'activo',
        business_name: businessName.trim(),
        trade_name: tradeName.trim() || undefined,
        service_start_at: dateInputToRFC3339MidnightPeru(serviceStartAt),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        subscription_plan_id:
          subscriptionPlanId && Number(subscriptionPlanId) > 0 ? Number(subscriptionPlanId) : null,
        billing_cycle: billingCycle,
        subscription_started_at: dateInputToRFC3339MidnightPeru(subscriptionStartedAt),
        subscription_ended_at: dateInputToRFC3339MidnightPeru(subscriptionEndedAt),
        subscription_active: subscriptionActive,
        declared_billing_amount: declaredBillingAmount,
      };

      if (isAdmin) {
        const supervisorNum = Number(supervisorUserId);
        const assistantNum = Number(assistantUserId);
        const accountantNum = Number(accountantUserId);

        if (isEdit) {
          payload.supervisor_user_id = Number.isFinite(supervisorNum) && supervisorNum > 0 ? supervisorNum : 0;
          payload.assistant_user_id = Number.isFinite(assistantNum) && assistantNum > 0 ? assistantNum : 0;
          payload.accountant_user_id = Number.isFinite(accountantNum) && accountantNum > 0 ? accountantNum : 0;
        } else {
          if (Number.isFinite(supervisorNum) && supervisorNum > 0) payload.supervisor_user_id = supervisorNum;
          if (Number.isFinite(assistantNum) && assistantNum > 0) payload.assistant_user_id = assistantNum;
          if (Number.isFinite(accountantNum) && accountantNum > 0) payload.accountant_user_id = accountantNum;
        }
      }

      if (isEdit && companyId) {
        await companiesService.update(companyId, payload);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Empresa actualizada correctamente.' } }),
        );
        navigate('/companies', { replace: true });
        return;
      }

      const created = await companiesService.create(payload);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Empresa creada correctamente.' } }),
      );

      if (draftContacts.length > 0) {
        try {
          await Promise.all(draftContacts.map((c) => contactsService.create(created.id, c.payload)));
        } catch (e) {
          console.error(e);
          window.dispatchEvent(
            new CustomEvent('miweb:toast', {
              detail: {
                type: 'info',
                message: 'Empresa creada, pero ocurrió un error al registrar algunos contactos. Revisa "Contactos".',
              },
            }),
          );
        }
      }

      navigate('/companies', { replace: true });
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Error al guardar la empresa';
      setError(message);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">{isEdit ? 'Editar empresa' : 'Nueva empresa'}</h2>
          <p className="text-sm text-slate-500">Datos maestros del cliente del estudio.</p>
        </div>
        <Link
          to="/companies"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver al listado
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('company')}
              className={`px-4 py-2 rounded-full text-sm font-medium border ${
                activeTab === 'company'
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Datos de la empresa
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('team')}
              className={`px-4 py-2 rounded-full text-sm font-medium border ${
                activeTab === 'team'
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Equipo contable
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contacts')}
              className={`px-4 py-2 rounded-full text-sm font-medium border ${
                activeTab === 'contacts'
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Contactos de la empresa
            </button>
          </div>
        </div>

        {activeTab === 'company' ? (
          <div className="space-y-5">
            <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(280px,440px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,480px)] xl:gap-x-12 2xl:gap-x-16 xl:items-stretch">
              <div className="space-y-5 min-w-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-1">
                <label htmlFor="internal_code" className="block text-sm font-medium text-slate-700 mb-1">
                  Código interno
                </label>
                <input
                  type="text"
                  id="internal_code"
                  required
                  value={code}
                  onChange={(e) => {
                    if (!isEdit) {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 4));
                      return;
                    }
                    setCode(e.target.value);
                  }}
                  inputMode={isEdit ? 'text' : 'numeric'}
                  maxLength={isEdit ? 50 : 4}
                  autoComplete="off"
                  placeholder="0000"
                  className={`w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none ${isEdit ? '' : 'tracking-widest font-mono'}`}
                />
              </div>
              <div className="md:col-span-1">
                <label htmlFor="ruc" className="block text-sm font-medium text-slate-700 mb-1">
                  RUC
                </label>
                <div className="flex rounded-lg border border-slate-300 bg-white shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
                  <input
                    type="text"
                    id="ruc"
                    required
                    value={ruc}
                    onChange={(e) => setRuc(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={20}
                    placeholder="11 dígitos"
                    className="min-w-0 flex-1 px-3 py-2.5 border-0 text-sm outline-none bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={handleValidateRuc}
                    disabled={!canUpsert || validatingRuc || rucDigits(ruc).length !== 11}
                    title="Consultar datos en SUNAT"
                    className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 border-l border-slate-200 bg-slate-50 text-primary-700 text-xs font-semibold hover:bg-primary-50 focus:outline-none focus-visible:bg-primary-50 disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <i className={`fas ${validatingRuc ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'} text-sm`}></i>
                    <span className="hidden sm:inline">{validatingRuc ? 'Consultando' : 'Consultar'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="business_name" className="block text-sm font-medium text-slate-700 mb-1">
                Razón social
              </label>
              <input
                type="text"
                id="business_name"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="trade_name" className="block text-sm font-medium text-slate-700 mb-1">
                  Nombre comercial
                </label>
                <input
                  type="text"
                  id="trade_name"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
              <div>
                <label htmlFor="service_start_at" className="block text-sm font-medium text-slate-700 mb-1">
                  Inicio de servicio
                </label>
                <input
                  type="date"
                  id="service_start_at"
                  value={serviceStartAt}
                  onChange={(e) => setServiceStartAt(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
            </div>

                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <div>
                    <label htmlFor="address" className="block text-sm font-medium text-slate-700 mb-1">
                      Dirección
                    </label>
                    <input
                      type="text"
                      id="address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
                        Teléfono
                      </label>
                      <input
                        type="text"
                        id="phone"
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
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 space-y-4 xl:sticky xl:top-4 xl:h-fit xl:self-start shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800">Suscripción y facturación</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="subscription_plan_id" className="block text-sm font-medium text-slate-700 mb-1">
                    Plan de suscripción
                  </label>
                  <SearchableSelect
                    id="subscription_plan_id"
                    name="subscription_plan_id"
                    value={subscriptionPlanId}
                    onChange={setSubscriptionPlanId}
                    placeholder="Sin plan asignado"
                    searchPlaceholder="Buscar plan…"
                    options={[
                      { value: '', label: 'Sin plan' },
                      ...subscriptionPlans.map((p) => ({
                        value: String(p.id),
                        label: p.name + (p.plan_category?.name ? ` · ${p.plan_category.name}` : ''),
                      })),
                    ]}
                  />
                </div>
                <div>
                  <label htmlFor="billing_cycle" className="block text-sm font-medium text-slate-700 mb-1">
                    Ciclo de cobro
                  </label>
                  <SearchableSelect
                    id="billing_cycle"
                    name="billing_cycle"
                    value={billingCycle}
                    onChange={setBillingCycle}
                    options={[
                      { value: 'start_month', label: 'Inicio de mes' },
                      { value: 'end_month', label: 'Fin de mes' },
                    ]}
                  />
                </div>
                <div>
                  <label htmlFor="subscription_started_at" className="block text-sm font-medium text-slate-700 mb-1">
                    Inicio suscripción
                  </label>
                  <input
                    type="date"
                    id="subscription_started_at"
                    value={subscriptionStartedAt}
                    onChange={(e) => setSubscriptionStartedAt(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="subscription_ended_at" className="block text-sm font-medium text-slate-700 mb-1">
                    Fin suscripción (opcional)
                  </label>
                  <input
                    type="date"
                    id="subscription_ended_at"
                    value={subscriptionEndedAt}
                    onChange={(e) => setSubscriptionEndedAt(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="declared_billing" className="block text-sm font-medium text-slate-700 mb-1">
                    Facturación declarada (base manual)
                  </label>
                  <div className="flex items-center rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
                    <span className="px-3 text-slate-500 text-sm">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      id="declared_billing"
                      value={declaredBilling}
                      onChange={(e) => setDeclaredBilling(e.target.value)}
                      className="w-full px-2 py-2.5 rounded-r-lg outline-none text-sm"
                      placeholder="Opcional"
                    />
                  </div>
                </div>
                <div className="flex items-end pb-1">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subscriptionActive}
                      onChange={(e) => setSubscriptionActive(e.target.checked)}
                      className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    Suscripción activa
                  </label>
                </div>
              </div>
            </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'team' ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Equipo contable (opcional)</h3>
            </div>

            {isAdmin ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="supervisor_user_id" className="block text-sm font-medium text-slate-700 mb-1">
                    Supervisor
                  </label>
                  <SearchableSelect
                    id="supervisor_user_id"
                    name="supervisor_user_id"
                    value={supervisorUserId}
                    onChange={setSupervisorUserId}
                    options={[
                      { value: '', label: 'Sin asignar' },
                      ...users
                        .filter((u) => u.role === 'Supervisor' || u.role === 'Administrador')
                        .map((u) => ({
                          value: String(u.id),
                          label: formatUserPickLabel(u),
                          searchText: `${u.name} ${u.username} ${u.email ?? ''}`,
                        })),
                    ]}
                  />
                </div>
                <div>
                  <label htmlFor="assistant_user_id" className="block text-sm font-medium text-slate-700 mb-1">
                    Asistente
                  </label>
                  <SearchableSelect
                    id="assistant_user_id"
                    name="assistant_user_id"
                    value={assistantUserId}
                    onChange={setAssistantUserId}
                    searchPlaceholder="Buscar usuario..."
                    options={[
                      { value: '', label: 'Sin asignar' },
                      ...users
                        .filter((u) => u.role === 'Asistente' || u.role === 'Administrador')
                        .map((u) => ({
                          value: String(u.id),
                          label: formatUserPickLabel(u),
                          searchText: `${u.name} ${u.username} ${u.email ?? ''}`,
                        })),
                    ]}
                  />
                </div>
                <div>
                  <label htmlFor="accountant_user_id" className="block text-sm font-medium text-slate-700 mb-1">
                    Contador general
                  </label>
                  <SearchableSelect
                    id="accountant_user_id"
                    name="accountant_user_id"
                    value={accountantUserId}
                    onChange={setAccountantUserId}
                    searchPlaceholder="Buscar usuario..."
                    options={[
                      { value: '', label: 'Sin asignar' },
                      ...users
                        .filter((u) => u.role === 'Contador' || u.role === 'Administrador')
                        .map((u) => ({
                          value: String(u.id),
                          label: formatUserPickLabel(u),
                          searchText: `${u.name} ${u.username} ${u.email ?? ''}`,
                        })),
                    ]}
                  />
                </div>
              </div>
            ) : isEdit ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-slate-500">Supervisor</div>
                  <div className="text-slate-800">{supervisorLabel || '—'}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-slate-500">Asistente</div>
                  <div className="text-slate-800">{assistantLabel || '—'}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-slate-500">Contador general</div>
                  <div className="text-slate-800">{accountantLabel || '—'}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                El equipo contable se asigna opcionalmente por un Administrador.
              </div>
            )}
          </div>
        ) : null}

        {activeTab === 'contacts' ? (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Contactos de la empresa (opcional)</h3>
                </div>
                {isEdit && companyId ? (
                  <Link
                    to={`/companies/${companyId}/contacts`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <i className="fas fa-address-book text-xs"></i> Ver todos
                  </Link>
                ) : null}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="contact_full_name" className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    id="contact_full_name"
                    value={newContact.full_name}
                    onChange={(e) => setNewContact((p) => ({ ...p, full_name: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="contact_position" className="block text-sm font-medium text-slate-700 mb-1">
                    Cargo
                  </label>
                  <input
                    type="text"
                    id="contact_position"
                    value={newContact.position}
                    onChange={(e) => setNewContact((p) => ({ ...p, position: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div>
                  <label htmlFor="contact_phone" className="block text-sm font-medium text-slate-700 mb-1">
                    Teléfono / Celular
                  </label>
                  <input
                    type="text"
                    id="contact_phone"
                    value={newContact.phone}
                    onChange={(e) => setNewContact((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="contact_email" className="block text-sm font-medium text-slate-700 mb-1">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    id="contact_email"
                    value={newContact.email}
                    onChange={(e) => setNewContact((p) => ({ ...p, email: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label htmlFor="contact_priority" className="block text-sm font-medium text-slate-700 mb-1">
                    Prioridad
                  </label>
                  <SearchableSelect
                    id="contact_priority"
                    value={newContact.priority}
                    onChange={(v) => setNewContact((p) => ({ ...p, priority: v }))}
                    options={[
                      { value: '', label: 'Sin definir' },
                      { value: 'alta', label: 'Alta' },
                      { value: 'media', label: 'Media' },
                      { value: 'baja', label: 'Baja' },
                    ]}
                  />
                </div>
                <div>
                  <label htmlFor="contact_notes" className="block text-sm font-medium text-slate-700 mb-1">
                    Observaciones
                  </label>
                  <input
                    type="text"
                    id="contact_notes"
                    value={newContact.notes}
                    onChange={(e) => setNewContact((p) => ({ ...p, notes: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  disabled={contactsLoading}
                  onClick={handleAddContact}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-60"
                >
                  <i className="fas fa-plus mr-2 text-xs"></i>
                  {isEdit ? 'Agregar contacto' : 'Agregar a la lista'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">
                  {isEdit ? 'Contactos registrados' : 'Contactos a registrar'}
                </div>
                {contactsLoading ? (
                  <div className="text-xs text-slate-500">
                    <i className="fas fa-spinner fa-spin mr-2"></i> Procesando...
                  </div>
                ) : null}
              </div>
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
                    {isEdit ? (
                      contacts.length > 0 ? (
                        contacts.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-800">{c.full_name}</td>
                            <td className="px-4 py-3 text-slate-700">{c.position}</td>
                            <td className="px-4 py-3 text-slate-700">{c.phone}</td>
                            <td className="px-4 py-3 text-slate-700">{c.email}</td>
                            <td className="px-4 py-3 text-slate-700">{c.priority || '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <Link
                                  to={`/companies/${companyId}/contacts/${c.id}/edit`}
                                  className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                >
                                  <i className="fas fa-pen mr-1"></i> Editar
                                </Link>
                                <button
                                  type="button"
                                  disabled={contactsLoading}
                                  onClick={() => handleDeleteContact(c.id)}
                                  className="inline-flex items-center px-3 py-1.5 rounded-full border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
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
                      )
                    ) : draftContacts.length > 0 ? (
                      draftContacts.map((c) => (
                        <tr key={c.tempId} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-800">{c.payload.full_name}</td>
                          <td className="px-4 py-3 text-slate-700">{c.payload.position}</td>
                          <td className="px-4 py-3 text-slate-700">{c.payload.phone}</td>
                          <td className="px-4 py-3 text-slate-700">{c.payload.email}</td>
                          <td className="px-4 py-3 text-slate-700">{c.payload.priority || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleRemoveDraftContact(c.tempId)}
                                className="inline-flex items-center px-3 py-1.5 rounded-full border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50"
                              >
                                <i className="fas fa-times mr-1"></i> Quitar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500 text-sm">
                          No hay contactos cargados todavía.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        <div className="pt-2">
          <button
            type="submit"
            disabled={!canUpsert}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 disabled:opacity-60"
          >
            <i className="fas fa-save mr-2 text-xs"></i>
            {isEdit ? 'Guardar cambios' : 'Crear empresa'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CompanyForm;
