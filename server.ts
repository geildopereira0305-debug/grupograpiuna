import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import closeContractHandler from "./api/commercial/close-contract";

dotenv.config({ path: ".env.local" });
dotenv.config();

const IG_GRAPH = "https://graph.facebook.com/v21.0";
const igGet = async (url: string) => {
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  // Necessario para as rotas comerciais lerem o corpo JSON
  app.use(express.json());
  const PORT = 3000;

  // Espelha api/commercial/close-contract.ts (transacional; exige Firebase Admin)
  app.post("/api/commercial/close-contract", (req, res) => closeContractHandler(req, res));

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Espelha api/youtube/live.ts (caro, search.list = 100u; cache 15min na Vercel)
  app.get("/api/youtube/live", async (_req, res) => {
    const API_KEY = process.env.YOUTUBE_API_KEY;
    const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

    if (!API_KEY || !CHANNEL_ID) {
      res.status(500).json({ error: "Missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID" });
      return;
    }

    type ApiError = { source: string; status: number; reason?: string; message?: string };
    const readErr = async (r: Response, source: string): Promise<ApiError> => {
      const body = await r.json().catch(() => null);
      return { source, status: r.status, reason: body?.error?.errors?.[0]?.reason, message: body?.error?.message };
    };
    const errors: ApiError[] = [];

    try {
      const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=id&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`);
      let viewers = 0;
      let isLive = false;
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const liveVideoId: string | undefined = searchData.items?.[0]?.id?.videoId;
        if (liveVideoId) {
          isLive = true;
          const videoRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${liveVideoId}&key=${API_KEY}`);
          if (videoRes.ok) {
            const videoData = await videoRes.json();
            const concurrent = videoData.items?.[0]?.liveStreamingDetails?.concurrentViewers;
            viewers = concurrent ? parseInt(concurrent, 10) : 0;
          } else {
            errors.push(await readErr(videoRes, "videos"));
          }
        }
      } else {
        errors.push(await readErr(searchRes, "search"));
      }

      const payload: any = { viewers, isLive };
      if (errors.length) payload.errors = errors;
      res.status(200).json(payload);
    } catch (err) {
      console.error("[youtube/live] exception", err);
      res.status(500).json({ error: "fetch failed" });
    }
  });

  // Espelha api/youtube/channel.ts (barato, channels.list = 1u; cache 1h na Vercel)
  app.get("/api/youtube/channel", async (_req, res) => {
    const API_KEY = process.env.YOUTUBE_API_KEY;
    const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

    if (!API_KEY || !CHANNEL_ID) {
      res.status(500).json({ error: "Missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID" });
      return;
    }

    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${CHANNEL_ID}&key=${API_KEY}`);
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        res.status(200).json({
          subscribers: 0, totalViews: 0, videoCount: 0, channelTitle: "",
          error: {
            status: r.status,
            reason: body?.error?.errors?.[0]?.reason,
            message: body?.error?.message,
          },
        });
        return;
      }
      const data = await r.json();
      const stats = data.items?.[0]?.statistics ?? {};
      const snippet = data.items?.[0]?.snippet ?? {};
      res.status(200).json({
        subscribers: parseInt(stats.subscriberCount ?? "0", 10),
        totalViews: parseInt(stats.viewCount ?? "0", 10),
        videoCount: parseInt(stats.videoCount ?? "0", 10),
        channelTitle: snippet.title ?? "",
      });
    } catch (err) {
      console.error("[youtube/channel] exception", err);
      res.status(500).json({ error: "fetch failed" });
    }
  });

  // Espelha api/instagram/insights.ts (Instagram Graph API; cache 30min na Vercel)
  app.get("/api/instagram/insights", async (_req, res) => {
    const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
    const IG_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!TOKEN || !IG_ID) {
      res.status(200).json({
        configured: false,
        profile: { username: "", name: "", profilePictureUrl: "", followers: 0, mediaCount: 0 },
        insights: { reach: 0, profileViews: 0 },
        media: [],
      });
      return;
    }

    const errors: { source: string; status?: number; message?: string }[] = [];

    try {
      const profile = { username: "", name: "", profilePictureUrl: "", followers: 0, mediaCount: 0 };
      {
        const fields = "username,name,profile_picture_url,followers_count,media_count";
        const { ok, status, data } = await igGet(`${IG_GRAPH}/${IG_ID}?fields=${fields}&access_token=${TOKEN}`);
        if (ok && data) {
          profile.username = data.username ?? "";
          profile.name = data.name ?? "";
          profile.profilePictureUrl = data.profile_picture_url ?? "";
          profile.followers = data.followers_count ?? 0;
          profile.mediaCount = data.media_count ?? 0;
        } else {
          errors.push({ source: "profile", status, message: data?.error?.message });
        }
      }

      const insights = { reach: 0, profileViews: 0 };
      {
        const { ok, status, data } = await igGet(
          `${IG_GRAPH}/${IG_ID}/insights?metric=reach,profile_views&period=day&metric_type=total_value&access_token=${TOKEN}`,
        );
        if (ok && Array.isArray(data?.data)) {
          for (const m of data.data) {
            const value = m?.total_value?.value ?? m?.values?.[0]?.value ?? 0;
            if (m.name === "reach") insights.reach = value;
            if (m.name === "profile_views") insights.profileViews = value;
          }
        } else {
          errors.push({ source: "insights", status, message: data?.error?.message });
        }
      }

      const media: any[] = [];
      {
        const fields =
          "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
        const { ok, status, data } = await igGet(
          `${IG_GRAPH}/${IG_ID}/media?fields=${fields}&limit=12&access_token=${TOKEN}`,
        );
        if (ok && Array.isArray(data?.data)) {
          for (const item of data.data) {
            media.push({
              id: item.id,
              caption: item.caption ?? "",
              mediaType: item.media_type ?? "",
              mediaUrl: item.media_type === "VIDEO" ? item.thumbnail_url || item.media_url : item.media_url,
              permalink: item.permalink ?? "",
              timestamp: item.timestamp ?? "",
              likes: item.like_count ?? 0,
              comments: item.comments_count ?? 0,
              views: 0,
            });
          }
          await Promise.all(
            media.map(async (m) => {
              if (m.mediaType !== "VIDEO") return;
              const r = await igGet(`${IG_GRAPH}/${m.id}/insights?metric=views&access_token=${TOKEN}`);
              const v = r.data?.data?.[0]?.values?.[0]?.value ?? r.data?.data?.[0]?.total_value?.value;
              if (typeof v === "number") m.views = v;
            }),
          );
        } else {
          errors.push({ source: "media", status, message: data?.error?.message });
        }
      }

      res.status(200).json({ configured: true, profile, insights, media, ...(errors.length ? { errors } : {}) });
    } catch (err) {
      console.error("[instagram/insights] exception", err);
      res.status(500).json({ error: "fetch failed" });
    }
  });

  // Espelha api/instagram/profile.ts (perfil público para o mockup de celular; cache 30min na Vercel)
  app.get("/api/instagram/profile", async (_req, res) => {
    const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
    const IG_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!TOKEN || !IG_ID) {
      res.status(200).json({ configured: false, profile: null });
      return;
    }

    try {
      const fields = "username,name,biography,profile_picture_url,followers_count,follows_count,media_count";
      const { ok, data } = await igGet(`${IG_GRAPH}/${IG_ID}?fields=${fields}&access_token=${TOKEN}`);
      if (!ok || !data?.username) {
        res.status(200).json({ configured: true, profile: null, error: data?.error?.message });
        return;
      }
      res.status(200).json({
        configured: true,
        profile: {
          username: data.username ?? "",
          name: data.name ?? "",
          biography: data.biography ?? "",
          profilePictureUrl: data.profile_picture_url ?? "",
          followers: data.followers_count ?? 0,
          follows: data.follows_count ?? 0,
          mediaCount: data.media_count ?? 0,
        },
      });
    } catch (err) {
      console.error("[instagram/profile] exception", err);
      res.status(500).json({ error: "fetch failed" });
    }
  });

  // Espelha api/instagram/media.ts (mídias recentes para Stories & Reels; cache 15min na Vercel)
  app.get("/api/instagram/media", async (req, res) => {
    const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
    const IG_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!TOKEN || !IG_ID) {
      res.status(200).json({ configured: false, media: [] });
      return;
    }

    const limit = Math.min(Math.max(parseInt(String(req.query?.limit ?? "12"), 10) || 12, 1), 25);

    try {
      const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
      const { ok, data } = await igGet(`${IG_GRAPH}/${IG_ID}/media?fields=${fields}&limit=${limit}&access_token=${TOKEN}`);
      if (!ok || !Array.isArray(data?.data)) {
        res.status(200).json({ configured: true, media: [], error: data?.error?.message });
        return;
      }
      const media = data.data.map((item: any) => ({
        id: item.id,
        caption: item.caption ?? "",
        mediaType: item.media_type ?? "",
        mediaUrl: item.media_type === "VIDEO" ? item.thumbnail_url || item.media_url : item.media_url,
        permalink: item.permalink ?? "",
        timestamp: item.timestamp ?? "",
      }));
      res.status(200).json({ configured: true, media });
    } catch (err) {
      console.error("[instagram/media] exception", err);
      res.status(500).json({ error: "fetch failed" });
    }
  });

  // Espelha api/schedule/sheet.ts (proxy CSV do Google Sheets)
  app.get("/api/schedule/sheet", async (req, res) => {
    const raw = String((req.query?.id as string) ?? process.env.SCHEDULE_SHEET_ID ?? "").trim();
    const gid = String((req.query?.gid as string) ?? "0").trim();
    const match = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const sheetId = match ? match[1] : raw;

    if (!sheetId) {
      res.status(400).json({ error: "Missing sheet id (?id=) ou SCHEDULE_SHEET_ID" });
      return;
    }

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    try {
      const r = await fetch(url, { redirect: "follow" });
      const text = await r.text();
      if (!r.ok || /^\s*<(!doctype|html)/i.test(text)) {
        res.status(502).json({
          error: 'Não foi possível ler a planilha. Confirme que ela está compartilhada como "qualquer pessoa com o link pode ver".',
          status: r.status,
        });
        return;
      }
      res.status(200).json({ csv: text });
    } catch (err) {
      console.error("[schedule/sheet] exception", err);
      res.status(500).json({ error: "fetch failed" });
    }
  });

  // Mock data for news
  app.get("/api/news", (req, res) => {
    res.json([
      {
        id: 1,
        title: "Expansão do Agronegócio no Sul da Bahia",
        category: "Economia",
        excerpt: "Novas tecnologias impulsionam a produtividade de cacau na região...",
        author: "Redação Grapiúna",
        date: "2026-03-24",
        image: "https://picsum.photos/seed/cacau/800/600"
      },
      {
        id: 2,
        title: "TV Grapiúna estreia novo programa de debates",
        category: "TV",
        excerpt: "O programa 'Ponto de Vista' trará especialistas para discutir política regional.",
        author: "João Silva",
        date: "2026-03-23",
        image: "https://picsum.photos/seed/tv/800/600"
      },
      {
        id: 3,
        title: "HUB73 anuncia parceria com produtores locais",
        category: "Empresarial",
        excerpt: "A produtora busca fortalecer o ecossistema audiovisual do interior baiano.",
        author: "Maria Oliveira",
        date: "2026-03-22",
        image: "https://picsum.photos/seed/hub73/800/600"
      }
    ]);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
