import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  archiveActiveModel,
  createModelArchive,
  deleteModelArchive,
  listModelArchives,
  updateModelArchive,
} from "@/lib/model-archives.functions";
import { getActiveSettings } from "@/lib/settings.functions";

export const Route = createFileRoute("/_authenticated/models")({
  head: () => ({ meta: [{ title: "Models — BTC 15m" }] }),
  component: ModelsPage,
});

type Archive = {
  id: string;
  model_version: string;
  api_model_id: string | null;
  prompt_template: string;
  indicator_weights: Record<string, number> | null;
  confidence_threshold: number | null;
  notes: string | null;
  archived_at: string;
};

function ModelsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listModelArchives);
  const activeFn = useServerFn(getActiveSettings);
  const archiveNow = useServerFn(archiveActiveModel);
  const createFn = useServerFn(createModelArchive);
  const updateFn = useServerFn(updateModelArchive);
  const deleteFn = useServerFn(deleteModelArchive);

  const archives = useQuery({ queryKey: ["model-archives"], queryFn: () => listFn() });
  const active = useQuery({ queryKey: ["active-settings"], queryFn: () => activeFn() });

  const [notes, setNotes] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Archive | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["model-archives"] });

  const mArchive = useMutation({
    mutationFn: () => archiveNow({ data: { notes: notes || undefined } }),
    onSuccess: () => { toast.success("Active model archived"); setNotes(""); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Archive failed"),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Archive deleted"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Models</h1>
          <p className="text-xs text-muted-foreground">
            Archive of past model versions. Expand any row to view the full prompt / JSON.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddArchiveDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onSubmit={async (payload) => {
              await createFn({ data: payload });
              toast.success("Model archive added");
              setAddOpen(false);
              invalidate();
            }}
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Snapshot Current Active Model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Currently active:{" "}
            <span className="font-mono text-foreground">
              {active.data?.model_version ?? "—"}
            </span>
            {active.data?.api_model_id ? (
              <span className="text-muted-foreground"> ({active.data.api_model_id})</span>
            ) : null}
          </div>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[220px]">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. before 2.3.3 rollout"
              />
            </div>
            <Button
              onClick={() => mArchive.mutate()}
              disabled={mArchive.isPending || !active.data}
            >
              {mArchive.isPending ? "Archiving…" : "Archive Current Model"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Archived Models {archives.data ? `(${archives.data.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archives.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !archives.data || archives.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No archived models yet. Snapshot the current active model or add one manually.
            </p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {archives.data.map((a: any) => (
                <AccordionItem key={a.id} value={a.id}>
                  <AccordionTrigger className="text-left">
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-medium">{a.model_version}</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {a.api_model_id ?? "—"} · archived{" "}
                        {new Date(a.archived_at).toLocaleString()}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3">
                      {a.notes ? (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">Notes:</span>{" "}
                          {a.notes}
                        </div>
                      ) : null}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <Stat label="Confidence Threshold" value={a.confidence_threshold ?? "—"} />
                        <Stat label="Auto-Run" value={a.auto_run_enabled ? "Yes" : "No"} />
                        <Stat label="Manual Approval" value={a.require_manual_approval ? "Yes" : "No"} />
                        <Stat label="Weights" value={
                          a.indicator_weights ? Object.keys(a.indicator_weights).length : 0
                        } />
                      </div>
                      <div>
                        <Label className="text-xs">Prompt Template / Full JSON</Label>
                        <pre className="mt-1 max-h-[420px] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-snug font-mono whitespace-pre-wrap break-words">
{a.prompt_template}
                        </pre>
                      </div>
                      {a.indicator_weights && Object.keys(a.indicator_weights).length > 0 ? (
                        <div>
                          <Label className="text-xs">Indicator Weights</Label>
                          <pre className="mt-1 max-h-[240px] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-snug font-mono">
{JSON.stringify(a.indicator_weights, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                      <div className="flex justify-end gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            navigator.clipboard.writeText(a.prompt_template);
                            toast.success("Prompt copied");
                          }}
                        >
                          Copy Prompt
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                          Edit
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive">Delete</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this archive?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Permanently removes {a.model_version} from the archive list. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => mDelete.mutate(a.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <EditArchiveDialog
        archive={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (payload) => {
          await updateFn({ data: payload });
          toast.success("Archive updated");
          setEditing(null);
          invalidate();
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-foreground">{value}</div>
    </div>
  );
}

function AddArchiveDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (payload: {
    model_version: string;
    api_model_id?: string;
    prompt_template: string;
    notes?: string;
  }) => Promise<void>;
}) {
  const [modelVersion, setModelVersion] = useState("");
  const [apiId, setApiId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) { setModelVersion(""); setApiId(""); setPrompt(""); setNotes(""); }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Add Archive Manually</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Model Archive</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Model Version / Name</Label>
            <Input value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} />
          </div>
          <div>
            <Label>API Model ID (optional)</Label>
            <Input value={apiId} onChange={(e) => setApiId(e.target.value)} />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <Label>Prompt / Full JSON</Label>
            <Textarea
              rows={14}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="font-mono text-xs"
              placeholder="Paste the model JSON or prompt template here…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy || !modelVersion || !prompt}
            onClick={async () => {
              try {
                setBusy(true);
                await onSubmit({
                  model_version: modelVersion,
                  api_model_id: apiId || undefined,
                  prompt_template: prompt,
                  notes: notes || undefined,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save Archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditArchiveDialog({
  archive,
  onClose,
  onSubmit,
}: {
  archive: Archive | null;
  onClose: () => void;
  onSubmit: (payload: {
    id: string;
    model_version: string;
    api_model_id?: string | null;
    prompt_template: string;
    notes?: string | null;
  }) => Promise<void>;
}) {
  const [modelVersion, setModelVersion] = useState("");
  const [apiId, setApiId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const open = !!archive;
  // Hydrate when opening
  if (archive && modelVersion === "" && prompt === "" && !busy) {
    // one-shot init per open cycle
    setModelVersion(archive.model_version);
    setApiId(archive.api_model_id ?? "");
    setPrompt(archive.prompt_template);
    setNotes(archive.notes ?? "");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) { onClose(); setModelVersion(""); setApiId(""); setPrompt(""); setNotes(""); }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Archive</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Model Version / Name</Label>
            <Input value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} />
          </div>
          <div>
            <Label>API Model ID</Label>
            <Input value={apiId} onChange={(e) => setApiId(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <Label>Prompt / Full JSON</Label>
            <Textarea
              rows={14}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy || !modelVersion || !prompt || !archive}
            onClick={async () => {
              if (!archive) return;
              try {
                setBusy(true);
                await onSubmit({
                  id: archive.id,
                  model_version: modelVersion,
                  api_model_id: apiId || null,
                  prompt_template: prompt,
                  notes: notes || null,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
