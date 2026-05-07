import {
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  Check,
  Folder,
  Info,
  Layers,
  Lock,
  Pencil,
  Settings,
  Upload,
} from "lucide-react";
import { Link, Outlet, useLocation, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { ProjectMenu } from "../features/project/ProjectMenu";

const WORKSPACE_NAV = [
  { path: "/projects", label: "Projects", icon: Folder },
  { path: "/locked-prompts", label: "Locked prompts", icon: Layers },
  { path: "/programs", label: "Programs", icon: Briefcase },
];

function topbarLabel(pathname: string): string {
  if (pathname === "/projects") return "Projects";
  if (pathname.startsWith("/locked-prompts")) return "Locked prompts";
  if (pathname === "/programs") return "Programs";
  return "";
}

// Project phases match the new state machine 1:1 (5 user-facing phases).
const PHASE_NAV = [
  { path: "setup", label: "Setup", icon: Upload, phase: 1 },
  { path: "baseline", label: "H-H baseline", icon: BarChart3, phase: 2 },
  { path: "iterate", label: "Iterate prompts", icon: Pencil, phase: 3 },
  { path: "test", label: "Test & lock", icon: Lock, phase: 4 },
];

/** Ordered phase paths for determining completed state. */
const PHASE_ORDER = PHASE_NAV.map((p) => p.path);

export function AppShell() {
  const location = useLocation();
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();

  const inProject = !!projectId;
  const currentPhasePath = location.pathname.split("/").pop() ?? "";
  const currentPhaseIndex = PHASE_ORDER.indexOf(currentPhasePath);

  // Determine which phase label to show in breadcrumbs
  const currentPhase = PHASE_NAV.find((p) => p.path === currentPhasePath);

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="brand">
          <div className="brand-mark">SA</div>
          <span>Scoring AI</span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: "auto", padding: 2 }}
          >
            <Settings size={13} />
          </button>
        </div>

        {/* Workspace nav */}
        <div>
          <div className="nav-section-label">Workspace</div>
          <nav className="nav">
            {WORKSPACE_NAV.map((item) => {
              const isActive =
                location.pathname === item.path ||
                location.pathname.startsWith(`${item.path}/`);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`nav-item ${isActive ? "active" : ""}`}
                >
                  <item.icon className="nav-icon" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* In-project phase nav */}
        {inProject && (
          <div>
            <div className="nav-section-label">Project</div>
            <nav className="nav">
              {PHASE_NAV.map((p) => {
                const phasePath = `/projects/${projectId}/${p.path}`;
                const isActive = currentPhasePath === p.path;
                const phaseIndex = PHASE_ORDER.indexOf(p.path);
                const completed = currentPhaseIndex > phaseIndex;

                return (
                  <Link
                    key={p.path}
                    to={phasePath}
                    className={`nav-item ${isActive ? "active" : ""} ${completed ? "completed" : ""}`}
                  >
                    <span className="phase-num">
                      {completed ? <Check size={10} /> : p.phase}
                    </span>
                    {p.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}

        {/* Bottom info card */}
        <div style={{ marginTop: "auto", padding: "0 8px" }}>
          <div
            style={{
              background: "var(--bg-sunken)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 10,
              fontSize: 12,
            }}
          >
            <div
              className="flex gap-1.5 mb-1.5 items-start"
            >
              <Info
                size={12}
                style={{
                  color: "var(--accent)",
                  marginTop: 3,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 500, lineHeight: 1.35 }}>
                Triage, not decisions
              </span>
            </div>
            <div
              style={{
                color: "var(--fg-subtle)",
                fontSize: 11,
                lineHeight: 1.45,
              }}
            >
              The platform measures agreement, not "correctness." Borderline
              cases route to humans by default.
            </div>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <main className="main">
        {/* Top bar */}
        <div className="topbar">
          <div className="crumbs">
            {inProject ? (
              <>
                <Link to="/projects">Projects</Link>
                <span className="sep">/</span>
                <span className="current">
                  {currentPhase?.label ?? currentPhasePath}
                </span>
              </>
            ) : (
              <span className="current">{topbarLabel(location.pathname)}</span>
            )}
          </div>
          <div className="topbar-actions">
            {inProject && <ProjectMenu projectId={Number(projectId)} />}
            <button className="btn btn-ghost btn-sm">
              <Bell size={13} />
            </button>
            <button className="btn btn-ghost btn-sm">
              <BookOpen size={13} /> Docs
            </button>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--accent-bg)",
                color: "var(--accent)",
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                fontWeight: 600,
                border: "1px solid var(--accent-border)",
              }}
            >
              {user?.username?.slice(0, 2).toUpperCase() ?? "??"}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
