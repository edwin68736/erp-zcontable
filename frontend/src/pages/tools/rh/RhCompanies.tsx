import SireCompanies from '../sire/SireCompanies';

/** Herramientas → RH: lista de empresas; cada una abre su consulta de recibos por honorarios en SUNAT. */
const RhCompanies = () => (
  <SireCompanies
    title="RH"
    subtitle="Recibos por honorarios recibidos por la empresa, leídos en SUNAT Operaciones en Línea, y comprobantes pendientes de confirmación: elija una empresa."
    basePath="/tools/rh"
    openLabel="Abrir RH"
    openIcon="fas fa-file-signature"
  />
);

export default RhCompanies;
