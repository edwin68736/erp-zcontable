import SireCompanies from '../sire/SireCompanies';

/** Herramientas → Consulta de detracciones: lista de empresas; cada una abre sus NPD (Números de Pago de Detracciones). */
const NpdCompanies = () => (
  <SireCompanies
    title="Consulta de detracciones"
    subtitle="Pagos de detracciones (constancias de depósito): elija una empresa para consultar los pagos por fecha o periodo y descargar sus constancias y el Excel."
    basePath="/tools/consulta-detracciones"
    openLabel="Abrir detracciones"
    openIcon="fas fa-magnifying-glass-dollar"
  />
);

export default NpdCompanies;
