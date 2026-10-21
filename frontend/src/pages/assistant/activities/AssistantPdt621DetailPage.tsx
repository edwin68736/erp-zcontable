import { Navigate, useSearchParams } from 'react-router-dom';
import { activityModulePath } from '../../../navigation/activityRoutes';

// El asistente ya no tiene detalle de PDT 621: la entrega del archivador la registra el supervisor
// asignado con "Recepcionar" (hora del servidor), y el asistente solo ve estados y la fecha/hora
// recepcionada en la lista. Un enlace o URL vieja al detalle vuelve a la lista del mismo período.
const AssistantPdt621DetailPage = () => {
  const [searchParams] = useSearchParams();
  const periodYm = searchParams.get('period_ym');
  const list = activityModulePath('assistant', 'pdt-621');
  return <Navigate replace to={periodYm ? `${list}?period_ym=${encodeURIComponent(periodYm)}` : list} />;
};

export default AssistantPdt621DetailPage;
