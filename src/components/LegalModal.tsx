import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Language } from '../types';
import { getLegalDocument, LegalDocId } from '../data/legalTexts';

interface LegalModalProps {
  doc: LegalDocId | null;
  language: Language;
  onClose: () => void;
}

/**
 * Full-screen sheet with the privacy policy or the terms of use. Drawn at the top level of the
 * page: opened from the account menu or the login dialog, a parent with blur or a transform
 * would otherwise squeeze it into a thin strip under that menu.
 */
export const LegalModal: React.FC<LegalModalProps> = ({ doc, language, onClose }) => {
  if (!doc) return null;
  const content = getLegalDocument(doc, language);
  const closeLabel = language === 'kz' ? 'Жабу' : 'Закрыть';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-title"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
    >
      <div className="w-full sm:max-w-lg max-h-[92vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 pb-3 border-b border-slate-100">
          <div>
            <h2 id="legal-title" className="text-base font-bold text-slate-900 font-display">
              {content.title}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{content.updated}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain p-5 pt-3 space-y-4 text-sm text-slate-700 leading-relaxed">
          {content.sections.map((section) => (
            <section key={section.heading} className="space-y-1.5">
              <h3 className="text-sm font-bold text-slate-900">{section.heading}</h3>
              {section.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};

/** "Privacy policy · Terms of use" links that open the documents in place. */
export const LegalLinks: React.FC<{ language: Language; className?: string }> = ({ language, className }) => {
  const [doc, setDoc] = useState<LegalDocId | null>(null);
  const privacy = language === 'kz' ? 'Құпиялылық саясаты' : 'Политика конфиденциальности';
  const terms = language === 'kz' ? 'Пайдалану шарттары' : 'Условия использования';
  return (
    <>
      <span className={className}>
        <button type="button" onClick={() => setDoc('privacy')} className="underline underline-offset-2 hover:text-slate-800">
          {privacy}
        </button>
        <span aria-hidden="true"> · </span>
        <button type="button" onClick={() => setDoc('terms')} className="underline underline-offset-2 hover:text-slate-800">
          {terms}
        </button>
      </span>
      <LegalModal doc={doc} language={language} onClose={() => setDoc(null)} />
    </>
  );
};
