import { headers } from "next/headers";
import { Redis } from "@upstash/redis";
import { whopsdk } from "@/lib/whop-sdk";

const kv = Redis.fromEnv();

export default async function ExperiencePage() {
  const { userId } = await whopsdk.verifyUserToken(await headers());
  const existingNickname = await kv.get<string>(`TradingView Name:${userId}`);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 400, margin: "0 auto" }}>
      <h2>Dein TradingView Name</h2>
      <p>Dieser Name wird bei jeder Zahlung an Discord gesendet.</p>
      <form action="/api/nickname" method="POST">
        <input type="hidden" name="userId" value={userId} />
        <input
          type="text"
          name="TradingView Name"
          defaultValue={existingNickname ?? ""}
          placeholder="z.B. MaxMustermann"
          required
          style={{ padding: 8, width: "100%", marginBottom: 12, fontSize: 16 }}
        />
        <button type="submit" style={{ padding: "8px 16px", fontSize: 16, cursor: "pointer" }}>
          Speichern
        </button>
      </form>
    </div>
  );
}
