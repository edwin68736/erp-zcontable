import { Navigate } from 'react-router-dom';

/** Ruta legacy: la sincronización Tukifac fue retirada. */
const TukifacDocuments = () => <Navigate to="/comprobantes" replace />;

export default TukifacDocuments;
