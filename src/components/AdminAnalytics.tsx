import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { YouTubeVideo } from '../types';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import { Eye, TrendingUp, Smartphone, Monitor, MousePointer2, Youtube, BarChart2, Radio, Users, Film, Instagram, Heart, MessageCircle, CalendarDays } from 'lucide-react';

// Estatísticas do YouTube vêm de dois endpoints separados, com TTLs distintos
// para respeitar a quota diária da YouTube Data API (10.000 units):
//   /api/youtube/live    — search.list (100u/chamada) — atualiza a cada 5min
//   /api/youtube/channel — channels.list (1u/chamada) — atualiza a cada 30min
type YoutubeLive    = { viewers: number; isLive: boolean };
type YoutubeChannel = { subscribers: number; totalViews: number; videoCount: number; channelTitle: string };

const EMPTY_LIVE:    YoutubeLive    = { viewers: 0, isLive: false };
const EMPTY_CHANNEL: YoutubeChannel = { subscribers: 0, totalViews: 0, videoCount: 0, channelTitle: '' };

const fetchYoutubeLive = async (): Promise<YoutubeLive> => {
  try {
    const res = await fetch('/api/youtube/live');
    if (!res.ok) return EMPTY_LIVE;
    const data = await res.json();
    if (data.errors) console.warn('[youtube/live] errors', data.errors);
    return { viewers: data.viewers ?? 0, isLive: !!data.isLive };
  } catch (err) {
    console.error('[youtube/live] falha', err);
    return EMPTY_LIVE;
  }
};

const fetchYoutubeChannel = async (): Promise<YoutubeChannel> => {
  try {
    const res = await fetch('/api/youtube/channel');
    if (!res.ok) return EMPTY_CHANNEL;
    const data = await res.json();
    if (data.error) console.warn('[youtube/channel] error', data.error);
    return {
      subscribers: data.subscribers ?? 0,
      totalViews: data.totalViews ?? 0,
      videoCount: data.videoCount ?? 0,
      channelTitle: data.channelTitle ?? '',
    };
  } catch (err) {
    console.error('[youtube/channel] falha', err);
    return EMPTY_CHANNEL;
  }
};

// Instagram — perfil, insights e mídias recentes vêm do serverless /api/instagram/insights
// (Instagram Graph API). Cache 30min na Vercel; client poll 30min.
type IgMedia = {
  id: string; caption: string; mediaType: string; mediaUrl: string;
  permalink: string; timestamp: string; likes: number; comments: number; views: number;
};
type Instagram = {
  profile: { username: string; name: string; profilePictureUrl: string; followers: number; mediaCount: number };
  insights: { reach: number; profileViews: number };
  media: IgMedia[];
};

const EMPTY_INSTAGRAM: Instagram = {
  profile: { username: '', name: '', profilePictureUrl: '', followers: 0, mediaCount: 0 },
  insights: { reach: 0, profileViews: 0 },
  media: [],
};

const fetchInstagram = async (): Promise<Instagram> => {
  try {
    const res = await fetch('/api/instagram/insights');
    if (!res.ok) return EMPTY_INSTAGRAM;
    const data = await res.json();
    if (data.error) { console.warn('[instagram] error', data.error); return EMPTY_INSTAGRAM; }
    if (data.errors) console.warn('[instagram] errors', data.errors);
    return {
      profile: { ...EMPTY_INSTAGRAM.profile, ...(data.profile ?? {}) },
      insights: { ...EMPTY_INSTAGRAM.insights, ...(data.insights ?? {}) },
      media: Array.isArray(data.media) ? data.media : [],
    };
  } catch (err) {
    console.error('[instagram] falha', err);
    return EMPTY_INSTAGRAM;
  }
};

// Compat: o tracker antigo gravava chaves dotted ("dailyStats.2026-05-02") como
// campos literais no topo do documento; o atual grava mapas aninhados. As duas
// gravações cobrem períodos diferentes, então os valores são SOMADOS — usar
// apenas um dos lados descartaria parte do histórico.
const mergeNestedAndLegacy = (stats: any, prefix: string): Record<string, number> => {
  const merged: Record<string, number> = { ...((stats?.[prefix] as Record<string, number>) ?? {}) };
  for (const [k, v] of Object.entries(stats ?? {})) {
    if (k.startsWith(`${prefix}.`) && typeof v === 'number') {
      const subKey = k.slice(prefix.length + 1);
      merged[subKey] = (merged[subKey] ?? 0) + v;
    }
  }
  return merged;
};

const PATH_LABELS: Record<string, string> = {
  '_': 'Início',
  '_noticias': 'Notícias',
  '_tv': 'TV Ao Vivo',
  '_hub73': 'Hub73',
  '_podcasts': 'Podcasts',
  '_loja': 'Loja',
  '_anuncie': 'Anuncie',
  '_midia-kit': 'Mídia Kit',
  '_admin': 'Admin',
};

