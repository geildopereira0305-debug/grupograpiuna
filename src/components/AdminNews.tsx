import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Plus, Trash2, Edit2, X, Image, Youtube, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { ImageUploadField } from './ImageUploadField';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { NEWS_CATEGORIES } from '../lib/utils';
import { NewsMediaItem } from '../types';

export const AdminNews = () => {
  const [news, setNews] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    updateNote: '',
    category: 'Cidade',
    author: '',
    imageUrl: '',
    featured: false,
    media: [] as NewsMediaItem[]
  });
  const [pendingImage, setPendingImage] = useState('');
  const [pendingVideo, setPendingVideo] = useState('');
  const [pendingLinkUrl, setPendingLinkUrl] = useState('');
  const [pendingLinkTitle, setPendingLinkTitle] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'news'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNews(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'news');
    });
    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const path = 'news';
    try {
      if (editingId) {
        await updateDoc(doc(db, path, editingId), {
          ...formData,
          updatedAt: Timestamp.now()
        });
      } else {
        await addDoc(collection(db, path), {
          ...formData,
          createdAt: Timestamp.now()
        });
      }
      closeModal();
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Excluir esta notícia?')) {
      try {
        await deleteDoc(doc(db, 'news', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'news');
      }
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({ title: '', content: '', updateNote: '', category: 'Cidade', author: '', imageUrl: '', featured: false, media: [] });
    setPendingImage('');
    setPendingVideo('');
    setPendingLinkUrl('');
    setPendingLinkTitle('');
  };

  const handleEdit = (item: any) => {
    setEditingId(item.id);
    setFormData({
      title: item.title,
      content: item.content,
      updateNote: item.updateNote || '',
      category: item.category,
      author: item.author,
      imageUrl: item.imageUrl,
      featured: item.featured || false,
      media: item.media || []
    });
    setIsModalOpen(true);
  };

  const addMediaItem = (item: NewsMediaItem) => {
    setFormData(prev => ({ ...prev, media: [...prev.media, item] }));
  };

  const removeMediaItem = (index: number) => {
    setFormData(prev => ({ ...prev, media: prev.media.filter((_, i) => i !== index) }));
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter">Gerenciar <span className="text-red-600">Notícias</span></h1>
          <p className="text-gray-500 text-sm">Crie, edite ou remova artigos do portal.</p>
        </div>
        <button 
          onClick={() => { setEditingId(null); setIsModalOpen(true); }}
          className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-red-100"
        >
          <Plus size={20} /> NOVA NOTÍCIA
        </button>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-400 tracking-widest">Título</th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-400 tracking-widest">Categoria</th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-400 tracking-widest">Autor</th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-400 tracking-widest text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {news.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <img src={item.imageUrl} className="w-10 h-10 rounded-lg object-cover" alt="" />
                    <span className="font-bold text-gray-900 line-clamp-1">{item.title}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-1 rounded uppercase">{item.category}</span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{item.author}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => handleEdit(item)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 size={18} /></button>
                    <button onClick={() => handleDelete(item.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={18} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 flex-shrink-0">
              <h2 className="text-xl font-black uppercase tracking-tighter">{editingId ? 'Editar' : 'Nova'} <span className="text-red-600">Notícia</span></h2>
              <button type="button" onClick={closeModal} className="text-gray-400 hover:text-red-600 transition-colors"><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Título</label>
                  <input 
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    type="text" className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Categoria</label>
                  <select 
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                  >
                    {NEWS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Autor</label>
                  <input 
                    required
                    value={formData.author}
                    onChange={(e) => setFormData({...formData, author: e.target.value})}
                    type="text" className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600" 
                  />
                </div>
                <div className="md:col-span-2">
                  <ImageUploadField 
                    label="Imagem da Notícia"
                    value={formData.imageUrl}
                    onChange={(url) => setFormData({...formData, imageUrl: url})}
                    folder="news"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Conteúdo (Markdown)</label>
                  <textarea
                    required
                    rows={6}
                    value={formData.content}
                    onChange={(e) => setFormData({...formData, content: e.target.value})}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-600"
                  ></textarea>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-amber-500 mb-2 flex items-center gap-1.5">
                    <RefreshCw size={12} /> Atualização da Reportagem
                  </label>
                  <textarea
                    rows={3}
                    value={formData.updateNote}
                    onChange={(e) => setFormData({...formData, updateNote: e.target.value})}
                    placeholder="Acrescente uma atualização ou correção nesta matéria..."
                    className="w-full border border-amber-200 bg-amber-50/30 rounded-xl px-4 py-3 focus:outline-none focus:border-amber-400 text-sm"
                  ></textarea>
                  <p className="text-[10px] text-gray-400 mt-1">Se preenchido, será exibido em destaque no topo da matéria.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="featured"
                    checked={formData.featured}
                    onChange={(e) => setFormData({...formData, featured: e.target.checked})}
                    className="w-5 h-5 accent-red-600"
                  />
                  <label htmlFor="featured" className="text-sm font-bold text-gray-700">Notícia em Destaque</label>
                </div>

                {/* ── Mídias adicionais ── */}
                <div className="md:col-span-2 border-t border-gray-100 pt-6 space-y-5">
                  <p className="text-xs font-bold uppercase text-gray-400 tracking-widest">Mídias Adicionais</p>

                  {/* Lista atual */}
                  {formData.media.length > 0 && (
                    <ul className="space-y-2">
                      {formData.media.map((item, i) => (
                        <li key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2 text-sm">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            item.type === 'image' ? 'bg-blue-100 text-blue-600' :
                            item.type === 'video' ? 'bg-red-100 text-red-600' :
                            'bg-gray-200 text-gray-600'
                          }`}>{item.type}</span>
                          <span className="flex-1 truncate text-gray-600">{item.title || item.url}</span>
                          <button type="button" onClick={() => removeMediaItem(i)} className="text-gray-400 hover:text-red-600 transition-colors">
                            <X size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Adicionar foto */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase text-gray-400 flex items-center gap-1"><Image size={12}/> Foto adicional</p>
                    <div className="flex gap-2">
                      <ImageUploadField
                        label=""
                        value={pendingImage}
                        onChange={setPendingImage}
                        folder="news"
                      />
                    </div>
                    {pendingImage && (
                      <button
                        type="button"
                        onClick={() => { addMediaItem({ type: 'image', url: pendingImage }); setPendingImage(''); }}
                        className="text-xs font-bold bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        + Adicionar foto
                      </button>
                    )}
                  </div>

                  {/* Adicionar vídeo */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase text-gray-400 flex items-center gap-1"><Youtube size={12}/> Vídeo (URL YouTube)</p>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={pendingVideo}
                        onChange={(e) => setPendingVideo(e.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-red-600"
                      />
                      <button
                        type="button"
                        disabled={!pendingVideo.trim()}
                        onClick={() => { addMediaItem({ type: 'video', url: pendingVideo.trim() }); setPendingVideo(''); }}
                        className="bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Adicionar link */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase text-gray-400 flex items-center gap-1"><LinkIcon size={12}/> Link externo</p>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={pendingLinkUrl}
                        onChange={(e) => setPendingLinkUrl(e.target.value)}
                        placeholder="https://..."
                        className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-red-600"
                      />
                      <input
                        type="text"
                        value={pendingLinkTitle}
                        onChange={(e) => setPendingLinkTitle(e.target.value)}
                        placeholder="Título (opcional)"
                        className="w-36 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-red-600"
                      />
                      <button
                        type="button"
                        disabled={!pendingLinkUrl.trim()}
                        onClick={() => {
                          addMediaItem({ type: 'link', url: pendingLinkUrl.trim(), title: pendingLinkTitle.trim() || undefined });
                          setPendingLinkUrl('');
                          setPendingLinkTitle('');
                        }}
                        className="bg-gray-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-900 transition-colors disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={closeModal} className="flex-1 bg-gray-100 text-gray-500 font-bold py-4 rounded-xl hover:bg-gray-200 transition-colors">CANCELAR</button>
                <button type="submit" className="flex-1 bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100">SALVAR NOTÍCIA</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
