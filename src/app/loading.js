export default function Loading() {
  return (
    <main className="route-loading-shell" aria-label="Loading DesaynClaw workspace" aria-live="polite">
      <div className="route-loading-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <strong>DESAYNCLAW</strong>
        <small>Preparing workspace</small>
      </div>
    </main>
  );
}