const pathLabel = (key: string) =>
  PATH_LABELS[key] ?? (key.replace(/_/g, '/') || '/');

const truncate = (str: string, max: number) =>
  str.length > max ? str.substring(0, max) + '…' : str;

// ── Filtro de período (gráfico de acessos diários) ──────────────────────────
type RangeKey = '7' | '14' | '30' | '60' | '90' | 'custom';
const RANGE_PRESETS = [7, 14, 30, 60, 90] as const;

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const formatBR = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const EmptyChart = ({ message = 'Sem dados disponíveis' }: { message?: string }) => (
  <div className="h-64 flex flex-col items-center justify-center text-gray-300 gap-3">
    <BarChart2 size={32} className="opacity-30" />
    <p className="text-sm font-medium">{message}</p>
  </div>
);

const StatCard = ({ title, value, icon: Icon, color }: {
  title: string; value: number | undefined; icon: React.ElementType; color: string;
}) => (
  <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className={`p-3 rounded-2xl ${color} text-white`}>
        <Icon size={20} />
      </div>
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total</span>
    </div>
    <h3 className="text-gray-500 text-sm font-medium mb-1">{title}</h3>
    <p className="text-3xl font-black tracking-tighter text-gray-900">
      {(value ?? 0).toLocaleString('pt-BR')}
    </p>
  </div>
);

