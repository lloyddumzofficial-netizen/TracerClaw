import LogoLoader from "@/components/ui/LogoLoader";

export default function Loading() {
  return (
    <main className="route-loading-shell" aria-label="Loading DesaynClaw workspace" aria-live="polite">
      <div className="route-loading-stage">
        <div className="route-loading-mark">
          <LogoLoader size={72} color="#f4f4ef" decorative />
        </div>
        <div className="route-loading-copy">
          <span>DESAYNCLAW STUDIO</span>
          <strong>Preparing your workspace</strong>
          <small>Loading tools and project data</small>
        </div>
        <div className="route-loading-progress" role="progressbar" aria-label="Preparing workspace">
          <span />
        </div>
      </div>
    </main>
  );
}
