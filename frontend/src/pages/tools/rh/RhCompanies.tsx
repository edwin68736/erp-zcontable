import SireCompanies from '../sire/SireCompanies';

/** Herramientas → RH: lista de empresas; cada una abre su consulta de recibos por honorarios en SUNAT. */
const RhCompanies = () => (
  <SireCompanies
    title="RH"
    subtitle="Recibos por honorarios en la plataforma de confirmación de SUNAT: elija una empresa para ver sus comprobantes pendientes, subsanados o disconformes."
    basePath="/tools/rh"
    openLabel="Abrir RH"
    openIcon="fas fa-file-signature"
  />
);

export default RhCompanies;
