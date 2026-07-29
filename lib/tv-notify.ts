import { whopsdk } from "@/lib/whop-sdk";
import { redis, tvNameKey } from "@/lib/redis";
import { sendDiscordMessage } from "@/lib/discord";

const TV_QUESTION_TEXT = "Dein TradingView-Benutzername";

type PaymentInfo = { amount: number; currency: string };

async function getUserBasicInfo(userId: string) {
  let username = "unbekannt";
  let name = "unbekannt";
  try {
    const user = await whopsdk.users.retrieve(userId);
    username = user.username ?? "unbekannt";
    name = user.name ?? "unbekannt";
  } catch (e) {
    console.error("Fehler beim Laden des Nutzers:", e);
  }
  return { username, name };
}

async function getMembershipDetails(userId: string, companyId: string) {
  let email = "unbekannt";
  let produkt = "unbekannt";
  let zyklus = "unbekannt";
  let status: string | null = null;

  try {
    const memberships = await whopsdk.memberships.list({
      company_id: companyId,
      user_ids: [userId],
      first: 1,
    });
    const membership = memberships.data[0];
    if (membership) {
      email = (membership.user as any)?.email ?? "unbekannt";
      produkt = membership.product?.title ?? "unbekannt";
      zyklus = (membership as any).formatted_renewal_price ?? "unbekannt";
      status = membership.status ?? null;
    }
  } catch (e: any) {
    console.error("Fehler beim Laden der Mitgliedschaft:", e);
  }

  return { email, produkt, zyklus, status };
}

function statusTag(status: string | null): string {
  if (status === "trialing") return "🆕 Erstkunde (aktuell im 10-Tage-Trial)";
  if (status) return "🔁 Bestandskunde (normale Zahlung, kein Trial)";
  return "";
}

export function extractTvNameFromMembership(membership: any): string | null {
  const answer = membership?.custom_field_responses?.find(
    (r: any) => r.question?.trim() === TV_QUESTION_TEXT
  );
  return answer?.answer ?? null;
}

export async function notifyTvName(params: {
  userId: string;
  companyId: string;
  newName: string | null;
  payment?: PaymentInfo | null;
  billingReason?: string | null; // NEU
}) {
  const { userId, companyId, newName, payment, billingReason } = params;
  if (!newName && !payment) return;

  const oldName = await redis.get<string>(tvNameKey(userId));
  const effectiveName = newName ?? oldName;
  if (!effectiveName) return;

  const isNew = !!newName && !oldName;
  const isChanged = !!newName && !!oldName && oldName !== newName;

  if (isNew || isChanged) {
    await redis.set(tvNameKey(userId), newName as string);
  }

  if (!isNew && !isChanged && !payment) return;

  const { username, name } = await getUserBasicInfo(userId);
  const { email, produkt, zyklus, status } = await getMembershipDetails(userId, companyId);

  let icon = "💰";
  let title = "Zahlung erhalten";

  // NEU: Bei einer Zahlung entscheidet billingReason über die Überschrift
  if (payment && billingReason === "subscription_create") {
    icon = "🆕";
    title = "Neue Mitgliedschaft";
  } else if (payment && billingReason === "subscription_cycle") {
    icon = "🔄";
    title = "Erfolgreiche Verlängerung";
  } else if (isNew) {
    icon = "🆕";
    title = "Neuer TradingView-Name eingetragen";
  } else if (isChanged) {
    icon = "✏️";
    title = "TradingView-Name geändert";
  }

  const lines = [`${icon} **${title}**`];
  lines.push(`👤 Whop-Nutzer: ${username} (${name})`);
  lines.push(`📧 E-Mail: ${email}`);
  lines.push(`📦 Produkt: ${produkt}`);
  lines.push(`🔁 Abo-Zyklus: ${zyklus}`);
  lines.push(
    isChanged
      ? `TradingView-Name: ${oldName} →\n\`\`\`\n${newName}\n\`\`\``
      : `📈 TradingView-Name:\n\`\`\`\n${effectiveName}\n\`\`\``
  );

  if (payment) {
    lines.push(`💵 Betrag: ${payment.amount} ${payment.currency.toUpperCase()}`);
  }
  const tag = statusTag(status);
  if (tag) lines.push(tag);

  await sendDiscordMessage(lines.join("\n"));
}
