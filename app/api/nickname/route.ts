import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { whopsdk } from "@/lib/whop-sdk";

const redis = Redis.fromEnv();
const COMPANY_ID = "biz_ixlDPPqIy1alQ5";

async function sendDiscordMessage(content: string) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await whopsdk.verifyUserToken(request);

    const body = await request.json();
    const tvName = String(body.nickname ?? "").trim();

    if (!tvName) {
      return NextResponse.json({ error: "Kein TradingView Name angegeben" }, { status: 400 });
    }

    // Whop-Profildaten holen (Username, Name, E-Mail)
    let whopUsername = "unbekannt";
    let whopName = "unbekannt";
    let whopEmail = "unbekannt";

    try {
      const memberships = await whopsdk.memberships.list({
        company_id: COMPANY_ID,
        user_ids: [userId],
        first: 1,
      });
      const user = memberships.data[0]?.user;
      if (user) {
        whopUsername = user.username ?? "unbekannt";
        whopName = user.name ?? "unbekannt";
        whopEmail = (user as any).email ?? "unbekannt";

      }
    } catch (err) {
      console.error("Konnte Whop-Profildaten nicht laden", err);
    }

    const previousTvName = await redis.get<string>(`tvname:${userId}`);

    if (!previousTvName) {
      await sendDiscordMessage(
        `🆕 **Neuer Nutzer – Name gespeichert**\n` +
        `**TradingView Name:** ${tvName}\n` +
        `**Whop Username:** ${whopUsername}\n` +
        `**Name:** ${whopName}\n` +
        `**E-Mail:** ${whopEmail}`
      );
    } else if (previousTvName !== tvName) {
      await sendDiscordMessage(
        `✏️ **Bestehender Nutzer – Name geändert:** ${previousTvName} → ${tvName}\n` +
        `**Whop Username:** ${whopUsername}\n` +
        `**Name:** ${whopName}\n` +
        `**E-Mail:** ${whopEmail}`
      );
    }

    await redis.set(`tvname:${userId}`, tvName);

    // Offene Zahlungen nachliefern, die vor dem Speichern des Namens eingegangen sind
    const pendingKey = `pending:${userId}`;
    const pending = await redis.lrange<any>(pendingKey, 0, -1);

    for (const p of pending) {
      await sendDiscordMessage(
        `💰 **Nachgemeldete Zahlung**\n` +
        `**Betrag:** ${p.amount}\n` +
        `**TradingView Name:** ${tvName}\n` +
        `**Whop Username:** ${whopUsername}\n` +
        `**Name:** ${whopName}\n` +
        `**E-Mail:** ${whopEmail}\n` +
        `**Produkt:** ${p.product}\n` +
        `**Zahlungszyklus:** ${p.zyklus}`
      );
    }

    if (pending.length > 0) {
      await redis.del(pendingKey);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Fehler beim Speichern des TradingView Namens", err);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
