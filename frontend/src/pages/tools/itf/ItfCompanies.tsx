import SireCompanies from '../sire/SireCompanies';

/** Herramientas → Consulta ITF: lista de empresas; cada una abre su consulta del Impuesto a las Transacciones Financieras. */
const ItfCompanies = () => (
  <SireCompanies
    title="Consulta ITF"
    subtitle="Impuesto a las Transacciones Financieras (Formulario 0695): elija una empresa para ver los movimientos de sus cuentas afectos al ITF por período."
    basePath="/tools/consulta-itf"
    openLabel="Abrir ITF"
    openIcon="fas fa-money-bill-transfer"
  />
);

export default ItfCompanies;
