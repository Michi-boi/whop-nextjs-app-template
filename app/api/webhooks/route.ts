import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const kv = Redis.fromEnv();

async function sendToDiscord(message: string) {
  await fetch(process.env.DISCORD_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const userId = form.get("userId") as string;
  const newNickname = (form.get("nickname") as string)?.trim();

  if (!userId || !newNickname) {
    return NextResponse.json({ error: "Fehlende Daten" }, { status: 400 });
  }

  const oldNickname = await kv.get<string>(`nickname:${userId}`);
  await kv.set(`nickname:${userId}`, newNickname);

  if (oldNickname && oldNickname !== newNickname) {
    await sendToDiscord(`✏️ **Bestehender Nutzer – Name geändert:** ${oldNickname} → ${newNickname}`);
  } else if (!oldNickname) {
    await sendToDiscord(`🆕 **Neuer Nutzer – Nickname gespeichert:** ${newNickname}`);
  }

  const pending = await kv.get<number[]>(`pending:${userId}`);
  if (pending && pending.length > 0) {
    for (const amount of pending) {
      await sendToDiscord(`💰 **Zahlung (nachgetragen):** $${amount} von **${newNickname}**`);
    }
    await kv.del(`pending:${userId}`);
  }

  return NextResponse.redirect(new URL("/", req.url));
}
