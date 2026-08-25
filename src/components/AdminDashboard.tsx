import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { loginWithGoogle, logout } from '../firebase';
import { Handshake, LayoutDashboard, Newspaper, Tv, Image as ImageIcon, LogOut, LogIn, ChevronRight, Briefcase, Mic, Youtube, BarChart3, Smartphone, ShoppingBag, Radio, Package as PackageIcon, Users as UsersIcon, Wallet } from 'lucide-react';
import { AdminNews } from './AdminNews';
import { AdminSchedule } from './AdminSchedule';
import { AdminAds } from './AdminAds';
import { AdminHub73 } from './AdminHub73';
import { AdminPodcasts } from './AdminPodcasts';
import { AdminVideos } from './AdminVideos';
import { AdminAnalytics } from './AdminAnalytics';
import { AdminStories } from './AdminStories';
import { AdminShop } from './AdminShop';
import { AdminLiveChannels } from './AdminLiveChannels';
import { AdminPackages } from './AdminPackages';
import { AdminClients } from './AdminClients';
import { AdminContracts } from './AdminContracts';
import { AdminFinance } from './AdminFinance';
import type { ClientDocument, WithId } from '../lib/commercial-types';

/**
 * Papéis com acesso ao painel. Inclui os papéis comerciais introduzidos pelo
 * módulo comercial — sem isso, gerente/comercial/financeiro cairiam na tela de
 * "Acesso Negado". A autorização fina de cada operação fica nas Firestore Rules
 * e nas rotas de api/; esconder o menu não protege o banco.
 */
const PANEL_ROLES = [
  'admin',
  'editor',
  'gerente',
  'comercial',
  'financeiro',
  'operador_anuncios',
  'visualizacao',
];

export const AdminDashboard = () => {
  const { user, role, loading, isAdmin } = useAuth();
  const [contractClient, setContractClient] = useState<WithId<ClientDocument> | null>(null);
  const [activeTab, setActiveTab] = useState<'analytics' | 'packages' | 'clients' | 'contracts' | 'finance' | 'news' | 'schedule' | 'channels' | 'ads' | 'hub73' | 'podcasts' | 'videos' | 'stories' | 'shop'>('analytics');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-gray-100 text-center">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <LayoutDashboard size={40} />
          </div>
          <h1 className="text-3xl font-black mb-4 uppercase tracking-tighter">Área <span className="text-red-600">Restrita</span></h1>
          <p className="text-gray-500 mb-8">Acesse com sua conta autorizada para gerenciar o portal Grupo Grapiúna.</p>
          <button 
            onClick={loginWithGoogle}
            className="w-full bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-red-200"
          >
            <LogIn size={20} /> ENTRAR COM GOOGLE
          </button>
        </div>
      </div>
    );
  }

  if (!role || !PANEL_ROLES.includes(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-gray-100 text-center">
          <h1 className="text-2xl font-black mb-4 text-red-600 uppercase">Acesso Negado</h1>
          <p className="text-gray-500 mb-8">Você não tem permissão para acessar esta área. Entre em contato com o administrador.</p>
          <button onClick={logout} className="text-gray-400 font-bold hover:text-red-600 transition-colors">SAIR</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-r border-gray-200 p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-10">
          <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">G</div>
          <span className="font-bold text-lg tracking-tighter text-gray-900">ADMIN <span className="text-red-600">PORTAL</span></span>
        </div>

        <nav className="flex-1 space-y-2">
          {[
            { id: 'analytics', label: 'Audiência', icon: BarChart3 },
            { id: 'packages', label: 'Pacotes', icon: PackageIcon },
            { id: 'clients', label: 'Clientes', icon: UsersIcon },
            { id: 'contracts', label: 'Contratos', icon: Handshake },
            { id: 'finance', label: 'Financeiro', icon: Wallet },
            { id: 'news', label: 'Notícias', icon: Newspaper },
            { id: 'schedule', label: 'TV Grade', icon: Tv },
            { id: 'channels', label: 'Canais TV', icon: Radio },
            { id: 'ads', label: 'Publicidade', icon: ImageIcon },
            { id: 'hub73', label: 'Hub73', icon: Briefcase },
            { id: 'podcasts', label: 'Podcasts', icon: Mic },
            { id: 'videos', label: 'Vídeos YT', icon: Youtube },
            { id: 'stories', label: 'Stories', icon: Smartphone },
            { id: 'shop', label: 'Loja', icon: ShoppingBag },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center justify-between p-3 rounded-xl font-bold text-sm transition-all ${
                activeTab === item.id 
                  ? 'bg-red-600 text-white shadow-lg shadow-red-100' 
                  : 'text-gray-500 hover:bg-gray-50 hover:text-red-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon size={18} />
                {item.label}
              </div>
              <ChevronRight size={14} className={activeTab === item.id ? 'opacity-100' : 'opacity-0'} />
            </button>
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-gray-100">
          <div className="flex items-center gap-3 mb-6 px-2">
            <img src={user.photoURL || ''} alt="User" className="w-10 h-10 rounded-full border-2 border-red-100" />
            <div className="overflow-hidden">
              <p className="text-xs font-black text-gray-900 truncate">{user.displayName}</p>
              <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">{role}</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 p-3 text-gray-400 hover:text-red-600 font-bold text-sm transition-colors"
          >
            <LogOut size={18} /> SAIR DO PAINEL
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-12 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {activeTab === 'analytics' && <AdminAnalytics />}
          {activeTab === 'packages' && <AdminPackages />}
          {activeTab === 'clients' && (
            <AdminClients
              onStartContract={(client) => { setContractClient(client); setActiveTab('contracts'); }}
            />
          )}
          {activeTab === 'contracts' && (
            <AdminContracts
              initialClient={contractClient}
              onConsumeInitialClient={() => setContractClient(null)}
            />
          )}
          {activeTab === 'finance' && <AdminFinance />}
          {activeTab === 'news' && <AdminNews />}
          {activeTab === 'schedule' && <AdminSchedule />}
          {activeTab === 'channels' && <AdminLiveChannels />}
          {activeTab === 'ads' && <AdminAds />}
          {activeTab === 'hub73' && <AdminHub73 />}
          {activeTab === 'podcasts' && <AdminPodcasts />}
          {activeTab === 'videos' && <AdminVideos />}
          {activeTab === 'stories' && <AdminStories />}
          {activeTab === 'shop' && <AdminShop />}
        </div>
      </main>
    </div>
  );
};
