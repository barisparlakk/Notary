import React, { useRef } from 'react';
import { UploadCloud } from 'lucide-react';

// Dosya seçme/bırakma alanı. Fareyle bırakmanın yanında klavyeyle de kullanılır: odaklanır, Enter ya da Space dosya seçiciyi açar.
export default function FileDrop({ id, onFile, title, subtitle, compact = false }) {
  const input = useRef(null);
  const open = () => input.current?.click();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={typeof title === 'string' ? `${title}. Press Enter to choose a file.` : 'Choose a file. Press Enter to open the file picker.'}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files[0]);
      }}
      className={`border-2 border-dashed border-gray-200 hover:border-gray-400 rounded-2xl ${compact ? 'p-6' : 'p-8'} text-center cursor-pointer transition-colors bg-gray-50/50 hover:bg-white`}
    >
      <input
        id={id}
        ref={input}
        type="file"
        className="hidden"
        tabIndex={-1}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <div className={`${compact ? 'w-10 h-10 mb-2' : 'w-12 h-12 mb-3'} rounded-full bg-white shadow-sm border border-gray-200 flex items-center justify-center mx-auto text-gray-700`}>
        <UploadCloud className={compact ? 'w-5 h-5' : 'w-6 h-6'} />
      </div>
      <div className="text-sm font-bold text-gray-900">{title}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1 font-mono">{subtitle}</div>}
    </div>
  );
}
