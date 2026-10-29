import { kv } from "@vercel/kv";

const ROLE_ID = "1565074372044259371";
const MAX_PER_RUN = 20;

async function getAccessToken() {
  const res = await fetch(`${process.env.ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Zoho token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function listMessages(token) {
  const url = `${process.env.ZOHO_MAIL_DOMAIN}/api/accounts/${process.env.ZOHO_ACCOUNT_ID}/messages/view?folderId=${process.env.ZOHO_FOLDER_ID}&limit=${MAX_PER_RUN}&sortorder=false`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!res.ok) throw new Error(`Zoho API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data || [];
}

async function postToDiscord({ from, subject }) {
  const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `<@&${ROLE_ID}> **New support email**\n**From:** ${from}\n**Subject:** ${subject}`,
      allowed_mentions: { roles: [ROLE_ID] },
    }),
  });
  if (!res.ok) throw new Error(`Discord error ${res.status}: ${await res.text()}`);
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const token = await getAccessToken();
    const messages = await listMessages(token);

    // First run: seed existing messages without pinging, so you don't get spammed.
    const seeded = await kv.get("seeded");
    let processed = 0;

    for (const msg of messages) {
      const key = `seen:${msg.messageId}`;
      if (await kv.get(key)) continue;

      if (seeded) {
        await postToDiscord({
          from: msg.fromAddress || msg.sender || "unknown",
          subject: msg.subject || "(no subject)",
        });
        processed++;
      }

      await kv.set(key, 1, { ex: 60 * 60 * 24 * 30 });
    }

    if (!seeded) await kv.set("seeded", 1);

    return res.status(200).json({ checked: messages.length, processed });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
