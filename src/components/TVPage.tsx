import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { motion } from 'motion/react';
import { Play, Calendar, Share2, Tv, Minimize2, Maximize, Maximize2 } from 'lucide-react';
import { AdBanner } from './AdBanner';
import { collection, query, orderBy, onSnapshot, doc } from 'firebase/firestore';
import { TVChannel } from '../types';
import { db } from '../firebase';
import { ScheduleItem } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { findOnAir, computeDaySchedule } from '../lib/schedule';
import { InstagramPhone } from './InstagramPhone';

const DAYS_FULL = [
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
  'Domingo',
];
const DAYS_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const getDayName = (d: Date) => DAYS_FULL[d.getDay() === 0 ? 6 : d.getDay() - 1];
const TODAY_NAME = getDayName(new Date());

const FALLBACK_CHANNELS: TVChannel[] = [
  { name: 'CARNAVAL DE ITABUNA | 1º DIA', url: 'https://www.youtube.com/watch?v=soLycr6nPKU&t=21387s' },
  { name: 'CARNAVAL DE ITABUNA | 2º DIA', url: 'https://www.youtube.com/watch?v=E0lAxzXTAjc&t=3s' },
  { name: 'CARNAVAL DE ITABUNA | 3º DIA', url: 'https://www.youtube.com/watch?v=GxBJAxQYqhI&t=67s' },
  { name: 'CARNAVAL DE ITABUNA | 4º DIA', url: 'https://www.youtube.com/watch?v=o6t97ZblHis&t=201s' },
];

type ViewMode = 'normal' | 'theater';

