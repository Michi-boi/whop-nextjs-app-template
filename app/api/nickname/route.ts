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

function zahlungszyklus(formatted?: string | null): string {
  if (!formatted) return "unbekannt";
  if (formatted.includes("/ month")) return "Monatlich";
  if (formatted.includes("/ year")) return "Jährlich";
  if (formatted.includes("/ week")) return "Wöchentlich";
  if (formatted.includes("/ day")) return "Täglich";
  return "Einmalig";
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await whopsdk.verifyUserToken(request);

    const body = await request.json();
    const tvName = String(body.nickname ?? "").trim();

    if (!tvName) {
      return NextResponse.json({ error: "Kein TradingView Name angegeben" }, { status: 400 });
    }

    let whopUsername = "unbekannt";
    let whopName = "unbekannt";
    let whopEmail = "unbekannt";
    let produkt = "unbekannt";
    let zyklus = "unbekannt";

    try {
      const user = await whopsdk.users.retrieve(userId);
      whopUsername = user.username ?? "unbekannt";
      whopName = user.name ?? "unbekannt";
    } catch (err) {
      console.error("Konnte Whop-Nutzer nicht laden", err);
    }

    try {
      const memberships = await whopsdk.memberships.list({
        company_id: COMPANY_ID,
        user_ids: [userId],
        first: 1,
      });
      const membership = memberships.data[0];
      if (membership) {
        whopEmail = (membership.user as any)?.email ?? "unbekannt";
        produkt = membership.product?.title ?? "unbekannt";
        zyklus = zahlungszyklus((membership as any).formatted_renewal_price);
      }
    } catch (err) {
      console.error("Konnte Mitgliedschaftsdaten nicht laden", err);
    }

    const previousTvName = await redis.get<string>(`tvname:${userId}`);

    const infoBlock =
      `**TradingView Name:** ${tvName}\n` +
      `**Whop Username:** ${whopUsername}\n` +
      `**Name:** ${whopName}\n` +
      `**E-Mail:** ${whopEmail}\n` +
      `**Produkt:** ${produkt}\n` +
      `**Zahlungszyklus:** ${zyklus}`;

    if (!previousTvName) {
      await sendDiscordMessage(`🆕 **Neuer Nutzer – Name gespeichert**\n${infoBlock}`);
    } else if (previousTvName !== tvName) {
      await sendDiscordMessage(
        `✏️ **Bestehender Nutzer – Name geändert: ${previousTvName} → ${tvName}**\n${infoBlock}`
      );
    } else {
      await sendDiscordMessage(`ℹ️ **Name erneut bestätigt (unverändert)**\n${infoBlock}`);
    }

    await redis.set(`tvname:${userId}`, tvName);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Fehler beim Speichern des TradingView Namens", err);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
