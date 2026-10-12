export default function StudioWorkflow({ steps, currentStep = 1, label = "Production workflow" }) {
  return (
    <ol className="studio-workflow" aria-label={label}>
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const state = stepNumber < currentStep ? "complete" : stepNumber === currentStep ? "active" : "upcoming";

        return (
          <li
            key={step.label}
            className={`studio-workflow-step is-${state}`}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="studio-workflow-index" aria-hidden="true">
              {state === "complete" ? "✓" : String(stepNumber).padStart(2, "0")}
            </span>
            <span className="studio-workflow-copy">
              <strong>{step.label}</strong>
              <small>{step.description}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