export const TVPage = () => {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [currentProgram, setCurrentProgram] = useState<ScheduleItem | null>(null);
  const [onAirProgram, setOnAirProgram] = useState<ScheduleItem | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [liveConfig, setLiveConfig] = useState<any>(null);
  const [selectedChannel, setSelectedChannel] = useState<TVChannel | null>(null);
  const [channels, setChannels] = useState<TVChannel[]>(FALLBACK_CHANNELS);
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [activeChannelName, setActiveChannelName] = useState<string | null>(null);
  const [selectedVideoStart, setSelectedVideoStart] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>(TODAY_NAME);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerWrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastYtStateRef = useRef(-1); // último playerState reportado pelo iframe do YouTube

  // ── Live config ───────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'live_config', 'current'), (snap) => {
      if (snap.exists()) setLiveConfig(snap.data());
    });
    return () => unsub();
  }, []);

  // ── Canais ao vivo ────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'tv_channels'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as TVChannel));
      setChannels(data.length > 0 ? data : FALLBACK_CHANNELS);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'tv_channels'));
    return () => unsub();
  }, []);

  // ── Schedule ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tv_schedule'), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleItem));
      setSchedule(data);
      const todayItems = data.filter(p => p.dayOfWeek === getDayName(new Date()));
      const onAir = findOnAir(todayItems, new Date());
      setOnAirProgram(onAir);
      // carrega o programa no ar — sem sobrescrever uma escolha manual do usuário
      if (onAir) {
        setCurrentProgram(prev => prev ?? onAir);
        if (onAir.youtubeUrl && !liveConfig?.active) {
          setSelectedVideoId(prev => prev ?? getYouTubeId(onAir.youtubeUrl!));
        }
      }
    });
    return () => unsub();
  }, [liveConfig]);

  // ── "No ar agora" — recalcula pela janela [início, fim) a cada 30s ─────────
  useEffect(() => {
    const tick = () => {
      const todayItems = schedule.filter(p => p.dayOfWeek === getDayName(new Date()));
      setOnAirProgram(findOnAir(todayItems, new Date()));
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [schedule]);

  // ── Auto-avanço da grade: quando o vídeo termina, pula para o próximo ─────
  // O iframe (com enablejsapi=1) envia o playerState via postMessage; ao detectar
  // a transição tocando → encerrado (0), avança para o próximo programa do dia
  // que tenha vídeo, voltando ao primeiro no fim (comportamento de TV).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'https://www.youtube.com') return;
      let data: any;
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      const state = data?.event === 'onStateChange' ? data.info : data?.info?.playerState;
      if (typeof state !== 'number') return;
      const prev = lastYtStateRef.current;
      lastYtStateRef.current = state;
      if (state !== 0 || ![1, 2, 3].includes(prev)) return; // só transição real para "encerrado"

      // só avança se o vídeo que terminou veio da grade de programação
      if (!currentProgram?.youtubeUrl || activeChannelName || !selectedVideoId) return;
      if (getYouTubeId(currentProgram.youtubeUrl) !== selectedVideoId) return;

      const dayItems = computeDaySchedule(schedule.filter(p => p.dayOfWeek === currentProgram.dayOfWeek));
      const idx = dayItems.findIndex(p => p.id === currentProgram.id);
      for (let step = 1; step <= dayItems.length; step++) {
        const next = dayItems[(idx + step) % dayItems.length];
        const nextId = next.youtubeUrl ? getYouTubeId(next.youtubeUrl) : null;
        if (nextId && next.id !== currentProgram.id) {
          setCurrentProgram(next);
          setSelectedVideoId(nextId);
          setSelectedVideoStart(null);
          return;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [schedule, currentProgram, selectedVideoId, activeChannelName]);

  // ── HLS: carrega stream quando selectedChannel muda ───────────────────────
  // O effect roda APÓS o render, garantindo que videoRef.current já existe.
  useEffect(() => {
    if (!selectedChannel) return;
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(selectedChannel.url);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari: suporte nativo a HLS
      video.src = selectedChannel.url;
      video.play().catch(() => {});
    }
  }, [selectedChannel]);

  // ── Cleanup HLS ao desmontar ───────────────────────────────────────────────
  useEffect(() => {
    return () => { hlsRef.current?.destroy(); };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getYouTubeId = (url: string) => {
    // Cobre watch?v=, youtu.be/, /live/, /shorts/, /embed/, /v/. ID tem 11 caracteres.
    const match = url.match(/(?:youtu\.be\/|live\/|shorts\/|embed\/|v\/|u\/\w\/|watch\?v=|&v=)([A-Za-z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  const getYouTubeStart = (url: string): number | null => {
    const match = url.match(/[?&]t=(\d+)s?/);
    return match ? parseInt(match[1]) : null;
  };

  /** Capa do vídeo. maxresdefault não existe em todo vídeo — o <img> cai para hqdefault. */
  const getYouTubeThumb = (url: string): string | null => {
    const id = getYouTubeId(url);
    return id ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg` : null;
  };

  /** Leva a viewport até o player — usado ao escolher um evento ou programa. */
  const scrollToPlayer = () => {
    setTimeout(() => {
      playerWrapperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  /** Seleciona um canal; detecta YouTube vs HLS automaticamente */
  const handleChannelSelect = (channel: TVChannel) => {
    const ytId = getYouTubeId(channel.url);
    if (ytId) {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      setSelectedChannel(null);
      setSelectedVideoId(ytId);
      setSelectedVideoStart(getYouTubeStart(channel.url));
    } else {
      setSelectedVideoId(null);
      setSelectedVideoStart(null);
      setSelectedChannel(channel);
    }
    setActiveChannelName(channel.name);
    scrollToPlayer();
  };

  /** Clique na grade de programação: carrega YouTube e encerra HLS */
  const handleProgramClick = (prog: ScheduleItem) => {
    if (!prog.youtubeUrl) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setSelectedChannel(null);
    setSelectedVideoId(getYouTubeId(prog.youtubeUrl));
    setSelectedVideoStart(null);
    setActiveChannelName(null);
    setCurrentProgram(prog);
    scrollToPlayer();
  };

  /** Handshake com o iframe do YouTube para ele passar a enviar o playerState */
  const handleIframeLoad = () => {
    lastYtStateRef.current = -1; // novo vídeo carregado → zera o estado
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: 'tv-player', channel: 'widget' }),
      'https://www.youtube.com',
    );
  };

  /** Tela cheia: usa o wrapper do player para cobrir todo o viewport */
  const handleFullscreen = () => {
    playerWrapperRef.current?.requestFullscreen().catch(() => {});
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'TV Grapiúna - Ao Vivo', text: 'Assista agora a TV Grapiúna ao vivo!', url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        alert('Link copiado!');
      }
    } catch {}
  };

  // ── Flags de visibilidade do player ──────────────────────────────────────
  // O <video> fica sempre no DOM (hidden/block) para manter o ref ativo.
  const showVideo   = !!selectedChannel || (liveConfig?.active && liveConfig?.type === 'direct');
  const showIframe  = !showVideo && (!!selectedVideoId || (liveConfig?.active && liveConfig?.type === 'youtube'));
  const showPlaceholder = !showVideo && !showIframe;
  const isTheater   = viewMode === 'theater';

  return (
    <div className="bg-gray-950 min-h-screen text-white">

      {/* ── 1. Banner topo — Capa de Canal ─────────────────────────────────── */}
      <div className="bg-black border-b border-gray-800 px-4 sm:px-6 lg:px-8 py-6">
        <AdBanner size="cover" page="tv" />
      </div>

      {/* ── 2. Player + Instagram ──────────────────────────────────────────── */}
      <section className="py-10 pb-6">
        <div className={isTheater ? 'w-full px-4' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'}>
          <div className={isTheater ? 'flex flex-col gap-6' : 'grid grid-cols-1 lg:grid-cols-4 gap-6'}>

            {/* Player column */}
            <div className={isTheater ? 'w-full' : 'lg:col-span-3'}>

              {/* Player wrapper — ref para fullscreen */}
              <div
                ref={playerWrapperRef}
                className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-gray-800"
              >
                {/* <video> sempre no DOM; visibilidade controlada por CSS */}
                <video
                  id="main-video-player"
                  ref={videoRef}
                  controls
                  autoPlay
                  className={`absolute inset-0 w-full h-full ${showVideo ? 'block' : 'hidden'}`}
                  src={liveConfig?.active && liveConfig?.type === 'direct' && !selectedChannel ? liveConfig.url : undefined}
                />

                {/* YouTube iframe — selectedVideoId tem prioridade sobre liveConfig */}
                {showIframe && (
                  <iframe
                    ref={iframeRef}
                    onLoad={handleIframeLoad}
                    className="absolute inset-0 w-full h-full"
                    src={`https://www.youtube.com/embed/${selectedVideoId ?? (liveConfig?.active ? getYouTubeId(liveConfig.url) : null)}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}${selectedVideoStart ? `&start=${selectedVideoStart}` : ''}`}
                    title="YouTube video player"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                )}

                {/* Placeholder */}
                {showPlaceholder && (
                  <div className="absolute inset-0 flex items-center justify-center flex-col gap-4">
                    <img
                      src="https://picsum.photos/seed/live/1280/720"
                      alt="Placeholder"
                      className="w-full h-full object-cover opacity-30 absolute inset-0"
                      referrerPolicy="no-referrer"
                    />
                    <div className="relative z-10 text-center px-4">
                      <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-700">
                        <Play size={32} className="text-gray-600" />
                      </div>
                      <h3 className="text-xl font-bold">Nenhum vídeo disponível no momento</h3>
                      <p className="text-gray-400 text-sm mt-2">Selecione um canal ou programa abaixo.</p>
                    </div>
                  </div>
                )}

                {/* Badge AO VIVO */}
                {(currentProgram || liveConfig?.active || selectedChannel || activeChannelName) && (
                  <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-600 px-3 py-1 rounded-full text-xs font-bold z-10">
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    {selectedChannel?.name ?? activeChannelName ?? (liveConfig?.active ? 'TRANSMISSÃO AO VIVO' : currentProgram?.title)}
                  </div>
                )}
              </div>

              {/* Controls bar */}
              <div className="mt-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h1 className="text-xl font-bold">
                    {selectedChannel?.name ?? activeChannelName ?? (liveConfig?.active ? 'TV Grapiúna Ao Vivo' : (currentProgram?.title || 'Eventos ao Vivo'))}
                  </h1>
                  <p className="text-gray-400 text-sm">
                    {currentProgram?.host && !selectedChannel
                      ? `Com ${currentProgram.host}`
                      : 'Acompanhe nossa programação local 24h.'}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href="https://www.youtube.com/@tv.grapiuna"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-xs font-bold transition-colors"
                  >
                    INSCREVER NO CANAL
                  </a>
                  <button
                    onClick={handleShare}
                    className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Share2 size={15} /> Compartilhar
                  </button>

                  {/* Controles de tamanho */}
                  <div className="flex items-center gap-0.5 bg-gray-800 rounded-lg p-1 border border-gray-700" title="Tamanho do player">
                    <button
                      title="Normal"
                      onClick={() => setViewMode('normal')}
                      className={`p-1.5 rounded transition-colors ${viewMode === 'normal' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      <Minimize2 size={15} />
                    </button>
                    <button
                      title="Modo Teatro"
                      onClick={() => setViewMode('theater')}
                      className={`p-1.5 rounded transition-colors ${viewMode === 'theater' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      <Maximize size={15} />
                    </button>
                    <button
                      title="Tela Cheia"
                      onClick={handleFullscreen}
                      className="p-1.5 rounded text-gray-400 hover:text-white transition-colors"
                    >
                      <Maximize2 size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Ad banners */}
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                <AdBanner size="sidebar" page="tv" className="w-full h-auto aspect-[2/1]" index={0} />
                <AdBanner size="sidebar" page="tv" className="w-full h-auto aspect-[2/1]" index={1} />
              </div>
            </div>

            {/* Instagram — mockup de celular com o perfil (oculto no modo teatro) */}
            {!isTheater && (
              <aside className="lg:col-span-1">
                <InstagramPhone />
              </aside>
            )}
          </div>

        </div>
      </section>

      {/* ── 3. Últimos Eventos Ao Vivo ─────────────────────────────────────── */}
      <section className="py-12 bg-gray-950 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Tv size={22} className="text-red-600" />
              <h2 className="text-2xl font-black uppercase tracking-tighter">
                Últimos <span className="text-red-600">Eventos Ao Vivo</span>
              </h2>
            </div>
            {selectedChannel && (
              <button
                onClick={() => {
                  if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
                  setSelectedChannel(null);
                }}
                className="text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-500 px-4 py-1.5 rounded-full transition-all"
              >
                Fechar canal
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {channels.map((ch) => {
              const isActive = selectedChannel?.url === ch.url || (!selectedChannel && activeChannelName === ch.name);
              const thumb = getYouTubeThumb(ch.url);
              return (
                <motion.button
                  key={ch.url}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleChannelSelect(ch)}
                  className={`relative group text-left rounded-2xl overflow-hidden border transition-all ${
                    isActive
                      ? 'border-red-600 shadow-lg shadow-red-900/30'
                      : 'border-gray-700 hover:border-gray-500'
                  }`}
                >
                  {/* Capa do vídeo no YouTube */}
                  <div className="relative aspect-video bg-gray-800 overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={ch.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        onError={(e) => {
                          // maxresdefault não existe para todo vídeo; hqdefault sempre existe
                          const img = e.currentTarget;
                          if (img.src.includes('maxresdefault')) {
                            img.src = img.src.replace('maxresdefault', 'hqdefault');
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600">
                        <Tv size={30} />
                      </div>
                    )}

                    {/* Play no hover */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center shadow-xl">
                        <Play size={20} fill="white" color="white" className="ml-0.5" />
                      </div>
                    </div>

                    {isActive && (
                      <span className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-red-600 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                        AO VIVO
                      </span>
                    )}
                  </div>

                  {/* Título */}
                  <div className={`p-3 transition-colors ${isActive ? 'bg-red-600/10' : 'bg-gray-800'}`}>
                    <span className={`text-xs font-bold uppercase tracking-wider leading-snug line-clamp-2 block ${
                      isActive ? 'text-red-400' : 'text-gray-200'
                    }`}>
                      {ch.name}
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 4. Grade de Programação ────────────────────────────────────────── */}
      <section className="py-16 bg-gray-900/50 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Cabeçalho */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-4">
              <Calendar size={26} className="text-red-600" />
              <h2 className="text-3xl font-black uppercase tracking-tighter">
                Grade de <span className="text-red-600">Programação</span>
              </h2>
            </div>
          </div>

          {/* Tabs de dias */}
          <div className="flex gap-2 mb-8 overflow-x-auto pb-1 scrollbar-hide">
            {DAYS_FULL.map((day, i) => {
              const isToday = day === TODAY_NAME;
              const isSelected = day === selectedDay;
              const count = schedule.filter(p => p.dayOfWeek === day).length;
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                    isSelected
                      ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
                  }`}
                >
                  {isToday && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                  {DAYS_SHORT[i]}
                  {count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      isSelected ? 'bg-white/20' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Programas do dia selecionado */}
          {schedule.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="bg-gray-800 p-4 rounded-lg border-l-4 border-gray-700 animate-pulse">
                  <div className="h-4 bg-gray-700 rounded w-1/3 mb-2" />
                  <div className="h-4 bg-gray-700 rounded w-full mb-2" />
                  <div className="h-3 bg-gray-700 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : (() => {
            const dayItems = computeDaySchedule(schedule.filter(p => p.dayOfWeek === selectedDay));
            const liveId = selectedDay === TODAY_NAME ? onAirProgram?.id : undefined;
            if (dayItems.length === 0) {
              return (
                <div className="text-center py-16 text-gray-600">
                  <Calendar size={36} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-bold">Nenhum programa cadastrado para {selectedDay}.</p>
                </div>
              );
            }
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {dayItems.map((prog) => {
                  const isLive = prog.id === liveId;
                  // legado sem duração → mostra o horário antigo em vez de 00:00
                  const timeLabel = prog.durationSeconds
                    ? `${prog.startLabel.slice(0, 5)}–${prog.endLabel.slice(0, 5)}`
                    : (prog.time || prog.startLabel.slice(0, 5));
                  // capa própria cadastrada no admin tem prioridade sobre a do YouTube
                  const cover = prog.thumbnailUrl || (prog.youtubeUrl ? getYouTubeThumb(prog.youtubeUrl) : null);
                  return (
                    <button
                      key={prog.id}
                      onClick={() => handleProgramClick(prog)}
                      className={`group text-left rounded-xl overflow-hidden border transition-all hover:scale-[1.02] ${
                        isLive
                          ? 'border-red-600 shadow-lg shadow-red-900/30'
                          : 'border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      {/* Capa */}
                      <div className="relative aspect-video bg-gray-800 overflow-hidden">
                        {cover ? (
                          <img
                            src={cover}
                            alt={prog.title}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            onError={(e) => {
                              // maxresdefault não existe para todo vídeo; hqdefault sempre existe
                              const img = e.currentTarget;
                              if (img.src.includes('maxresdefault')) {
                                img.src = img.src.replace('maxresdefault', 'hqdefault');
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600">
                            <Calendar size={26} />
                          </div>
                        )}

                        {/* Horário sobreposto */}
                        <span className="absolute bottom-2 left-2 font-mono font-bold text-[11px] bg-black/75 text-white px-2 py-0.5 rounded">
                          {timeLabel}
                        </span>

                        {isLive && (
                          <span className="absolute top-2 right-2 flex items-center gap-1 bg-red-600 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                            No ar agora
                          </span>
                        )}

                        {/* Play no hover — só quando há vídeo para tocar */}
                        {prog.youtubeUrl && (
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-11 h-11 bg-red-600 rounded-full flex items-center justify-center shadow-xl">
                              <Play size={18} fill="white" color="white" className="ml-0.5" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Informações */}
                      <div className={`p-3 transition-colors ${isLive ? 'bg-red-600/10' : 'bg-gray-800'}`}>
                        {prog.category && (
                          <p className="text-[10px] text-red-500 uppercase tracking-widest font-bold mb-1">
                            {prog.category}
                          </p>
                        )}
                        <h3 className="text-sm font-bold leading-snug line-clamp-2">{prog.title}</h3>
                        {prog.host && (
                          <p className="text-gray-400 text-xs line-clamp-1 mt-1">Com {prog.host}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </section>
    </div>
  );
};
