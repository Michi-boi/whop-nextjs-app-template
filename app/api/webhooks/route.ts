import { NextRequest, NextResponse } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { notifyTvName, extractTvNameFromMembership } from "@/lib/tv-notify";
import { notifyChurn } from "@/lib/churn-notify";
import { redis, tvNameKey } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const event = JSON.parse(body);

  // Feuert SOFORT bei Mitgliedschaftsstart (auch im Trial, ohne Zahlung)
  // -> das ist der EINZIGE Ort, an dem der Checkout-Name als "neu" gilt.
  if (event.type === "membership.activated") {
    try {
      const membershipData = event.data;
      const membershipId = membershipData?.id;
      const userId = membershipData?.user?.id;
      const companyId = membershipData?.company?.id;

      if (userId && companyId) {
        let membership = membershipData;
        if (!membership?.custom_field_responses && membershipId) {
          membership = await whopsdk.memberships.retrieve(membershipId);
        }
        const tvNameFromCheckout = extractTvNameFromMembership(membership);
        if (tvNameFromCheckout) {
          await notifyTvName({ userId, companyId, newName: tvNameFromCheckout, billingReason: "trial_started" });
        }
      }
    } catch (e) {
      console.error("Fehler bei membership.activated Verarbeitung:", e);
    }
  }

  if (event.type === "payment.succeeded") {
    try {
      const payment = event.data;
      const membershipId = payment.membership?.id;
      const userId = payment.user?.id ?? payment.user_id;
      const companyId = payment.company?.id ?? payment.company_id;

      if (!userId || !companyId) {
        console.error("payment.succeeded: userId oder companyId fehlt", payment.id);
        return NextResponse.json({ received: true });
      }

      const billingReason = payment.billing_reason ?? null;

      const paymentInfo = {
        amount: payment.final_amount ?? payment.amount,
        currency: payment.currency,
      };

      // WICHTIG: payment.succeeded fasst den TV-Namen NIE an - weder bei
      // Erstzahlung noch bei Verlängerung. Der Checkout-Name wird
      // ausschließlich bei membership.activated erfasst (Neueintritt ins
      // Produkt). Bis zum nächsten Neueintritt gilt danach ausschließlich
      // der zuletzt über /api/nickname gespeicherte Wert. Hier wird nur
      // der bereits gespeicherte Name (falls vorhanden) für die
      // Zahlungs-Benachrichtigung mitgegeben.
      const existing = await redis.get<string>(tvNameKey(userId));

      if (existing) {
        await notifyTvName({ userId, companyId, newName: null, payment: paymentInfo, billingReason });
      }
      // Kein existing -> noch kein Name bekannt (sollte durch
      // membership.activated normalerweise schon erfasst sein), dann gibt
      // es hier nichts zu melden.
    } catch (e) {
      console.error("Fehler bei payment.succeeded Verarbeitung:", e);
    }
  }

  if (event.type === "membership.deactivated") {
    try {
      await notifyChurn(event.data);
    } catch (e) {
      console.error("Fehler bei membership.deactivated Verarbeitung:", e);
    }
  }

  return NextResponse.json({ received: true });
}
