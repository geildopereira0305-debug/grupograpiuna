import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Tv, Newspaper, Mic, Video, Info, LayoutDashboard, ShoppingBag } from 'lucide-react';
import { cn, newsHref } from '@/src/lib/utils';
import { useAuth } from '../hooks/useAuth';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

type TickerItem = { id: string; title: string };

export const Navbar = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [headlines, setHeadlines] = useState<TickerItem[]>([]);
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    const q = query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(12));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setHeadlines(
          snap.docs
            .map((d) => ({ id: d.id, title: (d.data().title as string) ?? '' }))
            .filter((n) => n.title),
        );
      },
      () => setHeadlines([]),
    );
    return () => unsubscribe();
  }, []);

  const navItems = [
    { name: 'Home', path: '/', icon: Info },
    { name: 'TV Grapiúna', path: '/tv', icon: Tv },
    { name: 'Notícias', path: '/noticias', icon: Newspaper },
    { name: 'EVENTOS AO VIVO', path: '/aovivo', icon: Video },
    { name: 'Podcasts', path: '/podcasts', icon: Mic },
    { name: 'Loja', path: '/loja', icon: ShoppingBag },
  ];

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      {/* Barra superior: status ao vivo + ticker com as últimas notícias */}
      <div className="bg-gray-900 text-white py-1.5 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest">
          <Link to="/tv" className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity">
            <span className="text-red-500">AO VIVO:</span>
            <span className="animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
              <span className="hidden sm:inline">TV GRAPIÚNA AO VIVO</span>
            </span>
          </Link>

          {headlines.length > 0 && (
            <div className="relative flex-1 min-w-0 overflow-hidden">
              {/* Fade na borda para o texto não "cortar" seco ao sair */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-8 z-10 bg-gradient-to-r from-gray-900 to-transparent" />
              <div
                className="flex w-max gg-ticker"
                style={{ animationDuration: `${Math.max(25, headlines.length * 5)}s` }}
              >
                {[...headlines, ...headlines].map((item, i) => (
                  <Link
                    key={`${item.id}-${i}`}
                    to={newsHref(item.title, item.id)}
                    aria-hidden={i >= headlines.length}
                    tabIndex={i >= headlines.length ? -1 : undefined}
                    className="flex items-center gap-2 px-4 text-gray-300 hover:text-white transition-colors"
                  >
                    <span className="w-1 h-1 bg-red-500 rounded-full shrink-0" />
                    <span className="whitespace-nowrap">{item.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20">
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0 flex items-center gap-2">
  <img 
    src="/assets/grupograpiuna.png" 
    alt="Grupo Grapiúna" 
    className="h-12 w-auto object-contain"
  />
</Link>
          </div>
          
          <div className="hidden md:flex items-center space-x-8">
            {navItems.map((item) => (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-red-600 flex items-center gap-2",
                  location.pathname === item.path ? "text-red-600" : "text-gray-600"
                )}
              >
                <item.icon size={18} />
                {item.name}
              </Link>
            ))}
            {user && (
              <Link
                to="/admin"
                className={cn(
                  "text-sm font-medium transition-colors hover:text-red-600 flex items-center gap-2",
                  location.pathname === "/admin" ? "text-red-600" : "text-gray-600"
                )}
              >
                <LayoutDashboard size={18} />
                Admin
              </Link>
            )}
            <Link 
              to="/anuncie" 
              className="bg-red-600 text-white px-5 py-2 rounded-full text-sm font-bold hover:bg-red-700 transition-colors"
            >
              ANUNCIE
            </Link>
          </div>

          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="text-gray-600 hover:text-gray-900 focus:outline-none"
            >
              {isOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 py-4 px-4 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              onClick={() => setIsOpen(false)}
              className={cn(
                "block px-3 py-2 rounded-md text-base font-medium flex items-center gap-3",
                location.pathname === item.path ? "bg-red-50 text-red-600" : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <item.icon size={20} />
              {item.name}
            </Link>
          ))}
          <Link
            to="/anuncie"
            onClick={() => setIsOpen(false)}
            className="block w-full text-center bg-red-600 text-white px-3 py-3 rounded-md text-base font-bold"
          >
            ANUNCIE CONOSCO
          </Link>
        </div>
      )}
    </nav>
  );
};
