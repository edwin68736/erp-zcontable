import SireCompanies from '../sire/SireCompanies';

/** Herramientas → Consulta de detracciones: lista de empresas; cada una abre sus NPD (Números de Pago de Detracciones). */
const NpdCompanies = () => (
  <SireCompanies
    title="Consulta de detracciones"
    subtitle="Números de Pago de Detracciones (NPD): elija una empresa para ver los NPD que generó, su estado y su fecha límite de pago."
    basePath="/tools/consulta-detracciones"
    openLabel="Abrir NPD"
    openIcon="fas fa-magnifying-glass-dollar"
  />
);

export default NpdCompanies;
