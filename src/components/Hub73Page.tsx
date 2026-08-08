import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Minimize2, Maximize2, Expand } from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { AdBanner } from './AdBanner';
import Hls from 'hls.js';

/* ─── Tipos ────────────────────────────────────────────────────────────────── */
interface HubVideo {
  id: string;
  title: string;
  category: string;
  description?: string;
  imageUrl: string;
  videoUrl: string;
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const getYouTubeEmbedUrl = (url: string, autoplay: boolean): string | null => {
  // Cobre watch?v=, youtu.be/, /embed/, /live/, /shorts/ e /v/.
  // O ID do YouTube tem sempre 11 caracteres [A-Za-z0-9_-].
  const match = url?.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return match
    ? `https://www.youtube.com/embed/${match[1]}?autoplay=${autoplay ? 1 : 0}&rel=0&modestbranding=1`
    : null;
};

const isHLS = (url?: string) => !!url?.includes('.m3u8');

/* ─── Player interno (YouTube / HLS / MP4) ────────────────────────────────── */
const VideoPlayer = ({
  video,
  autoplay,
  videoRef,
}: {
  video: HubVideo;
  autoplay: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) => {
  const embedUrl = getYouTubeEmbedUrl(video.videoUrl, autoplay);

  if (embedUrl) {
    return (
      <iframe
        key={`yt-${video.id}-${autoplay}`}
        src={embedUrl}
        title={video.title}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  if (isHLS(video.videoUrl)) {
    return (
      <video
        ref={videoRef}
        controls
        playsInline
        className="w-full h-full object-contain"
      />
    );
  }

  return (
    <video
      key={`mp4-${video.id}`}
      src={video.videoUrl}
      controls
      autoPlay={autoplay}
      playsInline
      className="w-full h-full object-contain"
    />
  );
};

/* ─── Componente principal ────────────────────────────────────────────────── */
export const Hub73Page = () => {
  const [videos, setVideos] = useState<HubVideo[]>([]);
  const [filter, setFilter] = useState('Todos');
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState<HubVideo | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [playerSize, setPlayerSize] = useState<'sm' | 'lg'>('lg');

  const playerRef = useRef<HTMLDivElement>(null);
  const fsRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const initializedRef = useRef(false);

  /* ── Firestore: hub73 ──────────────────────────────────────────────────── */
  useEffect(() => {
    const q = query(collection(db, 'hub73'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HubVideo));
        setVideos(items);
        if (items.length > 0 && !initializedRef.current) {
          initializedRef.current = true;
          setSelectedVideo(items[0]);
        }
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'hub73');
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  /* ── HLS ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (!selectedVideo || !isHLS(selectedVideo.videoUrl) || !videoRef.current) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(selectedVideo.videoUrl);
      hls.attachMedia(videoRef.current);
      if (autoplay) {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current?.play().catch(() => {});
        });
      }
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.current.src = selectedVideo.videoUrl;
      if (autoplay) videoRef.current.play().catch(() => {});
    }

    return () => { hlsRef.current?.destroy(); hlsRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideo?.id]);

  /* ── Helpers ───────────────────────────────────────────────────────────── */
  const selectVideo = (video: HubVideo) => {
    setAutoplay(true);
    setSelectedVideo(video);
    setTimeout(() => {
      playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const handleFullscreen = () => {
    const el = fsRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  };

  const filteredVideos =
    filter === 'Todos'
      ? videos
      : videos.filter((v) => v.category?.toLowerCase() === filter.toLowerCase());

  const categories = ['Todos', ...new Set(videos.map((v) => v.category).filter(Boolean))];

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-white">

      {/* ════════════════════════════════════════════════════════════════════
          2. PLAYER DE DESTAQUE — carrega o vídeo selecionado na grade
      ═════════════════════════════════════════════════════════════════════ */}
      <section
        ref={playerRef}
        className="bg-gray-950 py-10 scroll-mt-0"
      >
        <div className="w-full px-4 sm:px-6 lg:px-8">
          {loading ? (
            <div className="w-full aspect-video bg-gray-900 rounded-2xl animate-pulse" />
          ) : selectedVideo ? (
            <>
              {/* Controles de tamanho — centralizados no topo */}
              <div className="flex items-center justify-center gap-1.5 mb-4">
                <button
                  onClick={() => setPlayerSize('sm')}
                  title="Tela menor"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-colors ${playerSize === 'sm' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                >
                  <Minimize2 size={12} /> Menor
                </button>
                <button
                  onClick={() => setPlayerSize('lg')}
                  title="Tela maior"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-colors ${playerSize === 'lg' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                >
                  <Maximize2 size={12} /> Maior
                </button>
                <button
                  onClick={handleFullscreen}
                  title="Tela completa"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-gray-800 text-gray-400 hover:text-white transition-colors"
                >
                  <Expand size={12} /> Completa
                </button>
              </div>

              {/* Player central ladeado por colunas de banners (desktop) */}
              <div className="flex gap-6 items-start">
                {/* Coluna esquerda — 3 banners */}
                <aside className="hidden lg:flex flex-col gap-6 shrink-0">
                  <AdBanner size="sidebar" page="hub73" index={0} />
                  <AdBanner size="sidebar" page="hub73" index={1} />
                  <AdBanner size="sidebar" page="hub73" index={2} />
                </aside>

                {/* Player */}
                <div className="flex-1 min-w-0">
                  <div className={`transition-all duration-300 mx-auto ${playerSize === 'sm' ? 'max-w-3xl' : ''}`}>
                    <div ref={fsRef} className="w-full bg-black rounded-2xl overflow-hidden border border-gray-800/60 shadow-[0_0_80px_rgba(0,0,0,0.9)]">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={selectedVideo.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                          className="relative aspect-video w-full bg-black"
                        >
                          <VideoPlayer
                            video={selectedVideo}
                            autoplay={autoplay}
                            videoRef={videoRef}
                          />
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    {/* Descrição do evento — abaixo do player, na coluna central */}
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={`info-${selectedVideo.id}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="mt-5"
                      >
                        {selectedVideo.category && (
                          <span className="text-[10px] font-black uppercase tracking-widest text-red-500 block mb-1.5">
                            {selectedVideo.category}
                          </span>
                        )}
                        <h2 className="text-white text-xl md:text-2xl font-black leading-tight mb-3">
                          {selectedVideo.title}
                        </h2>
                        {selectedVideo.description ? (
                          <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">
                            {selectedVideo.description}
                          </p>
                        ) : (
                          <p className="text-gray-600 text-sm italic">
                            Sem descrição cadastrada para este evento.
                          </p>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>

                {/* Coluna direita — 3 banners */}
                <aside className="hidden lg:flex flex-col gap-6 shrink-0">
                  <AdBanner size="sidebar" page="hub73" index={3} />
                  <AdBanner size="sidebar" page="hub73" index={4} />
                  <AdBanner size="sidebar" page="hub73" index={5} />
                </aside>
              </div>

            </>
          ) : null}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          3. NOSSAS PRODUÇÕES — grade de vídeos com filtros
      ═════════════════════════════════════════════════════════════════════ */}
      <section className="bg-gray-50 py-16">
        <div className="w-full px-4 sm:px-6 lg:px-8">

          {/* Cabeçalho da seção + filtros */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">
                Hub73 Produtora
              </p>
              <h2 className="text-3xl font-black uppercase tracking-tighter text-gray-900">
                Nossas <span className="text-red-600">Produções</span>
              </h2>
            </div>
            <div className="flex flex-wrap gap-5">
              {categories.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs font-bold uppercase tracking-widest transition-colors ${
                    filter === f
                      ? 'text-red-600'
                      : 'text-gray-400 hover:text-red-500'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Grade */}
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-video bg-gray-200 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">
                Nenhum vídeo encontrado nesta categoria.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {filteredVideos.map((video) => {
                const isActive = selectedVideo?.id === video.id;
                return (
                  <motion.div
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    key={video.id}
                    onClick={() => selectVideo(video)}
                    className={`group relative aspect-video bg-gray-900 rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${
                      isActive
                        ? 'ring-2 ring-red-600 ring-offset-2 ring-offset-gray-50 shadow-lg shadow-red-100'
                        : 'ring-2 ring-transparent hover:ring-gray-300 shadow-sm hover:shadow-md'
                    }`}
                  >
                    {/* Thumbnail */}
                    <img
                      src={video.imageUrl}
                      alt={video.title}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />

                    {/* Overlay hover: categoria + título + descrição + Play */}
                    <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center text-white p-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest mb-1 text-red-500">
                        {video.category}
                      </span>
                      <h4 className="text-sm font-bold text-center line-clamp-2 mb-1">
                        {video.title}
                      </h4>
                      {video.description && (
                        <p className="text-xs text-gray-300 text-center line-clamp-2 mb-3 px-2">
                          {video.description}
                        </p>
                      )}
                      <div className="w-6 h-6 bg-red-600 rounded-full flex items-center justify-center shadow-xl">
                        <Play size={10} fill="white" color="white" className="ml-0.5" />
                      </div>
                    </div>

                    {/* Badge de categoria — visível em repouso */}
                    <div className="absolute bottom-3 left-3 group-hover:opacity-0 transition-opacity">
                      <span className="bg-black/60 text-[10px] font-bold uppercase tracking-widest text-gray-300 px-2 py-1 rounded-full">
                        {video.category}
                      </span>
                    </div>

                    {/* Indicador "em reprodução" */}
                    {isActive && (
                      <div className="absolute top-3 right-3">
                        <span className="bg-red-600 text-white text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full">
                          ▶ Reproduzindo
                        </span>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
