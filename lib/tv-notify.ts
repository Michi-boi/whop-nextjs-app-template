import { Redis } from "@upstash/redis";
import { whopsdk } from "@/lib/whop-sdk";
import { sendDiscordEmbed } from "./discord";

const redis = Redis.fromEnv();

export const TV_QUESTION_TEXT = "Wie lautet dein TradingView-Benutzername?";

export type PaymentInfo = {
  amount: number;
  currency: string;
};

const COLORS = {
  neu: 3066993,           // grün – Neue Mitgliedschaft
  verlaengerung: 3447003, // blau – Erfolgreiche Verlängerung
  neuerName: 1752220,     // türkis – Neuer TV-Name
  geaendert: 15105570,    // orange – TV-Name geändert
  fallback: 15844367,     // gold – Zahlung erhalten
};

function tvNameKey(userId: string) {
  return `tvname:${userId}`;
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

export async function getMembershipDetails(userId: string, companyId: string) {
  try {
    const memberships = await whopsdk.memberships.list({
      company_id: companyId,
      user_id: userId,
      first: 1,
    } as any);

    const membership: any = memberships.data[0];
    if (!membership) {
      return { username: null, name: null, email: null, produkt: null, zyklus: null, status: null };
    }

    return {
      username: membership.user?.username ?? null,
      name: membership.user?.name ?? null,
      email: membership.user?.email ?? null,
      produkt: membership.product?.title ?? null,
      // Whop liefert Preis + Intervall bereits fertig formatiert
      zyklus: membership.formatted_renewal_price ?? membership.initial_price_paid ?? null,
      status: membership.status ?? null,
    };
  } catch (e) {
    console.error("getMembershipDetails fehlgeschlagen:", e);
    return { username: null, name: null, email: null, produkt: null, zyklus: null, status: null };
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
  const answer = membership?.custom_field_responses?.find(
    (r: any) => r.question?.trim() === TV_QUESTION_TEXT
  );
  return answer?.answer ?? null;
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
  const oldName = await redis.get<string>(tvNameKey(userId));

  const isNew = !!newName && !oldName;
  const isChanged = !!newName && !!oldName && newName !== oldName;

  // NEU: eingereichter Name ist identisch mit dem bereits gespeicherten
  // und es handelt sich nicht um eine Zahlung -> keine Nachricht senden
  const nameUnchanged = !!newName && !isNew && !isChanged;
  if (nameUnchanged && !payment) {
    return;
  }

  const nameToShow = newName ?? oldName;

  // Weder Name noch Zahlung -> keine Nachricht
  if (!nameToShow && !payment) return;

  if (newName && (isNew || isChanged)) {
    await redis.set(tvNameKey(userId), newName);
  }

  // ... ab hier bleibt der Rest exakt wie vorher (icon/title/color-Logik, fields, sendDiscordEmbed)


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
  } else if (isNew) {
    icon = "📈";
    title = "Neuer TV-Name";
    color = COLORS.neuerName;
  }

  const { username, name, email, produkt, zyklus, status } = await getMembershipDetails(
    userId,
    companyId
  );

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

    const lastPaymentInfo = await getLastPaymentDate(userId, companyId, status);
    fields.push({ name: "🗓️ Letzte Zahlung", value: lastPaymentInfo });
  }

  // Aktueller TV-Name steht IMMER allein im eigenen Feld,
  // ohne Zusatztext davor/danach -> auf Mobile sauber kopierbar
  if (nameToShow) {
    fields.push({
      name: isChanged ? "📈 Neuer TradingView-Name" : "📈 TradingView-Name",
      value: nameToShow,
    });
  }

  fields.push({ name: "📌 Status", value: statusTag(status) });

  await sendDiscordEmbed({
    title: `${icon} ${title}`,
    color,
    fields,
  });
}
