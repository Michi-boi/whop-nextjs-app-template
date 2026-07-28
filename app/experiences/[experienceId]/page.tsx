"use client";

import { useState, useEffect } from "react";
import { useUser } from "@whop/frosted/client";

export default function ExperiencePage() {
  const { user } = useUser();
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  // companyId aus der URL auslesen (kommt aus [experienceId])
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    // Die companyId ist in den URL-Parametern oder im Whop Context verfügbar
    // Für diese App-Experience ist sie: biz_ixlDPPqIy1alQ5
    setCompanyId("biz_ixlDPPqIy1alQ5");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim() || !user?.id || !companyId) return;

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/nickname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          companyId: companyId,
          nickname: nickname.trim(),
        }),
      });

      if (!res.ok) {
        throw new Error("Fehler beim Speichern");
      }

      setStatus("done");
      setMessage("Dein TradingView Name wurde gespeichert! ✅");
      setNickname("");
    } catch (err) {
      setStatus("error");
      setMessage("Etwas ist schiefgelaufen. Bitte versuche es erneut.");
    }
  }

  if (!user) {
    return <p style={{ margin: "60px auto", maxWidth: 480 }}>Wird geladen...</p>;
  }

  return (
    <div style={{ maxWidth: 480, margin: "60px auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Dein TradingView Name</h1>
      <p style={{ color: "#666", marginBottom: 20 }}>
        Trage hier deinen TradingView-Benutzernamen ein, damit wir dich zuordnen können.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="text"
          name="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="z. B. MeinTradingViewName"
          required
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #ccc",
            fontSize: 16,
          }}
        />

        <button
          type="submit"
          disabled={status === "loading"}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "none",
            background: "#5865F2",
            color: "white",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          {status === "loading" ? "Speichere..." : "Speichern"}
        </button>
      </form>

      {message && (
        <p style={{ marginTop: 16, color: status === "error" ? "crimson" : "green" }}>
          {message}
        </p>
      )}
    </div>
  );
}
