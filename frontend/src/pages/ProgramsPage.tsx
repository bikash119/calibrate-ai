/**
 * Programs management — list, create, rename, delete.
 *
 * Programs group projects. Solo OSS users typically use the seeded "Default"
 * program; multi-team installs create one per team or per business line.
 *
 * All write actions require admin (backend gates via `require_admin`); we
 * mirror that on the client to hide the buttons for non-admins.
 */

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { useAuth } from "../auth/AuthContext";
import { Banner } from "../components/ui/Banner";
import { Card } from "../components/ui/Card";
import { PageHead } from "../components/ui/PageHead";
import {
  useCreateProgram,
  useDeleteProgram,
  usePrograms,
  useUpdateProgram,
} from "../hooks/usePrograms";
import type { ProgramItem } from "../schemas";

export function ProgramsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const programs = usePrograms();
  const create = useCreateProgram();
  const update = useUpdateProgram();
  const remove = useDeleteProgram();

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const items = programs.data?.programs ?? [];

  return (
    <div>
      <PageHead
        eyebrow="Workspace"
        title="Programs"
        lede="Top-level grouping for projects. Use one per team, business line, or grant program."
        actions={
          isAdmin && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5" /> New program
            </button>
          )
        }
      />

      {!isAdmin && (
        <Banner kind="info" title="Read-only">
          Only administrators can create, rename, or delete programs.
        </Banner>
      )}

      {programs.isLoading && (
        <Card>
          <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
        </Card>
      )}

      {programs.error && (
        <Card>
          <div className="text-sm text-[var(--red-fg)]">{programs.error.message}</div>
        </Card>
      )}

      {!programs.isLoading && items.length === 0 && (
        <Card>
          <div className="text-sm text-[var(--fg-muted)]">
            No programs found. (The default install seeds one called <em>Default</em>.)
          </div>
        </Card>
      )}

      {items.length > 0 && (
        <Card noPad className="mt-4">
          <ul className="grid divide-y divide-[var(--border)]">
            {items.map((p) =>
              editingId === p.id ? (
                <EditRow
                  key={p.id}
                  program={p}
                  onCancel={() => {
                    setEditingId(null);
                    update.reset();
                  }}
                  onSave={async (name, description) => {
                    await update.mutateAsync({ id: p.id, name, description });
                    setEditingId(null);
                  }}
                  saving={update.isPending}
                  error={update.error?.message ?? null}
                />
              ) : (
                <ReadRow
                  key={p.id}
                  program={p}
                  isAdmin={isAdmin}
                  onEdit={() => setEditingId(p.id)}
                  onDelete={async () => {
                    if (!confirm(`Delete program '${p.name}'? Fails if any projects exist under it.`)) return;
                    try {
                      await remove.mutateAsync(p.id);
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Delete failed");
                    }
                  }}
                  removing={remove.isPending}
                />
              ),
            )}
          </ul>
        </Card>
      )}

      {showCreate && isAdmin && (
        <CreateModal
          onClose={() => {
            setShowCreate(false);
            create.reset();
          }}
          onCreate={async (name, description) => {
            await create.mutateAsync({ name, description });
            setShowCreate(false);
          }}
          submitting={create.isPending}
          error={create.error?.message ?? null}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ //

function ReadRow({
  program,
  isAdmin,
  onEdit,
  onDelete,
  removing,
}: {
  program: ProgramItem;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  removing: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{program.name}</div>
        {program.description && (
          <div className="text-xs text-[var(--fg-muted)] truncate">
            {program.description}
          </div>
        )}
      </div>
      <div className="text-xs text-[var(--fg-muted)] [font-variant-numeric:tabular-nums] shrink-0">
        {program.project_count} project{program.project_count === 1 ? "" : "s"}
      </div>
      {isAdmin && (
        <div className="flex gap-1 shrink-0">
          <button
            className="btn btn-ghost btn-sm"
            onClick={onEdit}
            title="Rename"
            disabled={removing}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onDelete}
            title={
              program.project_count > 0
                ? "Cannot delete — projects exist"
                : "Delete program"
            }
            disabled={removing || program.project_count > 0}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

function EditRow({
  program,
  onCancel,
  onSave,
  saving,
  error,
}: {
  program: ProgramItem;
  onCancel: () => void;
  onSave: (name: string, description: string | null) => Promise<void>;
  saving: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description ?? "");

  const dirty = name.trim() !== program.name || description.trim() !== (program.description ?? "");
  const canSave = name.trim().length > 0 && dirty && !saving;

  return (
    <li className="px-4 py-3 grid gap-2 bg-[var(--bg-sunken)]">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-2 py-1 text-sm rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
        placeholder="Name"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
        placeholder="Description (optional)"
      />
      {error && (
        <div className="px-3 py-1.5 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => onSave(name.trim(), description.trim() || null)}
          disabled={!canSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </li>
  );
}

function CreateModal({
  onClose,
  onCreate,
  submitting,
  error,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string | null) => Promise<void>;
  submitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const canSubmit = name.trim().length > 0 && !submitting;

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
          <h3 className="text-sm font-semibold tracking-tight">New program</h3>
        </div>
        <div className="px-5 py-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-[var(--fg-muted)]">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering grants"
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-[var(--fg-muted)]">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </label>
          {error && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onCreate(name.trim(), description.trim() || null)}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
