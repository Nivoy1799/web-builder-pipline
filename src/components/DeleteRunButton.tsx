"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  return (
    <button
      disabled={deleting}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm("Delete this run? This cannot be undone.")) return;
        setDeleting(true);
        await fetch(`/api/runs/${runId}`, { method: "DELETE" });
        router.refresh();
      }}
      style={{
        padding: "3px 7px",
        borderRadius: 4,
        border: "1px solid rgba(239,68,68,0.15)",
        background: "transparent",
        color: "rgba(239,68,68,0.45)",
        fontSize: 9,
        fontWeight: 600,
        fontFamily: "var(--mono)",
        cursor: deleting ? "not-allowed" : "pointer",
        opacity: deleting ? 0.4 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {deleting ? "..." : "Delete"}
    </button>
  );
}
