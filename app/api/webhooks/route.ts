//WebHook 

import { NextRequest, NextResponse } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { notifyTvName, extractTvNameFromMembership } from "@/lib/tv-notify";
import { notifyChurn } from "@/lib/churn-notify";
import { redis, tvNameKey } from "@/lib/redis";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Versucht mehrfach mit kurzer Pause, den Custom-Field-Wert aus der
// Mitgliedschaft zu lesen. Notwendig, weil der Custom-Field-Eintrag bei
// bestimmten Checkout-Varianten (z.B. 100%-Promo-Codes) verzögert bei Whop
// ankommt und beim ersten Abruf direkt nach dem Webhook noch nicht da ist.
async function fetchTvNameWithRetry(
  membershipId: string,
  initialMembership: any,
  attempts = 3,
  delayMs = 3000
): Promise<string | null> {
  let membership = initialMembership;

  for (let i = 0; i < attempts; i++) {
    const tvName = extractTvNameFromMembership(membership);
    if (tvName) return tvName;

    if (i < attempts - 1) {
      await sleep(delayMs);
      try {
        membership = await whopsdk.memberships.retrieve(membershipId);
      } catch (e) {
        console.error("Fehler beim erneuten Laden der Mitgliedschaft:", e);
      }
    }
  }

  return null;
}

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

      if (userId && companyId && membershipId) {
        const tvNameFromCheckout = await fetchTvNameWithRetry(membershipId, membershipData);
        if (tvNameFromCheckout) {
          await notifyTvName({
            userId,
            companyId,
            newName: tvNameFromCheckout,
            billingReason: "trial_started",
            membershipId, // NEU: direkte Zuordnung statt Listen-Suche
          });
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
        // NEU: membershipId wird mitgegeben, damit intern per direktem
        // Abruf (statt Listen-Suche) genau die Membership dieser Zahlung
        // geladen wird. Wichtig bei parallel existierenden Memberships
        // zum selben Produkt (z.B. Monats-Abo noch aktiv, während gerade
        // Lifetime gekauft wird) - sonst kann die Listen-Suche die
        // falsche/alte Membership treffen oder wegen Timing leer bleiben,
        // was die Benachrichtigung stillschweigend unterdrückt.
        await notifyTvName({
          userId,
          companyId,
          newName: null,
          payment: paymentInfo,
          billingReason,
          membershipId,
        });
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
