import SupervisorControls from '../supervisors/SupervisorControls';

/** Hub de actividades del asistente (alias de SupervisorControls en workspace assistant). */
const AssistantControls = () => (
  <div className="max-w-6xl mx-auto">
    <SupervisorControls workspace="assistant" />
  </div>
);

export default AssistantControls;
