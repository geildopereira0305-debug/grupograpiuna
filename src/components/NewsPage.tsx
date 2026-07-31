import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Search, Filter, Clock, User, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdBanner } from './AdBanner';
import { StoriesStrip } from './StoriesStrip';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '../firebase';
import { newsHref, NEWS_CATEGORIES } from '../lib/utils';

export const NewsPage = () => {
  const categories = ['Todas', ...NEWS_CATEGORIES];
  const [news, setNews] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let q = query(collection(db, 'news'), orderBy('createdAt', 'desc'));
    
    if (selectedCategory !== 'Todas') {
      q = query(collection(db, 'news'), where('category', '==', selectedCategory), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNews(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [selectedCategory]);

  const filteredNews = news.filter(item => 
    item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const featuredNews = filteredNews.find(item => item.featured) || filteredNews[0];
  const feedNews = filteredNews.filter(item => item.id !== featuredNews?.id);

  return (
    <div className="bg-white min-h-screen">

      {/* Stories / Reels */}
      <StoriesStrip />

      {/* Category Bar */}
      <div className="bg-gray-100 border-b border-gray-200 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-4 flex space-x-8 h-12 items-center whitespace-nowrap scrollbar-hide">
          {categories.map((cat) => (
            <button 
              key={cat} 
              onClick={() => setSelectedCategory(cat)}
              className={`text-xs font-bold uppercase tracking-widest transition-colors ${selectedCategory === cat ? 'text-red-600' : 'text-gray-600 hover:text-red-600'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Top Ad — Sticky Banner */}
        <div className="sticky top-28 z-40 mb-12 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 backdrop-blur-md shadow-md border-b border-gray-100">
          <AdBanner size="leaderboard" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-3 space-y-8">
            {/* Featured Post */}
            {featuredNews && (
              <Link to={newsHref(featuredNews.title, featuredNews.id)} className="relative group cursor-pointer block overflow-hidden rounded-2xl">
                <div className="aspect-[21/9]">
                  <img 
                    src={featuredNews.imageUrl} 
                    alt={featuredNews.title} 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent"></div>
                <div className="absolute bottom-0 left-0 p-8 text-white">
                  <span className="bg-red-600 px-3 py-1 rounded text-[10px] font-bold uppercase mb-4 inline-block">Destaque</span>
                  <h2 className="text-3xl md:text-4xl font-black leading-tight mb-4 max-w-3xl">
                    {featuredNews.title}
                  </h2>
                  <div className="flex items-center gap-4 text-sm opacity-80">
                    <span className="flex items-center gap-1"><User size={14} /> Por {featuredNews.author}</span>
                    <span className="flex items-center gap-1"><Clock size={14} /> {new Date(featuredNews.createdAt?.seconds * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              </Link>
            )}

            {/* News Feed */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {feedNews.map((item) => (
                <Link
                  to={newsHref(item.title, item.id)}
                  key={item.id}
                  className="flex flex-col gap-3 group"
                >
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="flex flex-col gap-3"
                  >
                    <div className="aspect-video overflow-hidden rounded-xl">
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div>
                      <span className="text-red-600 text-[10px] font-bold uppercase tracking-widest mb-1.5 block">{item.category}</span>
                      <h3 className="text-lg font-bold leading-snug group-hover:text-red-600 transition-colors mb-2">
                        {item.title}
                      </h3>
                      <p className="text-gray-500 text-sm line-clamp-2 mb-3">
                        {item.content}
                      </p>
                      <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        <span>{new Date(item.createdAt?.seconds * 1000).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1">Ler mais <ChevronRight size={12} /></span>
                      </div>
                    </div>
                  </motion.div>
                </Link>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-8">
            {/* Search */}
            <div className="relative">
              <input 
                type="text" 
                placeholder="Pesquisar notícias..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 pl-10 text-sm focus:outline-none focus:border-red-600"
              />
              <Search className="absolute left-3 top-3.5 text-gray-400" size={18} />
            </div>

            {/* Ads */}
            <AdBanner size="sidebar" className="mb-12" />

            {/* Most Read */}
            <div>
              <h3 className="font-black uppercase tracking-tighter text-lg mb-6 border-b-2 border-red-600 inline-block">Mais Lidas</h3>
              <div className="space-y-6">
                {filteredNews.slice(0, 4).map((item, i) => (
                  <Link to={newsHref(item.title, item.id)} key={item.id} className="flex gap-4 group cursor-pointer">
                    <span className="text-3xl font-black text-gray-200 group-hover:text-red-600 transition-colors">0{i+1}</span>
                    <p className="text-sm font-bold leading-tight group-hover:text-red-600 transition-colors">
                      {item.title}
                    </p>
                  </Link>
                ))}
              </div>
            </div>

            {/* Newsletter */}
            <div className="bg-red-600 p-8 rounded-2xl text-white">
              <h3 className="font-bold text-xl mb-4">Newsletter</h3>
              <p className="text-sm opacity-90 mb-6">Receba as principais notícias no seu e-mail todas as manhãs.</p>
              <input 
                type="email" 
                placeholder="Seu e-mail" 
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-sm mb-3 focus:outline-none placeholder:text-white/50"
              />
              <button className="w-full bg-white text-red-600 font-bold py-2 rounded-lg text-sm hover:bg-gray-100 transition-colors">
                INSCREVER
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
