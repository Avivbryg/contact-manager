import React, { useState } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { GoogleContact, ContactGroup } from '../lib/contacts';
import { Check, Edit3, Trash2, RotateCcw, Phone, Mail, Tag, Smartphone, Save } from 'lucide-react';

interface SwipeCardDeckProps {
  currentContact: GoogleContact;
  nextContact?: GoogleContact | null;
  currentIndex: number;
  totalCount: number;
  contactGroups: ContactGroup[];
  onApprove: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSaveAndExit?: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
}

export default function SwipeCardDeck({
  currentContact,
  nextContact,
  currentIndex,
  totalCount,
  contactGroups,
  onApprove,
  onEdit,
  onDelete,
  onSaveAndExit,
  onUndo,
  canUndo = false,
}: SwipeCardDeckProps) {
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-250, 250], [-18, 18]);

  // Opacities for the swipe stamps:
  // Right = Valid/Approve ("תקין")
  // Left = Edit ("לתקן")
  // Down = Delete ("למחוק")
  // Up = Save and Exit ("שמור שינויים ויציאה")
  const rightStampOpacity = useTransform(x, [30, 110], [0, 1]);
  const leftStampOpacity = useTransform(x, [-30, -110], [0, 1]);
  const downStampOpacity = useTransform(y, [40, 120], [0, 1]);
  const upStampOpacity = useTransform(y, [-40, -120], [0, 1]);

  // Scale of next card behind
  const nextCardScale = useTransform(x, [-200, 0, 200], [0.98, 0.94, 0.98]);
  const nextCardOpacity = useTransform(x, [-200, 0, 200], [0.9, 0.6, 0.9]);

  const handleDragEnd = async (_: any, info: { offset: { x: number; y: number }; velocity: { x: number; y: number } }) => {
    if (isAnimatingOut) return;

    const { offset, velocity } = info;
    const isDominantY = Math.abs(offset.y) > Math.abs(offset.x) * 1.15;

    // Swipe Up -> Save and Exit (שמור שינויים שבוצעו ויציאה)
    if (isDominantY && (offset.y < -90 || velocity.y < -400)) {
      setIsAnimatingOut(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
      await animate(y, -600, { duration: 0.22, ease: 'easeOut' });
      if (onSaveAndExit) onSaveAndExit();
      y.set(0);
      x.set(0);
      setIsAnimatingOut(false);
      return;
    }

    // Swipe Down -> Delete
    if (isDominantY && (offset.y > 90 || velocity.y > 400)) {
      setIsAnimatingOut(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
      await animate(y, 600, { duration: 0.22, ease: 'easeOut' });
      onDelete();
      y.set(0);
      x.set(0);
      setIsAnimatingOut(false);
      return;
    }

    // Swipe Right -> Approve / Valid (תקין)
    if (offset.x > 85 || velocity.x > 350) {
      setIsAnimatingOut(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
      await animate(x, 600, { duration: 0.22, ease: 'easeOut' });
      onApprove();
      x.set(0);
      y.set(0);
      setIsAnimatingOut(false);
      return;
    }

    // Swipe Left -> Edit (לתקן)
    if (offset.x < -85 || velocity.x < -350) {
      setIsAnimatingOut(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
      await animate(x, -600, { duration: 0.22, ease: 'easeOut' });
      onEdit();
      x.set(0);
      y.set(0);
      setIsAnimatingOut(false);
      return;
    }

    // Spring back to center
    animate(x, 0, { type: 'spring', stiffness: 350, damping: 25 });
    animate(y, 0, { type: 'spring', stiffness: 350, damping: 25 });
  };

  const triggerApprove = async () => {
    if (isAnimatingOut) return;
    setIsAnimatingOut(true);
    await animate(x, 600, { duration: 0.22, ease: 'easeOut' });
    onApprove();
    x.set(0);
    y.set(0);
    setIsAnimatingOut(false);
  };

  const triggerEdit = async () => {
    if (isAnimatingOut) return;
    setIsAnimatingOut(true);
    await animate(x, -600, { duration: 0.22, ease: 'easeOut' });
    onEdit();
    x.set(0);
    y.set(0);
    setIsAnimatingOut(false);
  };

  const triggerDelete = async () => {
    if (isAnimatingOut) return;
    setIsAnimatingOut(true);
    await animate(y, 600, { duration: 0.22, ease: 'easeOut' });
    onDelete();
    y.set(0);
    x.set(0);
    setIsAnimatingOut(false);
  };

  const triggerSaveAndExit = async () => {
    if (isAnimatingOut || !onSaveAndExit) return;
    setIsAnimatingOut(true);
    await animate(y, -600, { duration: 0.22, ease: 'easeOut' });
    onSaveAndExit();
    y.set(0);
    x.set(0);
    setIsAnimatingOut(false);
  };

  // Get current contact's user-visible group names
  const getGroupNames = (contact: GoogleContact) => {
    const userGroups = contact.memberships?.map(m => {
      const g = contactGroups.find(cg => cg.resourceName === m);
      return g ? g.formattedName : null;
    }).filter(Boolean) as string[] || [];
    return userGroups.length > 0 ? userGroups.join(', ') : 'ללא שיוך';
  };

  const fullName = `${currentContact.firstName || ''} ${currentContact.lastName || ''}`.trim() || 'איש קשר ללא שם';
  const initial = currentContact.firstName?.[0] || currentContact.lastName?.[0] || '?';

  return (
    <div className="flex-1 flex flex-col justify-between items-center w-full max-w-sm mx-auto select-none">
      {/* Swipe Direction Quick Hint Bar */}
      <div className="w-full bg-slate-900/5 border border-slate-200/80 rounded-2xl py-2 px-2.5 mb-2.5 text-center">
        <div className="grid grid-cols-4 gap-1 text-[11px] font-semibold text-slate-700">
          <span className="flex items-center justify-center gap-0.5 text-indigo-700">
            <span>☝️</span>
            <span>שמור וצא</span>
          </span>
          <span className="flex items-center justify-center gap-0.5 text-emerald-700">
            <span>👉</span>
            <span>תקין</span>
          </span>
          <span className="flex items-center justify-center gap-0.5 text-blue-700">
            <span>👈</span>
            <span>לתקן</span>
          </span>
          <span className="flex items-center justify-center gap-0.5 text-rose-700">
            <span>👇</span>
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
          {/* Up Swipe: SAVE & EXIT (שמור שינויים ויציאה) */}
          <motion.div
            style={{ opacity: upStampOpacity }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-4 border-indigo-500 bg-indigo-50/95 text-indigo-700 px-5 py-2.5 rounded-2xl font-black text-2xl tracking-wider shadow-2xl transform rotate-3 pointer-events-none z-20 flex items-center gap-2 whitespace-nowrap"
          >
            <Save className="w-7 h-7 stroke-[2.5]" />
            <span>שמור ויציאה!</span>
          </motion.div>

          {/* Right Swipe: VALID / APPROVED (תקין) */}
          <motion.div
            style={{ opacity: rightStampOpacity }}
            className="absolute top-6 right-6 border-4 border-emerald-500 bg-emerald-50/95 text-emerald-600 px-4 py-1.5 rounded-2xl font-black text-2xl tracking-wider shadow-lg transform rotate-12 pointer-events-none z-20 flex items-center gap-1.5"
          >
            <Check className="w-6 h-6 stroke-[3]" />
            <span>תקין!</span>
          </motion.div>

          {/* Left Swipe: EDIT / FIX (לתקן) */}
          <motion.div
            style={{ opacity: leftStampOpacity }}
            className="absolute top-6 left-6 border-4 border-blue-500 bg-blue-50/95 text-blue-600 px-4 py-1.5 rounded-2xl font-black text-2xl tracking-wider shadow-lg transform -rotate-12 pointer-events-none z-20 flex items-center gap-1.5"
          >
            <Edit3 className="w-6 h-6 stroke-[3]" />
            <span>לתקן</span>
          </motion.div>

          {/* Down Swipe: DELETE (למחוק) */}
          <motion.div
            style={{ opacity: downStampOpacity }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-4 border-rose-500 bg-rose-50/95 text-rose-600 px-6 py-2 rounded-2xl font-black text-3xl tracking-wider shadow-2xl transform -rotate-6 pointer-events-none z-20 flex items-center gap-2"
          >
            <Trash2 className="w-8 h-8 stroke-[3]" />
            <span>למחוק!</span>
          </motion.div>

          {/* Top Card Header */}
          <div className="flex justify-between items-center w-full">
            <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
              {currentIndex + 1} מתוך {totalCount}
            </span>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Smartphone className="w-3.5 h-3.5 text-blue-500" />
              <span>החלק כרטיסייה</span>
            </span>
          </div>

          {/* Main Contact Body */}
          <div className="flex-1 flex flex-col items-center justify-center py-2">
            <div className="w-24 h-24 bg-gradient-to-tr from-blue-600 to-indigo-500 text-white rounded-full flex items-center justify-center text-4xl font-black shadow-lg mb-4 ring-4 ring-blue-50">
              {initial}
            </div>

            <h3 className="text-2xl font-bold text-slate-800 mb-2 px-2 line-clamp-1">
              {fullName}
            </h3>

            <div className="space-y-1.5 w-full max-w-[260px]">
              {currentContact.phone ? (
                <div className="flex items-center justify-center gap-2 text-slate-700 bg-slate-50 py-1.5 px-3 rounded-xl text-base font-mono font-medium" dir="ltr">
                  <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="truncate">{currentContact.phone}</span>
                </div>
              ) : (
                <div className="text-xs text-slate-400 italic">אין מספר טלפון</div>
              )}

              {currentContact.email && (
                <div className="flex items-center justify-center gap-2 text-slate-600 bg-slate-50 py-1.5 px-3 rounded-xl text-xs font-mono truncate" dir="ltr">
                  <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="truncate">{currentContact.email}</span>
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
            <span>👈 שמאלה: לתקן</span>
            <span className="text-indigo-600 font-medium">☝️ למעלה: שמור וצא</span>
            <span className="text-rose-400 font-medium">👇 למטה: למחוק</span>
            <span>👉 ימינה: תקין</span>
          </div>
        </motion.div>
      </div>

      {/* Tinder-Style Bottom Floating Action Buttons */}
      <div className="flex items-center justify-center gap-3.5 w-full mt-4 pb-2">
        {/* Undo button */}
        {canUndo && onUndo && (
          <button
            onClick={onUndo}
            title="בטל פעולה אחרונה"
            className="w-10 h-10 bg-white hover:bg-slate-50 active:scale-90 text-amber-600 rounded-full flex flex-col items-center justify-center shadow-md border border-slate-200 transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}

        {/* Delete (Down swipe) */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={triggerDelete}
            title="מחק איש קשר (החלקה למטה)"
            className="w-14 h-14 bg-white hover:bg-rose-50 active:scale-90 text-rose-500 rounded-full flex items-center justify-center shadow-md border-2 border-rose-200 transition hover:border-rose-400"
          >
            <Trash2 className="w-7 h-7 stroke-[2.2]" />
          </button>
          <span className="text-[10px] font-semibold text-rose-600">מחק (למטה)</span>
        </div>

        {/* Save and Exit (Up swipe) */}
        {onSaveAndExit && (
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={triggerSaveAndExit}
              title="שמור שינויים ויציאה (החלקה למעלה)"
              className="w-12 h-12 bg-white hover:bg-indigo-50 active:scale-90 text-indigo-600 rounded-full flex items-center justify-center shadow-md border-2 border-indigo-200 transition hover:border-indigo-400"
            >
              <Save className="w-5 h-5 stroke-[2.2]" />
            </button>
            <span className="text-[10px] font-semibold text-indigo-600">שמור וצא (למעלה)</span>
          </div>
        )}

        {/* Edit (Left swipe) */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={triggerEdit}
            title="ערוך פרטים (החלקה שמאלה)"
            className="w-12 h-12 bg-white hover:bg-blue-50 active:scale-90 text-blue-600 rounded-full flex items-center justify-center shadow-md border-2 border-blue-200 transition hover:border-blue-400"
          >
            <Edit3 className="w-5 h-5 stroke-[2.2]" />
          </button>
          <span className="text-[10px] font-semibold text-blue-600">תקן (שמאלה)</span>
        </div>

        {/* Approve / Valid (Right swipe) */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={triggerApprove}
            title="איש קשר תקין (החלקה ימינה)"
            className="w-14 h-14 bg-white hover:bg-emerald-50 active:scale-90 text-emerald-600 rounded-full flex items-center justify-center shadow-md border-2 border-emerald-200 transition hover:border-emerald-400"
          >
            <Check className="w-7 h-7 stroke-[3]" />
          </button>
          <span className="text-[10px] font-semibold text-emerald-600">תקין (ימינה)</span>
        </div>
      </div>
    </div>
  );
}

