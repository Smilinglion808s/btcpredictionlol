import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { createClient } from "../lib/standard-control/client";
import { canCommand, type View } from "../lib/standard-control/contract";

type Client = ReturnType<typeof createClient>;
type Review = { client: Client; auth: string; runtime: string; version: number };
function matches(review: Review, client: Client, view: View) {
  const s = view.status;
  return (
    review.client === client &&
    !!s &&
    review.auth === s.auth_session_id &&
    review.runtime === s.runtime_session_id &&
    review.version === s.version
  );
}
const permitted = (view: View) => canCommand(view, "ON", Date.now(), performance.now());

/** UI-only consent; the existing client remains responsible for auth, journal and dispatch. */
export function StandardOnConfirmation({ client }: { client: Client }) {
  const view = useSyncExternalStore(client.subscribe, client.snapshot, client.snapshot);
  const [review, setReview] = useState<Review | null>(null);
  const consent = useRef<Review | null>(null);
  const [notice, setNotice] = useState("");
  const [, tick] = useState(0);
  const dismiss = () => {
    consent.current = null;
    setReview(null);
  };

  useEffect(() => {
    consent.current = null;
    setReview(null);
    const check = () => {
      const active = consent.current;
      if (
        active &&
        (!matches(active, client, client.snapshot()) || !permitted(client.snapshot()))
      ) {
        consent.current = null;
        setReview(null);
        setNotice(
          "Confirmation expired or backend/session changed. Review the current status and request ON again.",
        );
      }
    };
    const unsubscribe = client.subscribe(check);
    const timer = setInterval(() => {
      check();
      tick((n) => n + 1);
    }, 500);
    const leave = () => {
      consent.current = null;
      setReview(null);
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", leave);
    return () => {
      consent.current = null;
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("popstate", leave);
    };
  }, [client]);

  const request = () => {
    client.sync();
    const latest = client.snapshot(),
      s = latest.status;
    if (!s || !permitted(latest)) return;
    const next = {
      client,
      auth: s.auth_session_id,
      runtime: s.runtime_session_id,
      version: s.version,
    };
    consent.current = next;
    setNotice("");
    setReview(next);
  };
  const confirm = () => {
    // Consume synchronously before any asynchronous dispatch: repeated taps cannot reuse consent.
    const active = consent.current;
    dismiss();
    client.sync();
    const latest = client.snapshot();
    if (!active || !matches(active, client, latest) || !permitted(latest)) {
      setNotice("No ON request sent. Review the current status and request ON again.");
      return;
    }
    void client.command("ON");
  };

  return (
    <>
      <AlertDialog.Root
        open={!!review}
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <AlertDialog.Trigger asChild>
          <button
            className="rounded-lg bg-cyan-300 px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={!permitted(view)}
            onClick={request}
          >
            Request ON
          </button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-600 bg-slate-950 p-5 text-slate-100 shadow-xl">
            <AlertDialog.Title className="text-xl font-semibold">
              Confirm ON request
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-3 text-sm leading-6 text-slate-300">
              Request ON for this backend session using its reviewed configured limits? This may
              enable new entries. Opening this confirmation does not send a command.
            </AlertDialog.Description>
            <p className="mt-3 break-all text-xs text-slate-400">
              Session {review?.runtime} · version {review?.version}
            </p>
            <p className="mt-3 text-sm text-slate-300">
              The backend must accept the request. This is not a live-readiness guarantee.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  onClick={dismiss}
                  className="min-h-12 flex-1 rounded-lg border border-slate-500 px-5 py-3 font-semibold"
                >
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <button
                type="button"
                disabled={!review || !matches(review, client, view) || !permitted(view)}
                onClick={confirm}
                className="min-h-12 flex-1 rounded-lg bg-cyan-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40"
              >
                Confirm ON
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {notice && (
        <p role="status" className="w-full text-sm text-amber-200">
          {notice}
        </p>
      )}
    </>
  );
}
