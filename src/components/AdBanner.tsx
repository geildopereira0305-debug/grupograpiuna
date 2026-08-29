import React, { useState, useEffect } from 'react';
import { cn } from '@/src/lib/utils';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../firebase';

interface AdBannerProps {
  size: 'leaderboard' | 'sidebar' | 'mobile' | 'intermediario' | 'cover';
  page?: string;
  className?: string;
  /** Posição do anúncio na lista (0 = primeiro, 1 = segundo…). Evita duplicatas quando
   *  dois AdBanners do mesmo tamanho/página são renderizados juntos. Sem este prop, sorteia. */
  index?: number;
}

export const AdBanner = ({ size, page, className, index }: AdBannerProps) => {
  const [ad, setAd] = useState<any>(null);

  useEffect(() => {
    let q = query(
      collection(db, 'ads'),
      where('size', '==', size),
      where('active', '==', true)
    );

    if (page) {
      q = query(q, where('page', '==', page));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const i = typeof index === 'number'
          ? index % snapshot.docs.length
          : Math.floor(Math.random() * snapshot.docs.length);
        setAd(snapshot.docs[i].data());
      } else {
        setAd(null);
      }
    });

    return () => unsubscribe();
  }, [size, page, index]);

  const sizeClasses = {
    leaderboard:  'w-full max-w-[970px] h-[90px]',
    intermediario:'w-full max-w-[728px] h-[90px]',
    sidebar:      'w-[300px] h-[250px]',
    cover:        'w-full max-w-[1600px] aspect-[16/5] sm:aspect-[5/1] rounded-2xl shadow-2xl shadow-black/40 ring-1 ring-white/5',
  };

  const labels = {
    leaderboard:  'Leaderboard 970×90',
    intermediario:'Intermediário 728×90',
    sidebar:      'Sidebar 300×250',
    mobile:       'Mobile 320×50',
    cover:        'Capa TV 1600×320',
  };

  const cls = sizeClasses[size];

  if (ad) {
    return (
      <a
        href={ad.link}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('block rounded-lg overflow-hidden mx-auto transition-transform hover:scale-[1.01]', cls, className)}
      >
        <img src={ad.imageUrl} alt="Publicidade" className="w-full h-full object-cover" />
      </a>
    );
  }

  return (
    <div className={cn('bg-gray-100 border border-gray-200 flex items-center justify-center rounded-lg overflow-hidden mx-auto', cls, className)}>
      <div className="text-center">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Publicidade</span>
        <span className="text-[10px] font-medium text-gray-300 uppercase">{labels[size]}</span>
      </div>
    </div>
  );
};
