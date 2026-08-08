import React from 'react';
import { motion } from 'motion/react';
import { Download, BarChart3, Users, Globe, Mail } from 'lucide-react';

/** Caminho do mídia kit. O arquivo deve estar em public/assets/midia-kit.pdf */
const MIDIA_KIT_PDF = '/assets/midia-kit.pdf';

export const MidiaKitPage = () => {
  return (
    <div className="bg-white min-h-screen">
      {/* Hero */}
      <section className="bg-red-600 text-white py-24">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-6 uppercase">Mídia Kit 2026</h1>
          <p className="text-xl opacity-90 max-w-2xl mx-auto mb-10">
            Conecte sua marca ao maior ecossistema de comunicação do Sul da Bahia.
          </p>
          {/* O arquivo fica em public/assets/ e é servido a partir da raiz do site.
              O atributo download define o nome sugerido ao salvar. */}
          <a
            href={MIDIA_KIT_PDF}
            download="Midia-Kit-Grupo-Grapiuna-2026.pdf"
            className="bg-white text-red-600 px-10 py-4 rounded-full font-bold text-lg hover:bg-gray-100 transition-all inline-flex items-center gap-2 mx-auto shadow-xl"
          >
            <Download size={20} /> BAIXAR PDF COMPLETO
          </a>
        </div>
      </section>

      {/* Stats */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
            {[
              { label: 'Alcance Mensal', value: '2.5M+', icon: Globe },
              { label: 'Engajamento', value: '18%', icon: BarChart3 },
              { label: 'Seguidores Reais', value: '500k+', icon: Users },
            ].map((stat, i) => (
              <div key={i} className="p-8 bg-gray-50 rounded-3xl border border-gray-100">
                <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center mx-auto mb-6">
                  <stat.icon size={24} />
                </div>
                <div className="text-4xl font-black text-gray-900 mb-2">{stat.value}</div>
                <div className="text-gray-500 font-bold uppercase text-xs tracking-widest">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 bg-white p-12 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-3xl font-black mb-8 text-center uppercase tracking-tighter">Solicitar <span className="text-red-600">Proposta</span></h2>
          <form className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-2">Nome Completo</label>
                <input type="text" className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-2">Empresa</label>
                <input type="text" className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-gray-500 mb-2">E-mail Corporativo</label>
              <input type="email" className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-gray-500 mb-2">Mensagem</label>
              <textarea rows={4} className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"></textarea>
            </div>
            <button className="w-full bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-colors flex items-center justify-center gap-2">
              <Mail size={20} /> ENVIAR SOLICITAÇÃO
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};