const LiveStatCard = ({ viewers, isLive }: { viewers: number; isLive: boolean }) => (
  <div className="bg-white p-6 rounded-3xl border border-red-100 shadow-sm ring-1 ring-red-50 relative overflow-hidden">
    <div className="absolute -top-10 -right-10 w-32 h-32 bg-red-50 rounded-full opacity-60 pointer-events-none" />
    <div className="relative">
      <div className="flex items-center justify-between mb-4">
        <div className="p-3 rounded-2xl bg-red-600 text-white">
          <Radio size={20} />
        </div>
        <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${
          isLive ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-100'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-red-600 animate-pulse' : 'bg-gray-400'}`} />
          {isLive ? 'Ao Vivo' : 'Offline'}
        </span>
      </div>
      <h3 className="text-gray-500 text-sm font-medium mb-1">Audiência YouTube</h3>
      <p className="text-3xl font-black tracking-tighter text-gray-900">
        {viewers.toLocaleString('pt-BR')}
      </p>
    </div>
  </div>
);

export const AdminAnalytics = () => {
  const [stats, setStats] = useState<any>(null);
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<YoutubeLive>(EMPTY_LIVE);
  const [channel, setChannel] = useState<YoutubeChannel>(EMPTY_CHANNEL);
  const [instagram, setInstagram] = useState<Instagram>(EMPTY_INSTAGRAM);
  const [range, setRange] = useState<RangeKey>('7');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    const unsubStats = onSnapshot(doc(db, 'site_stats', 'global'), (snap) => {
      setStats(snap.exists() ? snap.data() : null);
      setLoading(false);
    });

    const qVideos = query(collection(db, 'youtube_videos'), orderBy('views', 'desc'));
    const unsubVideos = onSnapshot(qVideos, (snap) => {
      setVideos(snap.docs.map(d => ({ id: d.id, ...d.data() } as YouTubeVideo)));
    });

    return () => { unsubStats(); unsubVideos(); };
  }, []);

  // Live audience — cara (100u por origin hit). Edge cache 15min, client poll 5min.
  useEffect(() => {
    let alive = true;
    const update = async () => {
      const data = await fetchYoutubeLive();
      if (alive) setLive(data);
    };
    update();
    const id = setInterval(update, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Channel stats — barata (1u). Edge cache 1h, client poll 30min.
  useEffect(() => {
    let alive = true;
    const update = async () => {
      const data = await fetchYoutubeChannel();
      if (alive) setChannel(data);
    };
    update();
    const id = setInterval(update, 30 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Instagram — Graph API com rate limit. Edge cache 30min, client poll 30min.
  useEffect(() => {
    let alive = true;
    const update = async () => {
      const data = await fetchInstagram();
      if (alive) setInstagram(data);
    };
    update();
    const id = setInterval(update, 30 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (loading) return <div className="animate-pulse h-96 bg-gray-100 rounded-3xl" />;

  // ── Daily Accesses — filtra pelo período selecionado, ordena por YYYY-MM-DD ─
  const dailyMap = mergeNestedAndLegacy(stats, 'dailyStats');

  const startISO = range === 'custom'
    ? (customStart || '0000-01-01')
    : isoDaysAgo(parseInt(range, 10) - 1);
  const endISO = range === 'custom'
    ? (customEnd || todayISO())
    : todayISO();

  const dailyData = Object.entries(dailyMap)
    .filter(([date]) => date >= startISO && date <= endISO)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => {
      const [, mm, dd] = date.split('-');
      return { date: `${dd}/${mm}`, count };
    });

  const periodTotal = dailyData.reduce((acc, d) => acc + d.count, 0);
  const rangeLabel = range === 'custom'
    ? (customStart && customEnd ? `${formatBR(customStart)} – ${formatBR(customEnd)}` : 'Período personalizado')
    : `Últimos ${range} dias`;

  // ── Top Pages ─────────────────────────────────────────────────────────────
  const pageMap = mergeNestedAndLegacy(stats, 'pageViews');
  const pageData = Object.entries(pageMap)
    .map(([key, count]) => ({ name: pathLabel(key), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);

  // ── Device Distribution ───────────────────────────────────────────────────
  const deviceMap = mergeNestedAndLegacy(stats, 'deviceStats');
  const desktop = deviceMap.desktop ?? 0;
  const mobile = deviceMap.mobile ?? 0;
  const hasDeviceData = desktop + mobile > 0;
  const deviceData = [
    { name: 'Desktop', value: desktop, color: '#2563eb' },
    { name: 'Mobile', value: mobile, color: '#ef4444' },
  ];
  // Acessos contabilizados antes de o tracker passar a registrar o dispositivo:
  // existem em totalAccesses, mas não têm como ser atribuídos a mobile/desktop.
  const untrackedDevice = Math.max(0, (stats?.totalAccesses ?? 0) - (desktop + mobile));

  // ── Top Videos ────────────────────────────────────────────────────────────
  const videoData = videos.slice(0, 5).map(v => ({
    name: truncate(v.title, 22),
    views: v.views ?? 0,
  }));

  const totalVideoViews = videos.reduce((acc, v) => acc + (v.views ?? 0), 0);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-black uppercase tracking-tighter">
          Dashboard de <span className="text-red-600">Audiência</span>
        </h2>
        <div className="flex items-center gap-2 text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1.5 rounded-full">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          DADOS EM TEMPO REAL
        </div>
      </div>

      {/* ── Filtro de período ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 mr-1 flex items-center gap-1.5">
          <CalendarDays size={13} className="text-red-600" /> Período
        </span>
        {RANGE_PRESETS.map((d) => (
          <button
            key={d}
            onClick={() => setRange(String(d) as RangeKey)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
              range === String(d) ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {d} dias
          </button>
        ))}
        <button
          onClick={() => setRange('custom')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
            range === 'custom' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          <CalendarDays size={13} /> Personalizado
        </button>

        {range === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customStart}
              max={customEnd || todayISO()}
              onChange={(e) => setCustomStart(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-red-400"
            />
            <span className="text-gray-400 text-xs">até</span>
            <input
              type="date"
              value={customEnd}
              min={customStart || undefined}
              max={todayISO()}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-red-400"
            />
          </div>
        )}
      </div>

      {/* ── Canal YouTube ───────────────────────────────────────────────── */}
      <div>
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 flex items-center gap-2">
          <Youtube size={14} className="text-red-600" />
          Canal {channel.channelTitle ? `· ${channel.channelTitle}` : 'YouTube'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <LiveStatCard viewers={live.viewers} isLive={live.isLive} />
          <StatCard title="Inscritos do Canal"   value={channel.subscribers} icon={Users} color="bg-red-600" />
          <StatCard title="Visualizações Totais" value={channel.totalViews}  icon={Eye}   color="bg-red-500" />
          <StatCard title="Vídeos Publicados"    value={channel.videoCount}  icon={Film}  color="bg-red-700" />
        </div>
      </div>

      {/* ── Instagram ───────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 flex items-center gap-2">
          <Instagram size={14} className="text-pink-600" />
          Instagram {instagram.profile.username ? `· @${instagram.profile.username}` : ''}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Seguidores"        value={instagram.profile.followers}     icon={Users}      color="bg-pink-600"    />
          <StatCard title="Publicações"       value={instagram.profile.mediaCount}    icon={Film}       color="bg-fuchsia-600" />
          <StatCard title="Alcance (dia)"     value={instagram.insights.reach}        icon={TrendingUp} color="bg-purple-600"  />
          <StatCard title="Visitas ao Perfil" value={instagram.insights.profileViews} icon={Eye}        color="bg-rose-600"    />
        </div>

        {/* Feed recente */}
        {instagram.media.length > 0 && (
          <div className="mt-6 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
            <h4 className="text-sm font-bold mb-4 flex items-center gap-2 text-gray-700">
              <Instagram size={16} className="text-pink-600" /> Publicações Recentes
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {instagram.media.map((m) => (
                <a
                  key={m.id}
                  href={m.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative aspect-square rounded-xl overflow-hidden bg-gray-100"
                >
                  <img
                    src={m.mediaUrl}
                    alt={m.caption ? m.caption.slice(0, 60) : 'Publicação do Instagram'}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 text-white text-xs font-bold">
                    <span className="flex items-center gap-1"><Heart size={13} /> {m.likes.toLocaleString('pt-BR')}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={13} /> {m.comments.toLocaleString('pt-BR')}</span>
                    {m.views > 0 && (
                      <span className="flex items-center gap-1"><Eye size={13} /> {m.views.toLocaleString('pt-BR')}</span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Audiência do Site ───────────────────────────────────────────── */}
      <div>
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 flex items-center gap-2">
          <BarChart2 size={14} className="text-blue-600" />
          Audiência do Portal
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Acessos Totais"     value={stats?.totalAccesses} icon={Eye}        color="bg-blue-600"   />
          <StatCard title="Views no Portal"    value={totalVideoViews}      icon={TrendingUp} color="bg-pink-600"   />
          <StatCard title="Acessos Mobile"     value={mobile}               icon={Smartphone} color="bg-orange-600" />
          <StatCard title="Acessos Desktop"    value={desktop}              icon={Monitor}    color="bg-indigo-600" />
        </div>
        {untrackedDevice > 0 && (
          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
            Mobile + Desktop = {(mobile + desktop).toLocaleString('pt-BR')}. Os outros{' '}
            {untrackedDevice.toLocaleString('pt-BR')} acessos foram registrados antes de o site
            passar a identificar o tipo de dispositivo, por isso não entram nessa divisão.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* ── Daily Accesses ──────────────────────────────────────────── */}
        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-start justify-between mb-6 gap-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <TrendingUp size={20} className="text-red-600" /> Acessos Diários
            </h3>
            <div className="text-right shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{rangeLabel}</p>
              <p className="text-sm font-black text-gray-900">{periodTotal.toLocaleString('pt-BR')} acessos</p>
            </div>
          </div>
          {dailyData.length === 0 ? <EmptyChart message="Sem acessos no período selecionado" /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    axisLine={false} tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 600 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    axisLine={false} tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 600 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    labelStyle={{ fontWeight: 800, color: '#ef4444' }}
                    formatter={(v: number) => [v.toLocaleString('pt-BR'), 'Acessos']}
                  />
                  <Line
                    type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={3}
                    dot={{ r: 4, fill: '#ef4444', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 7 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Device Distribution ──────────────────────────────────────── */}
        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Smartphone size={20} className="text-red-600" /> Distribuição por Dispositivo
          </h3>
          {!hasDeviceData ? <EmptyChart message="Nenhum acesso registrado ainda" /> : (
            <div className="h-64 flex items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deviceData}
                    cx="50%" cy="50%"
                    innerRadius={60} outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {deviceData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => [v.toLocaleString('pt-BR'), 'Acessos']}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Top Pages ────────────────────────────────────────────────── */}
        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <MousePointer2 size={20} className="text-red-600" /> Páginas Mais Visitadas
          </h3>
          {pageData.length === 0 ? <EmptyChart /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pageData} layout="vertical" margin={{ left: 0, right: 16 }}>
                  <XAxis
                    type="number"
                    axisLine={false} tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 600 }}
                    tickFormatter={(v: number) => v.toLocaleString('pt-BR')}
                    allowDecimals={false}
                  />
                  <YAxis
                    dataKey="name" type="category"
                    axisLine={false} tickLine={false}
                    tick={{ fontSize: 11, fontWeight: 600 }}
                    width={80}
                  />
                  <Tooltip
                    cursor={{ fill: '#f9fafb' }}
                    formatter={(v: number) => [v.toLocaleString('pt-BR'), 'Acessos']}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="count" fill="#2563eb" radius={[0, 8, 8, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Top Videos ───────────────────────────────────────────────── */}
        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Youtube size={20} className="text-red-600" /> Vídeos Mais Assistidos
          </h3>
          {videoData.length === 0 ? <EmptyChart message="Nenhum vídeo cadastrado" /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={videoData} margin={{ bottom: 40 }}>
                  <XAxis
                    dataKey="name"
                    axisLine={false} tickLine={false}
                    tick={{ fontSize: 9, fontWeight: 600 }}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                  />
                  <YAxis
                    axisLine={false} tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 600 }}
                    tickFormatter={(v: number) => v.toLocaleString('pt-BR')}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#f9fafb' }}
                    formatter={(v: number) => [v.toLocaleString('pt-BR'), 'Views']}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="views" fill="#ef4444" radius={[8, 8, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
