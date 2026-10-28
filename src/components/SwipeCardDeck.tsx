import React, { useState } from 'react';
import { motion, useMotionValue, useTransform, animate, MotionValue } from 'motion/react';
import { GoogleContact, ContactGroup } from '../lib/contacts';
import { Stage } from '../lib/session';
import { Check, Edit3, Trash2, RotateCcw, Phone, Mail, Tag, Package, MessageCircle, StickyNote, Briefcase } from 'lucide-react';
import { whatsAppUrl } from '../lib/phone';

interface SwipeCardDeckProps {
  currentContact: GoogleContact;
  nextContact?: GoogleContact | null;
  currentIndex: number;
  totalCount: number;
  contactGroups: ContactGroup[];
  stage: Stage;
  onOk: () => void;
  onEdit: () => void;
  onBox: () => void;
  onDelete: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onWhatsAppOpen?: () => void;
}

// What right/down mean depends on the stage: in Unboxing the contact is already in the box
export const STAGE_LABELS: Record<Stage, { ok: string; box: string }> = {
  sorting: { ok: 'תקין', box: 'לקופסה' },
  unboxing: { ok: 'זיהיתי, הוצא', box: 'נשאר בקופסה' },
};

const FLY_DISTANCE = 600;
const FLY = { duration: 0.22, ease: 'easeOut' } as const;

