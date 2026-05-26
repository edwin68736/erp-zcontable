import SupervisorControls from '../supervisors/SupervisorControls';

const AssistantControls = () => (
  <div className="max-w-6xl mx-auto space-y-4">
    <p className="text-sm text-slate-500 px-1">
      Tareas operativas de sus empresas asignadas. Abra el detalle para registrar avance y adjuntos.
    </p>
    <SupervisorControls detailBasePath="/assistant/controls" />
  </div>
);

export default AssistantControls;
