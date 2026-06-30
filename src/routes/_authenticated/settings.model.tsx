import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getActiveSettings, updateSettings } from "@/lib/settings.functions";

export const Route = createFileRoute("/_authenticated/settings/model")({
  head: () => ({ meta: [{ title: "Model Settings — BTC 15m" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const settingsFn = useServerFn(getActiveSettings);
  const updateFn = useServerFn(updateSettings);
  const q = useQuery({ queryKey: ["active-settings"], queryFn: () => settingsFn() });

  const [form, setForm] = useState<{
    id: string; model_version: string; api_model_id: string; confidence_threshold: number;
    auto_run_enabled: boolean; require_manual_approval: boolean;
    indicator_weights: Record<string, number>; prompt_template: string; is_active: boolean;
  } | null>(null);

  useEffect(() => {
    if (q.data && !form) {
      setForm({
        id: q.data.id,
        model_version: q.data.model_version,
        api_model_id: ((q.data as any).api_model_id as string) || "",
        confidence_threshold: Number(q.data.confidence_threshold),
        auto_run_enabled: q.data.auto_run_enabled,
        require_manual_approval: q.data.require_manual_approval,
        indicator_weights: (q.data.indicator_weights ?? {}) as Record<string, number>,
        prompt_template: q.data.prompt_template,
        is_active: q.data.is_active,
      });
    }
  }, [q.data, form]);

  const mut = useMutation({
    mutationFn: (payload: NonNullable<typeof form>) => updateFn({ data: payload }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["active-settings"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  if (!form) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const weightKeys = Object.keys(form.indicator_weights);

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Model Settings</h1>
        <Button onClick={() => mut.mutate(form)} disabled={mut.isPending}>
          {mut.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Model Name / Version</Label>
            <Input value={form.model_version} onChange={(e) => setForm({ ...form, model_version: e.target.value })} />
          </div>
          <div>
            <Label>Confidence Threshold (%)</Label>
            <Input type="number" min={0} max={100} value={form.confidence_threshold}
              onChange={(e) => setForm({ ...form, confidence_threshold: Number(e.target.value) })} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <Label>Auto-Run Every 15m</Label>
            <Switch checked={form.auto_run_enabled} onCheckedChange={(v) => setForm({ ...form, auto_run_enabled: v })} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <Label>Require Manual Approval</Label>
            <Switch checked={form.require_manual_approval} onCheckedChange={(v) => setForm({ ...form, require_manual_approval: v })} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3 md:col-span-2">
            <div>
              <Label>Active Model</Label>
              <p className="text-xs text-muted-foreground">Only one model is active at a time.</p>
            </div>
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Indicator Weights</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {weightKeys.map((k) => (
            <div key={k}>
              <Label className="capitalize text-xs">{k.replaceAll("_", " ")}</Label>
              <Input
                type="number" step={0.5} value={form.indicator_weights[k]}
                onChange={(e) =>
                  setForm({ ...form, indicator_weights: { ...form.indicator_weights, [k]: Number(e.target.value) } })
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Prompt Template</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            Use <code>{`{{candles_json}}`}</code> and <code>{`{{model_settings_json}}`}</code>.
          </p>
          <Textarea rows={10} value={form.prompt_template} onChange={(e) => setForm({ ...form, prompt_template: e.target.value })} className="font-mono text-xs" />
        </CardContent>
      </Card>
    </div>
  );
}
