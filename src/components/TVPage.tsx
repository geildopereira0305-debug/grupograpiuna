import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { motion } from 'motion/react';
import { Play, Calendar, MessageSquare, Share2, Send, LogIn, Tv, Minimize2, Maximize, Maximize2, Trash2 } from 'lucide-react';
import { AdBanner } from './AdBanner';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, limit, doc, deleteDoc, writeBatch } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { TVChannel } from '../types';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth, loginWithGoogle } from '../firebase';
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

  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const { isAdmin } = useAuth();

  const chatEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerWrapperRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastYtStateRef = useRef(-1); // último playerState reportado pelo iframe do YouTube

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

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

  // ── Chat ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'live_chat'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse());
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'live_chat'));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isInitialMount.current) {
      if (messages.length > 0) isInitialMount.current = false;
      return;
    }
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

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

  /** Exclui uma mensagem — admin apaga qualquer uma; usuário só as próprias */
  const handleDeleteMessage = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'live_chat', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'live_chat');
    }
  };

  /** Limpa o chat (somente admin). Remove as mensagens carregadas (últimas 50). */
  const handleClearChat = async () => {
    const ids = messages.map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return;
    if (!window.confirm(`Apagar ${ids.length} mensagem(ns) do chat? Esta ação não pode ser desfeita.`)) return;
    try {
      const batch = writeBatch(db);
      ids.forEach((id) => batch.delete(doc(db, 'live_chat', id)));
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'live_chat');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;
    try {
      await addDoc(collection(db, 'live_chat'), {
        text: newMessage,
        userId: user.uid,
        userName: user.displayName || 'Anônimo',
        userPhoto: user.photoURL,
        createdAt: serverTimestamp(),
      });
      setNewMessage('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'live_chat');
    }
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

      {/* ── 2. Player + Chat ───────────────────────────────────────────────── */}
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

          {/* Chat Ao Vivo — barra horizontal abaixo do player */}
          <div className="mt-6 bg-gray-900 rounded-2xl border border-gray-800 flex flex-col md:flex-row overflow-hidden h-80 md:h-48">

            {/* Cabeçalho + mensagens */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0 bg-gray-900/50 backdrop-blur-sm">
                <h3 className="font-bold flex items-center gap-2 uppercase text-xs tracking-widest">
                  <MessageSquare size={16} className="text-red-600" /> Chat Ao Vivo
                </h3>
                <div className="flex items-center gap-3">
                  {isAdmin && messages.length > 0 && (
                    <button
                      onClick={handleClearChat}
                      title="Apagar todas as mensagens"
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={12} /> Limpar
                    </button>
                  )}
                  {user && (
                    <div className="flex items-center gap-2">
                      <img src={user.photoURL || ''} className="w-5 h-5 rounded-full" alt="" />
                      <span className="text-[10px] text-gray-400 font-bold uppercase">{user.displayName?.split(' ')[0]}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-3 text-sm scrollbar-thin scrollbar-thumb-gray-800">
                {messages.length > 0 ? messages.map((msg, i) => {
                  const canDelete = !!msg.id && (isAdmin || (!!user && msg.userId === user.uid));
                  return (
                    <div key={msg.id || i} className="group flex gap-2 items-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <span className="font-bold text-red-500 shrink-0">{msg.userName}:</span>
                      <span className="text-gray-300 break-words flex-1 min-w-0">{msg.text}</span>
                      {canDelete && (
                        <button
                          onClick={() => handleDeleteMessage(msg.id)}
                          title="Excluir mensagem"
                          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-500 transition-all shrink-0 mt-0.5"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                }) : (
                  <div className="h-full flex flex-col items-center justify-center text-gray-600 text-center px-4">
                    <MessageSquare size={28} className="mb-2 opacity-20" />
                    <p className="text-xs">Seja o primeiro a comentar!</p>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </div>

            {/* Input */}
            <div className="p-4 bg-gray-900/50 border-t md:border-t-0 md:border-l border-gray-800 md:w-72 shrink-0 flex flex-col justify-center">
              {user ? (
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Diga algo..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="bg-red-600 text-white p-2 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send size={16} />
                  </button>
                </form>
              ) : (
                <button
                  onClick={loginWithGoogle}
                  className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 transition-all"
                >
                  <LogIn size={16} className="text-red-600" /> ENTRAR PARA COMENTAR
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Canais Disponíveis ──────────────────────────────────────────── */}
      <section className="py-12 bg-gray-950 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Tv size={22} className="text-red-600" />
              <h2 className="text-2xl font-black uppercase tracking-tighter">
                Canais <span className="text-red-600">Disponíveis</span>
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

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {channels.map((ch) => {
              const isActive = selectedChannel?.url === ch.url || (!selectedChannel && activeChannelName === ch.name);
              return (
                <motion.button
                  key={ch.url}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleChannelSelect(ch)}
                  className={`relative group flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all text-center ${
                    isActive
                      ? 'bg-red-600/10 border-red-600 shadow-lg shadow-red-900/20'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                  }`}
                >
                  {isActive && (
                    <span className="absolute top-3 right-3 flex items-center gap-1 bg-red-600 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                      AO VIVO
                    </span>
                  )}
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    isActive ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400 group-hover:bg-gray-600'
                  }`}>
                    {isActive ? <Play size={20} fill="currentColor" /> : <Tv size={20} />}
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-wider leading-snug ${
                    isActive ? 'text-red-400' : 'text-gray-200'
                  }`}>
                    {ch.name}
                  </span>
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
                  return (
                    <button
                      key={prog.id}
                      onClick={() => handleProgramClick(prog)}
                      className={`text-left p-4 rounded-xl border-l-4 transition-all hover:scale-[1.02] text-sm ${
                        isLive
                          ? 'bg-red-600/10 border-red-600 shadow-lg shadow-red-900/20'
                          : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`font-mono font-bold text-sm ${isLive ? 'text-red-400' : 'text-red-500'}`}>
                          {timeLabel}
                        </span>
                        {isLive && (
                          <span className="flex items-center gap-1 text-[9px] font-bold text-red-400 uppercase tracking-widest">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            No ar agora
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold leading-snug line-clamp-2 mb-1">{prog.title}</h3>
                      {prog.category && (
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{prog.category}</p>
                      )}
                      {prog.host && <p className="text-gray-400 text-xs line-clamp-1 mb-2">Com {prog.host}</p>}
                      {prog.youtubeUrl && (
                        <div className="flex items-center gap-1 text-[10px] font-bold text-red-500 uppercase tracking-widest">
                          <Play size={10} fill="currentColor" /> Assistir
                        </div>
                      )}
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
