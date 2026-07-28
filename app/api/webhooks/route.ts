import { waitUntil } from "@vercel/functions";
import type { Payment } from "@whop/sdk/resources.js";
import type { NextRequest } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

function zahlungszyklus(formatted?: string | null): string {
  if (!formatted) return "Einmalig";
  if (formatted.includes("/ month")) return "Monatlich";
  if (formatted.includes("/ year")) return "Jährlich";
  if (formatted.includes("/ week")) return "Wöchentlich";
  if (formatted.includes("/ day")) return "Täglich";
  return "Einmalig";
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestBodyText = await request.text();
  const headers = Object.fromEntries(request.headers);
  const webhookData = whopsdk.webhooks.unwrap(requestBodyText, { headers });

  if (webhookData.type === "payment.succeeded") {
    waitUntil(handlePaymentSucceeded(webhookData.data));
  }

  return new Response("OK", { status: 200 });
}

async function handlePaymentSucceeded(payment: Payment) {
  const userId = payment.user?.id;
  if (!userId) return;

  const whopUsername = payment.user?.username ?? "unbekannt";
  const name = payment.user?.name ?? "unbekannt";
  const email = payment.user?.email ?? "unbekannt";
  const produkt = payment.product?.title ?? "unbekannt";
  const betrag = payment.total ?? 0;
  const waehrung = (payment.currency ?? "usd").toUpperCase();

  let zyklus = "unbekannt";
  try {
    if (payment.membership?.id) {
      const membership = await whopsdk.memberships.retrieve(payment.membership.id);
      zyklus = zahlungszyklus(membership.formatted_renewal_price);
    }
  } catch (err) {
    console.error("Membership konnte nicht geladen werden", err);
  }

  const infoBlock =
    `**Whop Username:** ${whopUsername}\n` +
    `**Name:** ${name}\n` +
    `**E-Mail:** ${email}\n` +
    `**Produkt:** ${produkt}\n` +
    `**Zahlungszyklus:** ${zyklus}\n` +
    `**Betrag:** ${betrag} ${waehrung}`;

  const tvName = await redis.get<string>(`tvname:${userId}`);

  if (!tvName) {
    await redis.rpush(
      `pending:${userId}`,
      JSON.stringify({ whopUsername, name, email, produkt, zyklus, betrag, waehrung })
    );
    await sendDiscord(
      `💰 **Neue Zahlung eingegangen!**\n⏳ TV Username noch nicht hinterlegt\n\n${infoBlock}`
    );
    return;
  }

  await sendDiscord(
    `💰 **Neue Zahlung eingegangen!**\n\n**TV Username:** ${tvName}\n${infoBlock}`
  );
}

async function sendDiscord(content: string) {
  await fetch(process.env.DISCORD_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}
