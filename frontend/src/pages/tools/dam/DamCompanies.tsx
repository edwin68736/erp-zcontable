import SireCompanies from '../sire/SireCompanies';

/** Herramientas → Consulta DAM: lista de empresas; cada una abre sus Declaraciones Aduaneras de Mercancías de exportación. */
const DamCompanies = () => (
  <SireCompanies
    title="Consulta DAM"
    subtitle="Declaraciones Aduaneras de Mercancías (exportación): elija una empresa para ver las DAM numeradas en un rango de fechas."
    basePath="/tools/consulta-dam"
    openLabel="Abrir DAM"
    openIcon="fas fa-box-open"
  />
);

export default DamCompanies;
