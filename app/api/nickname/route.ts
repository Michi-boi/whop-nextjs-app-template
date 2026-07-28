import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function POST(request: NextRequest) {
  const { userId } = await whopsdk.verifyUserToken(await headers());
  const { nickname } = await request.json();
  const tvName = (nickname ?? "").trim();

  if (!tvName) {
    return new Response("TV Username fehlt", { status: 400 });
  }

  const previousTvName = await redis.get<string>(`tvname:${userId}`);
  await redis.set(`tvname:${userId}`, tvName);

  if (!previousTvName) {
    await sendDiscord(`🆕 **Neuer Nutzer – Name gespeichert**\n**TV Username:** ${tvName}`);
  } else if (previousTvName !== tvName) {
    await sendDiscord(`✏️ **Bestehender Nutzer – Name geändert:** ${previousTvName} → ${tvName}`);
  }

  const pending = await redis.lrange<string>(`pending:${userId}`, 0, -1);
  for (const raw of pending) {
    const p = JSON.parse(raw);
    await sendDiscord(
      `💰 **Nachgemeldete Zahlung**\n\n` +
        `**TV Username:** ${tvName}\n` +
        `**Whop Username:** ${p.whopUsername}\n` +
        `**Name:** ${p.name}\n` +
        `**E-Mail:** ${p.email}\n` +
        `**Produkt:** ${p.produkt}\n` +
        `**Zahlungszyklus:** ${p.zyklus}\n` +
        `**Betrag:** ${p.betrag} ${p.waehrung}`
    );
  }
  if (pending.length > 0) {
    await redis.del(`pending:${userId}`);
  }

  return Response.json({ success: true, tvName });
}

async function sendDiscord(content: string) {
  await fetch(process.env.DISCORD_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}
