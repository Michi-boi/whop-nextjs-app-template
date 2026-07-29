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

    const membership = memberships.data[0];
    if (!membership) {
      return { email: null, produkt: null, zyklus: null, status: null };
    }

    const email = (membership as any).email ?? (membership as any).user?.email ?? null;
    const produkt =
      (membership as any).product?.title ??
      (membership as any).plan?.product?.title ??
      null;
    const zyklus =
      (membership as any).plan?.billing_period != null
        ? `${(membership as any).plan.billing_period} Tage`
        : (membership as any).plan?.plan_type ?? null;
    const status = membership.status ?? null;

    return { email, produkt, zyklus, status };
  } catch (e) {
    console.error("getMembershipDetails fehlgeschlagen:", e);
    return { email: null, produkt: null, zyklus: null, status: null };
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

    const lastPayment = payments.data[0];

    if (!lastPayment) {
      if (status === "trialing") {
        return "Noch keine Zahlung – aktuell im Trial";
      }
      return "Keine Zahlung gefunden";
    }

    const paidAt = (lastPayment as any).paid_at ?? lastPayment.created_at;
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
  return "🔁 Bestandskunde";
}

export function extractTvNameFromMembership(membership: any): string | null {
  const metadata = membership?.metadata ?? membership?.custom_field_responses ?? null;
  if (!metadata) return null;
  return metadata.tv_name ?? metadata.tradingview_name ?? metadata.tvName ?? null;
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
  const redisKey = `tvname:${userId}`;
  const oldName = await redis.get<string>(redisKey);

  const isNew = !!newName && !oldName;
  const isChanged = !!newName && !!oldName && newName !== oldName;

  // Kein neuer Name und auch kein alter gespeichert -> keine Nachricht senden
  if (!newName && !oldName) {
    return;
  }

  if (newName && (isNew || isChanged)) {
    await redis.set(redisKey, newName);
  }

  const nameToShow = newName ?? oldName;

  let icon = "💳";
  let title = "Zahlung erhalten";
  let color = COLORS.fallback;

  if (billingReason === "subscription_create") {
    icon = "🆕";
    title = "Neue Mitgliedschaft";
    color = COLORS.neu;
  } else if (billingReason === "subscription_cycle") {
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

  const { email, produkt, zyklus, status } = await getMembershipDetails(userId, companyId);

  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (email) fields.push({ name: "📧 E-Mail", value: email, inline: true });
  if (produkt) fields.push({ name: "📦 Produkt", value: produkt, inline: true });
  if (zyklus) fields.push({ name: "🔁 Zyklus", value: zyklus, inline: true });
  fields.push({ name: "📌 Status", value: statusTag(status), inline: true });

  if (payment) {
    fields.push({
      name: "💰 Zahlung",
      value: `${payment.amount} ${payment.currency.toUpperCase()}`,
      inline: true,
    });
  }

  if (isChanged) {
    const lastPaymentInfo = await getLastPaymentDate(userId, companyId, status);
    fields.push({ name: "🕓 Letzte Zahlung", value: lastPaymentInfo });
  }

  // TV-Name immer als letztes, eigenes Feld — leicht zu markieren/kopieren
  if (nameToShow) {
    fields.push({
      name: "📈 TradingView-Name",
      value: "```\n" + nameToShow + "\n```",
    });
  }

  await sendDiscordEmbed({
    title: `${icon} ${title}`,
    color,
    fields,
  });
}
