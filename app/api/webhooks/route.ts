import { waitUntil } from "@vercel/functions";
import type { Payment } from "@whop/sdk/resources.js";
import type { NextRequest } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { notifyTvName, extractTvNameFromMembership } from "@/lib/tv-notify";
import { redis, tvNameKey } from "@/lib/redis";

export async function POST(request: NextRequest): Promise<Response> {
  // Signatur prüfen -> stellt sicher, dass die Anfrage wirklich von Whop kommt
  const requestBodyText = await request.text();
  const headers = Object.fromEntries(request.headers);
  const webhookData = whopsdk.webhooks.unwrap(requestBodyText, { headers });

  // Verarbeitung im Hintergrund, damit wir sofort mit 200 OK antworten
  if (webhookData.type === "payment.succeeded") {
    waitUntil(handlePaymentSucceeded(webhookData.data));
  }

  return new Response("OK", { status: 200 });
}

async function handlePaymentSucceeded(payment: Payment) {
  try {
    const membershipId = payment.membership?.id;
    const userId = payment.user?.id;
    const companyId = payment.company?.id;

    if (!userId || !companyId) {
      console.error("payment.succeeded: userId oder companyId fehlt", payment.id);
      return;
    }

    // Vollständige Mitgliedschaft laden -> liefert gleichzeitig:
    // 1) den TradingView-Namen aus der Checkout-Frage (custom_field_responses)
    // 2) den Trial-Status (status: "trialing" = Erstkunde, sonst Bestandskunde)
    let tvNameFromCheckout: string | null = null;

    if (membershipId) {
      try {
        const membership = await whopsdk.memberships.retrieve(membershipId);
        tvNameFromCheckout = extractTvNameFromMembership(membership);
      } catch (e) {
        console.error("Fehler beim Laden der Mitgliedschaft:", e);
      }
    }

    const paymentInfo = {
      amount: payment.final_amount ?? payment.amount,
      currency: payment.currency,
    };

    if (tvNameFromCheckout) {
      // Name kam über die Checkout-Frage -> EINE kombinierte Nachricht (Name + Zahlung)
      await notifyTvName({
        userId,
        companyId,
        newName: tvNameFromCheckout,
        payment: paymentInfo,
      });
    } else {
      // Kein Name über Checkout -> nur senden, wenn schon einer im System existiert
      const existing = await redis.get<string>(tvNameKey(userId));
      if (existing) {
        await notifyTvName({
          userId,
          companyId,
          newName: null,
          payment: paymentInfo,
        });
      }
      // sonst: keine Nachricht (Regel "Zahlung ohne TV-Name im System")
    }
  } catch (e) {
    console.error("Fehler bei payment.succeeded Verarbeitung:", e);
  }
}
