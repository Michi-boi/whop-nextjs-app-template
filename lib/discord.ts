type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
};

export async function sendDiscordMessage(
  content: string | null,
  embed?: DiscordEmbed
) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL fehlt");
    return;
  }

  const payload: Record<string, unknown> = {};
  if (content) payload.content = content;
  if (embed) payload.embeds = [embed];

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("Discord-Nachricht fehlgeschlagen:", e);
  }
}
