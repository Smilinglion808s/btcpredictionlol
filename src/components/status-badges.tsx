import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-warn/15 text-warn border-warn/30" },
    manual_review: { label: "Manual Review", cls: "bg-warn/15 text-warn border-warn/30" },
    win: { label: "Win", cls: "bg-bull/15 text-bull border-bull/30" },
    loss: { label: "Loss", cls: "bg-bear/15 text-bear border-bear/30" },
    push: { label: "Push", cls: "bg-muted text-muted-foreground border-border" },
  };
  const m = map[status] ?? { label: status, cls: "" };
  return <Badge variant="outline" className={`${m.cls} font-mono`}>{m.label}</Badge>;
}

export function PredictionBadge({ value }: { value: string }) {
  const isYes = value === "YES";
  const isNo = value === "NO";
  return (
    <Badge
      variant="outline"
      className={`font-mono font-semibold ${isYes ? "bg-bull/15 text-bull border-bull/40" : isNo ? "bg-bear/15 text-bear border-bear/40" : "bg-muted text-muted-foreground border-border"}`}
    >
      {value}
    </Badge>
  );
}
