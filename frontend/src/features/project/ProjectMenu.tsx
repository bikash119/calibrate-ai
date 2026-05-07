/**
 * Per-project actions dropdown — mounted in the AppShell topbar.
 *
 * For now: Rename and Clone. Abandon already lives on PostTestPage; archive/
 * delete are admin-edge cases best done via the API until there's clear UX
 * demand.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, History, MoreHorizontal, Pencil } from "lucide-react";

import { useCloneProject, useProject, useUpdateProject } from "../../hooks/useProjects";

interface Props {
  projectId: number;
}

type ActiveModal = "rename" | "clone" | null;

export function ProjectMenu({ projectId }: Props) {
  const project = useProject(projectId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ActiveModal>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);

  // Click outside / ESC closes the dropdown
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (!project.data) return null;

  return (
    <>
      <div ref={wrapper} className="relative">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen((v) => !v)}
          title="Project actions"
        >
          <MoreHorizontal size={14} />
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-44 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg z-30 overflow-hidden">
            <MenuItem
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => {
                setOpen(false);
                setModal("rename");
              }}
            >
              Rename…
            </MenuItem>
            <MenuItem
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => {
                setOpen(false);
                setModal("clone");
              }}
            >
              Clone…
            </MenuItem>
            <MenuItem
              icon={<History className="w-3.5 h-3.5" />}
              onClick={() => {
                setOpen(false);
                navigate(`/projects/${projectId}/history`);
              }}
            >
              View history
            </MenuItem>
          </div>
        )}
      </div>

      {modal === "rename" && (
        <RenameModal
          projectId={projectId}
          currentName={project.data.name}
          currentDescription={project.data.description ?? ""}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "clone" && (
        <CloneModal
          projectId={projectId}
          currentName={project.data.name}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ //

function MenuItem({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--bg-sunken)] transition-colors"
    >
      {icon}
      {children}
    </button>
  );
}

function RenameModal({
  projectId,
  currentName,
  currentDescription,
  onClose,
}: {
  projectId: number;
  currentName: string;
  currentDescription: string;
  onClose: () => void;
}) {
  const update = useUpdateProject(projectId);
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription);

  const dirty = name.trim() !== currentName || description.trim() !== currentDescription;
  const canSubmit = name.trim().length > 0 && dirty && !update.isPending;

  const submit = async () => {
    try {
      await update.mutateAsync({
        name: name.trim() !== currentName ? name.trim() : undefined,
        description: description.trim() !== currentDescription ? description.trim() || null : undefined,
      });
      onClose();
    } catch {
      /* surfaced inline */
    }
  };

  return (
    <Modal title="Rename project" onClose={onClose}>
      <Field label="Name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
        />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
        />
      </Field>
      {update.error && <ErrorBox>{update.error.message}</ErrorBox>}
      <Footer>
        <button className="btn" onClick={onClose} disabled={update.isPending}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </Footer>
    </Modal>
  );
}

function CloneModal({
  projectId,
  currentName,
  onClose,
}: {
  projectId: number;
  currentName: string;
  onClose: () => void;
}) {
  const clone = useCloneProject(projectId);
  const navigate = useNavigate();
  const [name, setName] = useState(`${currentName} (copy)`);

  const canSubmit = name.trim().length > 0 && !clone.isPending;

  const submit = async () => {
    try {
      const created = await clone.mutateAsync(name.trim());
      onClose();
      navigate(`/projects/${created.id}/setup`);
    } catch {
      /* surfaced inline */
    }
  };

  return (
    <Modal
      title="Clone project"
      desc="Copies the rubric and dataset to a fresh project. The clone starts in setup with a new random_seed; splits regenerate from scratch."
      onClose={onClose}
    >
      <Field label="New project name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
        />
      </Field>
      {clone.error && <ErrorBox>{clone.error.message}</ErrorBox>}
      <Footer>
        <button className="btn" onClick={onClose} disabled={clone.isPending}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
          <Copy className="w-3.5 h-3.5" />
          {clone.isPending ? "Cloning…" : "Clone"}
        </button>
      </Footer>
    </Modal>
  );
}

// ------------------------------------------------------------------ //
// Tiny shared modal scaffolding (private to this file)
// ------------------------------------------------------------------ //

function Modal({
  title,
  desc,
  onClose,
  children,
}: {
  title: string;
  desc?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {desc && <p className="text-xs text-[var(--fg-muted)] mt-0.5">{desc}</p>}
        </div>
        <div className="px-5 py-4 grid gap-3">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-[var(--fg-muted)]">{label}</span>
      {children}
    </label>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
      {children}
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end gap-2 -mx-5 -mb-4 px-5 py-3 border-t border-[var(--border)] mt-1">
      {children}
    </div>
  );
}