export default function SwipeCardDeck({
  currentContact,
  nextContact,
  currentIndex,
  totalCount,
  contactGroups,
  stage,
  onOk,
  onEdit,
  onBox,
  onDelete,
  onUndo,
  canUndo = false,
  onWhatsAppOpen,
}: SwipeCardDeckProps) {
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const labels = STAGE_LABELS[stage];

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-250, 250], [-18, 18]);

  // Stamp opacities: right = OK, left = edit, down = box, up = delete
  const rightStampOpacity = useTransform(x, [30, 110], [0, 1]);
  const leftStampOpacity = useTransform(x, [-30, -110], [0, 1]);
  const downStampOpacity = useTransform(y, [40, 120], [0, 1]);
  const upStampOpacity = useTransform(y, [-40, -120], [0, 1]);

  // Scale of next card behind
  const nextCardScale = useTransform(x, [-200, 0, 200], [0.98, 0.94, 0.98]);
  const nextCardOpacity = useTransform(x, [-200, 0, 200], [0.9, 0.6, 0.9]);

  /** Animates the card off screen along one axis, then runs the action. */
  const flyOut = async (axis: MotionValue<number>, to: number, action: () => void, vibrateMs = 15) => {
    if (isAnimatingOut) return;
    setIsAnimatingOut(true);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(vibrateMs);
    await animate(axis, to, FLY);
    action();
    x.set(0);
    y.set(0);
    setIsAnimatingOut(false);
  };

  const triggerOk = () => flyOut(x, FLY_DISTANCE, onOk);
  const triggerEdit = () => flyOut(x, -FLY_DISTANCE, onEdit);
  const triggerBox = () => flyOut(y, FLY_DISTANCE, onBox, 20);
  const triggerDelete = () => flyOut(y, -FLY_DISTANCE, onDelete, 30);

  const handleDragEnd = (_: any, info: { offset: { x: number; y: number }; velocity: { x: number; y: number } }) => {
    if (isAnimatingOut) return;

    const { offset, velocity } = info;
    const isDominantY = Math.abs(offset.y) > Math.abs(offset.x) * 1.15;

    if (isDominantY && (offset.y < -90 || velocity.y < -400)) return triggerDelete();
    if (isDominantY && (offset.y > 90 || velocity.y > 400)) return triggerBox();
    if (offset.x > 85 || velocity.x > 350) return triggerOk();
    if (offset.x < -85 || velocity.x < -350) return triggerEdit();

    // Spring back to center
    animate(x, 0, { type: 'spring', stiffness: 350, damping: 25 });
    animate(y, 0, { type: 'spring', stiffness: 350, damping: 25 });
  };

  // User-created labels only; system groups like "My Contacts" say nothing about the person
  const getGroupNames = (contact: GoogleContact) => {
    const names = contact.memberships
      .map(m => contactGroups.find(cg => cg.resourceName === m && cg.groupType === 'USER_CONTACT_GROUP')?.formattedName)
      .filter(Boolean);
    return names.length > 0 ? names.join(', ') : 'ללא תווית';
  };

  const fullName = `${currentContact.firstName || ''} ${currentContact.lastName || ''}`.trim() || 'איש קשר ללא שם';
  const initial = currentContact.firstName?.[0] || currentContact.lastName?.[0] || '?';
  const whatsAppLink = currentContact.phone ? whatsAppUrl(currentContact.phone) : null;

  return (
    <div className="flex-1 flex flex-col justify-between items-center w-full max-w-sm mx-auto select-none">
      {/* Swipe Direction Quick Hint Bar */}
      <div className="w-full bg-slate-900/5 border border-slate-200/80 rounded-2xl py-2 px-2.5 mb-2.5 text-center">
        <div className="grid grid-cols-4 gap-1 text-[11px] font-semibold text-slate-700">
          <span className="flex items-center justify-center gap-0.5 text-emerald-700">
            <span>👉</span>
            <span>{labels.ok}</span>
          </span>
          <span className="flex items-center justify-center gap-0.5 text-blue-700">
            <span>👈</span>
            <span>לתקן</span>
          </span>
          <span className="flex items-center justify-center gap-0.5 text-amber-700">
            <span>👇</span>
            <span>{labels.box}</span>
          </span>
          <span className="flex items-center justify-center gap-0.5 text-rose-700">
            <span>☝️</span>
            <span>למחוק</span>
          </span>
        </div>
      </div>

      {/* Card Stack Deck Container */}
      <div className="relative w-full aspect-[4/5] min-h-[380px] max-h-[440px] flex items-center justify-center">
        {/* Next Card in Stack (Peeking behind) */}
        {nextContact && (
          <motion.div
            style={{
              scale: nextCardScale,
              opacity: nextCardOpacity,
              y: 12,
            }}
            className="absolute inset-0 bg-white rounded-3xl border border-slate-200 shadow-md p-6 flex flex-col items-center justify-center text-center pointer-events-none"
          >
            <div className="w-20 h-20 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center text-3xl font-bold mb-4">
              {nextContact.firstName?.[0] || nextContact.lastName?.[0] || '?'}
            </div>
            <h3 className="text-xl font-bold text-slate-600 mb-1">
              {`${nextContact.firstName || ''} ${nextContact.lastName || ''}`.trim() || 'איש קשר'}
            </h3>
            <p className="text-sm text-slate-400 font-mono" dir="ltr">
              {nextContact.phone || 'אין טלפון'}
            </p>
          </motion.div>
        )}

        {/* Active Top Swiping Card */}
        <motion.div
          key={currentContact.resourceName}
          drag={!isAnimatingOut}
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          dragElastic={0.85}
          onDragEnd={handleDragEnd}
          style={{
            x,
            y,
            rotate,
            touchAction: 'none',
          }}
          className="absolute inset-0 bg-white rounded-3xl border-2 border-slate-100 shadow-xl p-6 flex flex-col justify-between text-center cursor-grab active:cursor-grabbing overflow-hidden z-10"
        >
          {/* STAMP OVERLAYS */}
          {/* Up Swipe: DELETE */}
          <motion.div
            style={{ opacity: upStampOpacity }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-4 border-rose-500 bg-rose-50/95 text-rose-600 px-6 py-2 rounded-2xl font-black text-3xl tracking-wider shadow-2xl transform -rotate-6 pointer-events-none z-20 flex items-center gap-2"
          >
            <Trash2 className="w-8 h-8 stroke-[3]" />
            <span>למחוק!</span>
          </motion.div>

          {/* Right Swipe: OK */}
          <motion.div
            style={{ opacity: rightStampOpacity }}
            className="absolute top-6 right-6 border-4 border-emerald-500 bg-emerald-50/95 text-emerald-600 px-4 py-1.5 rounded-2xl font-black text-2xl tracking-wider shadow-lg transform rotate-12 pointer-events-none z-20 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Check className="w-6 h-6 stroke-[3]" />
            <span>{labels.ok}</span>
          </motion.div>

          {/* Left Swipe: EDIT */}
          <motion.div
            style={{ opacity: leftStampOpacity }}
            className="absolute top-6 left-6 border-4 border-blue-500 bg-blue-50/95 text-blue-600 px-4 py-1.5 rounded-2xl font-black text-2xl tracking-wider shadow-lg transform -rotate-12 pointer-events-none z-20 flex items-center gap-1.5"
          >
            <Edit3 className="w-6 h-6 stroke-[3]" />
            <span>לתקן</span>
          </motion.div>

          {/* Down Swipe: INTO THE BOX */}
          <motion.div
            style={{ opacity: downStampOpacity }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-4 border-amber-500 bg-amber-50/95 text-amber-700 px-5 py-2.5 rounded-2xl font-black text-2xl tracking-wider shadow-2xl transform rotate-3 pointer-events-none z-20 flex items-center gap-2 whitespace-nowrap"
          >
            <Package className="w-7 h-7 stroke-[2.5]" />
            <span>{labels.box}</span>
          </motion.div>

          {/* Top Card Header */}
          <div className="flex justify-between items-center w-full">
            <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
              {currentIndex + 1} מתוך {totalCount}
            </span>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              {stage === 'unboxing' ? <><Package className="w-3.5 h-3.5 text-amber-500" /><span>פותחים את הקופסה</span></> : <span>מיון</span>}
            </span>
          </div>

          {/* Main Contact Body */}
          <div className="flex-1 flex flex-col items-center justify-center py-2">
            <div className="w-24 h-24 bg-gradient-to-tr from-blue-600 to-indigo-500 text-white rounded-full flex items-center justify-center text-4xl font-black shadow-lg mb-4 ring-4 ring-blue-50">
              {initial}
            </div>

            <h3 className="text-2xl font-bold text-slate-800 mb-1 px-2 line-clamp-1">
              {fullName}
            </h3>
            {(currentContact.company || currentContact.jobTitle) && (
              <div className="flex items-center justify-center gap-1.5 text-sm text-slate-500 mb-2 px-2">
                <Briefcase className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="line-clamp-1">{[currentContact.jobTitle, currentContact.company].filter(Boolean).join(' · ')}</span>
              </div>
            )}

            <div className="space-y-1.5 w-full max-w-[260px]">
              {currentContact.phone ? (
                whatsAppLink ? (
                  <a
                    href={whatsAppLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    draggable={false}
                    // A drag that ends over the number must not open WhatsApp
                    onClick={e => {
                      if (Math.abs(x.get()) > 5 || Math.abs(y.get()) > 5) e.preventDefault();
                      else onWhatsAppOpen?.();
                    }}
                    title="פתח צ'אט בוואטסאפ כדי לזהות את איש הקשר"
                    className="flex items-center justify-center gap-2 text-slate-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 py-1.5 px-3 rounded-xl text-base font-mono font-medium transition"
                    dir="ltr"
                  >
                    <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="truncate">{currentContact.phone}</span>
                    <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  </a>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-slate-700 bg-slate-50 py-1.5 px-3 rounded-xl text-base font-mono font-medium" dir="ltr">
                    <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="truncate">{currentContact.phone}</span>
                  </div>
                )
              ) : (
                <div className="text-xs text-slate-400 italic">אין מספר טלפון</div>
              )}

              {currentContact.email && (
                <div className="flex items-center justify-center gap-2 text-slate-600 bg-slate-50 py-1.5 px-3 rounded-xl text-xs font-mono truncate" dir="ltr">
                  <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="truncate">{currentContact.email}</span>
                </div>
              )}

              {currentContact.note && (
                <div className="flex items-start justify-center gap-1.5 text-xs text-slate-600 bg-amber-50/60 py-1.5 px-3 rounded-xl">
                  <StickyNote className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span className="line-clamp-2 text-right">{currentContact.note}</span>
                </div>
              )}

              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 pt-1">
                <Tag className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="truncate">{getGroupNames(currentContact)}</span>
              </div>
            </div>
          </div>

          {/* Card Footer Cue */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
            <span>👈 לתקן</span>
            <span className="text-rose-400 font-medium">☝️ למחוק</span>
            <span className="text-amber-600 font-medium">👇 {labels.box}</span>
            <span>👉 {labels.ok}</span>
          </div>
        </motion.div>
      </div>

      {/* Bottom Floating Action Buttons */}
      <div className="flex items-center justify-center gap-3.5 w-full mt-4 pb-2">
        {canUndo && onUndo && (
          <button
            onClick={onUndo}
            title="בטל פעולה אחרונה"
            className="w-10 h-10 bg-white hover:bg-slate-50 active:scale-90 text-amber-600 rounded-full flex flex-col items-center justify-center shadow-md border border-slate-200 transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}

        <ActionButton onClick={triggerDelete} title="מחק איש קשר (החלקה למעלה)" label="מחק (למעלה)" color="rose" size="sm">
          <Trash2 className="w-5 h-5 stroke-[2.2]" />
        </ActionButton>
        <ActionButton onClick={triggerBox} title={`${labels.box} (החלקה למטה)`} label={`${labels.box} (למטה)`} color="amber" size="lg">
          <Package className="w-7 h-7 stroke-[2.2]" />
        </ActionButton>
        <ActionButton onClick={triggerEdit} title="ערוך פרטים (החלקה שמאלה)" label="תקן (שמאלה)" color="blue" size="sm">
          <Edit3 className="w-5 h-5 stroke-[2.2]" />
        </ActionButton>
        <ActionButton onClick={triggerOk} title={`${labels.ok} (החלקה ימינה)`} label={`${labels.ok} (ימינה)`} color="emerald" size="lg">
          <Check className="w-7 h-7 stroke-[3]" />
        </ActionButton>
      </div>
    </div>
  );
}

const BUTTON_COLORS = {
  rose: 'hover:bg-rose-50 text-rose-500 border-rose-200 hover:border-rose-400',
  amber: 'hover:bg-amber-50 text-amber-600 border-amber-200 hover:border-amber-400',
  blue: 'hover:bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400',
  emerald: 'hover:bg-emerald-50 text-emerald-600 border-emerald-200 hover:border-emerald-400',
};
const LABEL_COLORS = { rose: 'text-rose-600', amber: 'text-amber-700', blue: 'text-blue-600', emerald: 'text-emerald-600' };

function ActionButton({ onClick, title, label, color, size, children }: {
  onClick: () => void;
  title: string;
  label: string;
  color: keyof typeof BUTTON_COLORS;
  size: 'sm' | 'lg';
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        title={title}
        className={`${size === 'lg' ? 'w-14 h-14' : 'w-12 h-12'} bg-white active:scale-90 rounded-full flex items-center justify-center shadow-md border-2 transition ${BUTTON_COLORS[color]}`}
      >
        {children}
      </button>
      <span className={`text-[10px] font-semibold ${LABEL_COLORS[color]}`}>{label}</span>
    </div>
  );
}
