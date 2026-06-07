// SortableSection — wraps a Founder Dashboard row with HTML5 drag-and-drop
// so the user can reorder rows. Order is persisted in localStorage by the
// parent (Founder.tsx).
//
// UX:
//   - A small grip handle in the top-right corner of each row.
//     Faint by default, full opacity on row hover or while dragging.
//   - During a drag, the row being dragged dims to ~50% opacity.
//   - When dragging over a different row, a 2px accent line appears at the
//     top of that row to show the drop target.
//   - Drop reorders the row in the parent state.
//
// We intentionally use native HTML5 DnD (no library) — this is a desktop
// dashboard, touch isn't a target, and the surface area is small enough
// that adding a dep would be overkill.

import { useState } from 'preact/hooks';
import { GripVertical } from 'lucide-preact';

interface SortableSectionProps {
  id: string;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onReorder: (fromId: string, toId: string) => void;
  children: any;
}

export function SortableSection({ id, draggingId, setDraggingId, onReorder, children }: SortableSectionProps) {
  const [dragOver, setDragOver] = useState(false);
  const isDragging = draggingId === id;
  const isDropTarget = dragOver && draggingId != null && draggingId !== id;

  const handleDragStart = (e: any) => {
    setDraggingId(id);
    // Set drag effect + carry the id as text payload (browser plumbing)
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    } catch { /* some browsers throw on synthetic events */ }
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOver(false);
  };

  const handleDragOver = (e: any) => {
    // Required for drop to fire
    if (draggingId == null || draggingId === id) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch { /* see above */ }
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = (e: any) => {
    // Only clear when leaving the section entirely (not when entering a child)
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };

  const handleDrop = (e: any) => {
    e.preventDefault();
    setDragOver(false);
    const fromId = (() => {
      try { return e.dataTransfer.getData('text/plain') || draggingId; } catch { return draggingId; }
    })();
    if (fromId && fromId !== id) {
      onReorder(fromId, id);
    }
    setDraggingId(null);
  };

  return (
    <div
      class="group relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 120ms',
      }}
    >
      {/* Drop indicator line — only visible when this row is the drop target */}
      {isDropTarget && (
        <div
          class="absolute -top-2 left-0 right-0 h-0.5 rounded-full"
          style={{ background: 'var(--color-accent)' }}
        />
      )}

      {/* Drag handle — top-right corner, faint until hover */}
      <button
        type="button"
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        class="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-5 h-5 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
        title="Drag to reorder"
        aria-label="Drag to reorder section"
      >
        <GripVertical size={12} />
      </button>

      {children}
    </div>
  );
}
