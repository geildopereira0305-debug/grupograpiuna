import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Play, ArrowRight, Tv, Newspaper, Mic, Video, Youtube, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdBanner } from './AdBanner';
import { collection, query, orderBy, limit, onSnapshot, updateDoc, doc, increment } from 'firebase/firestore';
import { db } from '../firebase';
import { YouTubeVideo } from '../types';
import { newsHref } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export const Home = () => {
  const [latestNews, setLatestNews] = useState<any[]>([]);
  const [latestVideos, setLatestVideos] = useState<YouTubeVideo[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);

  const incrementVideoViews = async (video: YouTubeVideo) => {
    try {
      await updateDoc(doc(db, 'youtube_videos', video.id), {
        views: increment(1)
      });
    } catch (error) {
      console.error('Error incrementing video views:', error);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(3));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLatestNews(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'youtube_videos'), orderBy('publishedAt', 'desc'), limit(4));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setLatestVideos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as YouTubeVideo)));
        setVideosLoading(false);
      },
      (error) => {
        // Sem este handler a falha era silenciosa e a seção ficava em skeleton eterno
        handleFirestoreError(error, OperationType.LIST, 'youtube_videos');
        setVideosLoading(false);
      },
    );
    return () => unsubscribe();
  }, []);

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative h-[80vh] flex items-center justify-center overflow-hidden bg-black">
        <div className="absolute inset-0 opacity-60">
          <img 
            src="/assets/home.png" // Caminho atualizado
      alt="Studio" 
      className="w-full h-full object-cover"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/40"></div>
        
        <div className="relative z-10 max-w-5xl mx-auto px-4 text-center text-white">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-7xl font-black tracking-tighter mb-6 uppercase"
          >
            A VOZ DO <span className="text-red-600">SUL DA BAHIA</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-xl md:text-2xl font-light mb-10 max-w-3xl mx-auto text-gray-200"
          >
            Informação, entretenimento e tecnologia audiovisual integrados em um só lugar.
          </motion.p>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex flex-wrap justify-center gap-4"
          >
            <Link to="/tv" className="bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-full font-bold flex items-center gap-2 transition-all transform hover:scale-105">
              <Play size={20} fill="currentColor" /> ASSISTIR TV AO VIVO
            </Link>
            <Link to="/noticias" className="bg-white hover:bg-gray-100 text-black px-8 py-4 rounded-full font-bold flex items-center gap-2 transition-all transform hover:scale-105">
              LER NOTÍCIAS <ArrowRight size={20} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Leaderboard Ad */}
      <div className="py-10 bg-white">
        <AdBanner size="leaderboard" />
      </div>

      {/* Quick Links Grid */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { title: 'TV Grapiúna', icon: Tv, desc: 'Programação local 24h ao vivo.', color: 'bg-red-600', link: '/tv' },
              { title: 'Portal de Notícias', icon: Newspaper, desc: 'O que acontece na região e no mundo.', color: 'bg-blue-600', link: '/noticias' },
              { title: 'HUB73 Produtora', icon: Video, desc: 'Soluções audiovisuais de alto impacto.', color: 'bg-purple-600', link: '/aovivo' },
              { title: 'Rede Podcasts', icon: Mic, desc: 'As melhores conversas estão aqui.', color: 'bg-orange-600', link: '/podcasts' },
            ].map((item, i) => (
              <motion.div 
                key={item.title}
                whileHover={{ y: -10 }}
                className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center"
              >
                <div className={`${item.color} w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg`}>
                  <item.icon size={32} />
                </div>
                <h3 className="text-xl font-bold mb-3 text-gray-900">{item.title}</h3>
                <p className="text-gray-500 mb-6 text-sm">{item.desc}</p>
                <Link to={item.link} className="text-red-600 font-bold text-sm flex items-center gap-1 hover:gap-2 transition-all">
                  CONHECER <ArrowRight size={16} />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured News Preview */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-3xl font-black uppercase tracking-tighter">Últimas <span className="text-red-600">Notícias</span></h2>
              <div className="h-1 w-20 bg-red-600 mt-2"></div>
            </div>
            <Link to="/noticias" className="text-gray-500 font-bold text-sm hover:text-red-600 transition-colors">VER TODAS</Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {latestNews.length > 0 ? latestNews.map((item) => (
              <Link to={newsHref(item.title, item.id)} key={item.id} className="group cursor-pointer">
                <div className="relative overflow-hidden rounded-xl mb-4 aspect-video">
                  <img 
                    src={item.imageUrl} 
                    alt={item.title} 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute top-4 left-4 bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded uppercase">
                    {item.category}
                  </div>
                </div>
                <h3 className="text-xl font-bold leading-tight group-hover:text-red-600 transition-colors mb-2">
                  {item.title}
                </h3>
                <p className="text-gray-500 text-sm line-clamp-2">
                  {item.content}
                </p>
              </Link>
            )) : (
              [1, 2, 3].map((n) => (
                <div key={n} className="animate-pulse">
                  <div className="bg-gray-200 aspect-video rounded-xl mb-4"></div>
                  <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* YouTube Videos Section */}
      <section className="py-20 bg-gray-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-3">
                <Youtube size={32} className="text-red-600" /> TV <span className="text-red-600">Grapiúna</span>
              </h2>
              <div className="h-1 w-20 bg-red-600 mt-2"></div>
            </div>
            <Link to="/tv" className="text-gray-400 font-bold text-sm hover:text-red-600 transition-colors">VER TODOS</Link>
          </div>

          {!videosLoading && latestVideos.length === 0 && (
            <div className="py-12 text-center border border-dashed border-gray-800 rounded-2xl">
              <Youtube size={30} className="mx-auto mb-3 text-gray-700" />
              <p className="text-gray-500 text-sm font-bold">Nenhum vídeo cadastrado ainda.</p>
              <p className="text-gray-600 text-xs mt-1">Adicione vídeos em Admin → Vídeos.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {latestVideos.length > 0 ? latestVideos.map((video) => (
              <Link 
                to="/tv" 
                key={video.id} 
                className="group cursor-pointer"
                onClick={() => incrementVideoViews(video)}
              >
                <div className="relative overflow-hidden rounded-xl mb-4 aspect-video border border-gray-800">
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      // maxresdefault não existe para todo vídeo; hqdefault sempre existe
                      const img = e.currentTarget;
                      if (img.src.includes('maxresdefault')) {
                        img.src = img.src.replace('maxresdefault', 'hqdefault');
                      }
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center shadow-xl">
                      <Play size={24} fill="white" className="text-white ml-1" />
                    </div>
                  </div>
                </div>
                <h3 className="text-lg font-bold leading-tight group-hover:text-red-600 transition-colors mb-2 line-clamp-2">
                  {video.title}
                </h3>
                <div className="flex items-center justify-between">
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">
                    {new Date(video.publishedAt).toLocaleDateString('pt-BR')}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 font-bold">
                    <Eye size={12} /> {video.views || 0}
                  </div>
                </div>
              </Link>
            )) : videosLoading ? (
              [1, 2, 3, 4].map((n) => (
                <div key={n} className="animate-pulse">
                  <div className="bg-gray-900 aspect-video rounded-xl mb-4"></div>
                  <div className="h-5 bg-gray-900 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-900 rounded w-1/4"></div>
                </div>
              ))
            ) : null}
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-20 bg-red-600 text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-black mb-6 uppercase">Quer anunciar sua marca conosco?</h2>
          <p className="text-xl mb-10 opacity-90">Temos o plano ideal para o seu negócio alcançar todo o Sul da Bahia.</p>
          <Link to="/anuncie" className="inline-block bg-white text-red-600 px-10 py-4 rounded-full font-bold text-lg hover:bg-gray-100 transition-all transform hover:scale-105 shadow-xl">
            SOLICITAR MÍDIA KIT
          </Link>
        </div>
      </section>
    </div>
  );
};
