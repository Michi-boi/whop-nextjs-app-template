
// und der andere:
import { Redis } from "@upstash/redis";
import { whopsdk } from "@/lib/whop-sdk";
import { sendDiscordEmbed } from "./discord";

const redis = Redis.fromEnv();

export const TV_QUESTION_TEXT = "Wie lautet dein TradingView-Benutzername?";

const ALLOWED_PRODUCT_ID = "prod_vPTqfmAJBrWMa"; // Seasonality Scanner Indikator

export type PaymentInfo = {
  amount: number;
  currency: string;
};

const COLORS = {
  neu: 3066993,
  verlaengerung: 3447003,
  neuerName: 1752220,
  geaendert: 15105570,
  fallback: 15844367,
};

function tvNameKey(userId: string) {
  return `tvname:${userId}`;
}

// NEU: Rechnet aus, wie viele Tage bis zu einem Datum verbleiben (min. 0)
function daysUntil(dateStr: string): number {
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export async function getUserBasicInfo(userId: string) {
  try {
    const user = await whopsdk.users.retrieve(userId);
    return { name: user.name ?? null, username: user.username ?? null };
  } catch (e) {
    console.error("getUserBasicInfo fehlgeschlagen:", e);
    return { name: null, username: null };
  }
}















export async function getMembershipDetails(userId: string, companyId: string, productId?: string) {
  try {
    const memberships = await whopsdk.memberships.list({
      company_id: companyId,
      user_ids: [userId],
      statuses: ["active", "trialing", "completed"], // completed = abgeschlossene Lifetime-Käufe (one_time)
      first: 10,
    } as any);

    let membership: any = null;
    if (productId) {
      membership = memberships.data.find((m: any) => m.product?.id === productId) ?? null;
    } else {
      membership = memberships.data[0] ?? null;
    }

    if (!membership) {
      return { username: null, name: null, email: null, produkt: null, produkt_id: null, zyklus: null, status: null, trialEndsAt: null };
    }

    return {
      username: membership.user?.username ?? null,
      name: membership.user?.name ?? null,
      email: membership.user?.email ?? null,
      produkt: membership.product?.title ?? null,
      produkt_id: membership.product?.id ?? null,
      zyklus: membership.formatted_renewal_price ?? membership.initial_price_paid ?? null,
      status: membership.status ?? null,
      trialEndsAt: membership.renewal_period_end ?? null,
    };
  } catch (e) {
    console.error("getMembershipDetails fehlgeschlagen:", e);
    return { username: null, name: null, email: null, produkt: null, produkt_id: null, zyklus: null, status: null, trialEndsAt: null };
  }
}






export async function getLastPaymentDate(
  userId: string,
  companyId: string,
  status?: string | null
): Promise<string> {
  try {
    const payments = await whopsdk.payments.list({
      company_id: companyId,
      query: userId,
      statuses: ["paid"],
      order: "paid_at",
      direction: "desc",
      first: 1,
    } as any);

    const lastPayment: any = payments.data[0];

    if (!lastPayment) {
      if (status === "trialing") {
        return "Noch keine Zahlung – aktuell im Trial";
      }
      return "Keine Zahlung gefunden";
    }

    const paidAt = lastPayment.paid_at ?? lastPayment.created_at;
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(new Date(paidAt));
  } catch (e) {
    console.error("getLastPaymentDate fehlgeschlagen:", e);
    return "Keine Zahlung gefunden";
  }
}

export function statusTag(status: string | null): string {
  if (status === "trialing") {
    return "🆕 Erstkunde (im Trial)";
  }
  return "🔁 Bestandskunde (normale Zahlung, kein Trial)";
}





export function extractTvNameFromMembership(membership: any): string | null {
  const responses = membership?.custom_field_responses ?? [];

  if (responses.length === 0) {
    console.log("[tv-notify] Keine custom_field_responses auf Membership:", membership?.id);
    return null;
  }

  const normalize = (s: string | undefined) => s?.trim().toLowerCase() ?? "";

  let answer = responses.find(
    (r: any) => normalize(r.question) === normalize(TV_QUESTION_TEXT)
  );

  if (!answer) {
    // Fallback: falls sich der Fragetext leicht unterscheidet
    answer = responses.find((r: any) => normalize(r.question).includes("tradingview"));
  }

  if (!answer) {
    console.log(
      "[tv-notify] TradingView-Frage nicht gefunden. Vorhandene Fragen:",
      responses.map((r: any) => r.question)
    );
    return null;
  }

  return answer.answer ?? null;
}


export async function notifyTvName({
  userId,
  companyId,
  newName,
  payment,
  billingReason,
}: {
  userId: string;
  companyId: string;
  newName: string | null;
  payment?: PaymentInfo | null;
  billingReason?: string | null;
}) {
  const membershipDetails = await getMembershipDetails(userId, companyId, ALLOWED_PRODUCT_ID);
  if (membershipDetails.produkt_id !== ALLOWED_PRODUCT_ID) {
    return;
  }

  const oldName = await redis.get<string>(tvNameKey(userId));

  const isNew = !!newName && !oldName;
  const isChanged = !!newName && !!oldName && newName !== oldName;

  const nameUnchanged = !!newName && !isNew && !isChanged;
  if (nameUnchanged && !payment) {
    return;
  }

  const nameToShow = newName ?? oldName;

  if (!nameToShow && !payment) return;

  if (newName && (isNew || isChanged)) {
    await redis.set(tvNameKey(userId), newName);
  }

  let icon = "💰";
  let title = "Zahlung erhalten";
  let color = COLORS.fallback;

  if (payment && billingReason === "subscription_create") {
    icon = "🆕";
    title = "Neue Mitgliedschaft";
    color = COLORS.neu;
  } else if (payment && billingReason === "subscription_cycle") {
    icon = "🔄";
    title = "Erfolgreiche Verlängerung";
    color = COLORS.verlaengerung;
  } else if (isChanged) {
    icon = "✏️";
    title = "TV-Name geändert";
    color = COLORS.geaendert;
  
  } else if (billingReason === "trial_started") {
      icon = "🆕";
      title = "Trial gestartet";
      color = COLORS.neu;
    
  } else if (isNew) {
    icon = "📈";
    title = "Neuer TV-Name";
    color = COLORS.neuerName;
  }

  const { username, name, email, produkt, zyklus, status, trialEndsAt } = membershipDetails;

  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (username) {
    fields.push({
      name: "👤 Whop-Nutzer",
      value: name ? `${username} (${name})` : username,
      inline: true,
    });
  }
  if (email) fields.push({ name: "📧 E-Mail", value: email, inline: true });
  if (produkt) fields.push({ name: "📦 Produkt", value: produkt, inline: true });
  if (zyklus) fields.push({ name: "🔁 Abo-Zyklus", value: zyklus, inline: true });

  if (payment) {
    fields.push({
      name: "💵 Zahlung",
      value: `${payment.amount} ${payment.currency.toUpperCase()}`,
      inline: true,
    });
  }

  if (isChanged) {
    fields.push({ name: "📈 Bisheriger Name", value: oldName as string, inline: true });
  }

  // NEU: Letzte Zahlung wird jetzt auch angezeigt, wenn der Name zum ersten Mal
  // eingetragen wird (z.B. Bestandskunde, der zum ersten Mal seinen TV-Namen einträgt)
  if (isChanged || isNew) {
    const lastPaymentInfo = await getLastPaymentDate(userId, companyId, status);
    fields.push({ name: "🗓️ Letzte Zahlung", value: lastPaymentInfo });
  }

  if (nameToShow) {
    fields.push({
      name: isChanged ? "📈 Neuer TradingView-Name" : "📈 TradingView-Name",
      value: nameToShow,
    });
  }

  fields.push({ name: "📌 Status", value: statusTag(status) });

  // NEU: Bei einer laufenden Testversion zusätzlich anzeigen, wie viele Tage sie noch offen ist

  if (trialEndsAt) {
    const days = daysUntil(trialEndsAt);
    const label = status === "trialing" ? "🧪 Test-Phase endet in" : "📅 Abo läuft noch";
    fields.push({
      name: label,
      value: `${days} Tag${days === 1 ? "" : "en"}`,
      inline: true,
    });
  }


  
  await sendDiscordEmbed({
    title: `${icon} ${title}`,
    color,
    fields,
  });
}





