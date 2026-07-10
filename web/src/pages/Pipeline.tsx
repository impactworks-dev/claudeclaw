import { useState } from 'preact/hooks';
import {
  RefreshCw, ExternalLink, Users, Building2, Target, Wallet,
  TrendingUp, Trophy, Pencil, X, Calendar, Receipt, CheckCircle,
  AlertCircle, Plus, ChevronRight, ChevronLeft, Trash2, BookOpen,
  Star, Clock, DollarSign,
} from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPost } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DealCard {
  id: string; name: string; accountName: string | null; accountGroupId: string | null;
  value: number; weighted: number; probability: number | null; expectedCloseDate: string | null;
  stage: string; subStage: string; brand: string; source: string | null; isLocal: boolean;
  contactName?: string | null; contactEmail?: string | null; notes?: string | null;
}
interface AccountCard {
  id: string; accountGroupId: string | null; name: string; website: string | null;
  reviewScore: number | null; reviewCount: number | null; websiteGrade: string | null;
  listingsAccuracy: number | null; notes: string | null; outreachStatus: string;
  retailMRR: number | null; wholesaleMonthly: number | null; wholesaleLifetime: number | null; margin: number | null;
}
interface StageTotal { count: number; value: number; weighted: number; }
interface PipelineData {
  generatedAt: number;
  deals: { lead: DealCard[]; contact: DealCard[]; qualified: DealCard[]; proposal: DealCard[]; won: DealCard[]; lost: DealCard[] };
  dealTotals: { lead: StageTotal; contact: StageTotal; qualified: StageTotal; proposal: StageTotal; won: StageTotal; lost: StageTotal; openTotal: StageTotal };
  customers: AccountCard[];
  revenue: { ready: boolean; currency: string; totalRetailMRR: number | null; totalWholesaleMonthly: number | null; asOf: number | null };
  outreachStatuses: string[];
  subStages: string[];
  brands: string[];
  sources: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TONE: Record<string, string> = { good: '#16a34a', warn: '#ca8a04', bad: '#dc2626', faint: 'var(--color-text-faint)' };
type SubStageTuple = 'Lead' | 'Contact' | 'Qualified' | 'Proposal';
const NEXT_STAGE: Record<string, SubStageTuple | null> = {
  Lead: 'Contact', Contact: 'Qualified', Qualified: 'Proposal', Proposal: null,
};
const PREV_STAGE: Record<string, SubStageTuple | null> = {
  Lead: null, Contact: 'Lead', Qualified: 'Contact', Proposal: 'Qualified',
};

const COL_META: Record<string, { color: string; icon: any; desc: string }> = {
  Lead:     { color: '#6366f1', icon: Target,     desc: 'New prospect — entry point' },
  Contact:  { color: '#f59e0b', icon: Users,       desc: 'Discovery call booked or held' },
  Qualified:{ color: '#8b5cf6', icon: Star,        desc: 'ICP fit + BANT confirmed' },
  Proposal: { color: '#0ea5e9', icon: DollarSign,  desc: 'Proposal sent / in negotiation' },
  Won:      { color: '#16a34a', icon: Trophy,      desc: 'Closed won — ring the bell' },
  Lost:     { color: '#dc2626', icon: X,           desc: 'Closed lost — document the lesson' },
};

const BRAND_META: Record<string, { emoji: string; short: string; color: string; bg: string }> = {
  'Rocket Local': { emoji: '🚀', short: 'RL',  color: '#10b981', bg: 'rgba(16,185,129,.12)' },
  'ImpactWorks':  { emoji: '⚡', short: 'IW',  color: '#818cf8', bg: 'rgba(99,102,241,.15)' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const gradeTone = (g: string | null) => !g ? 'faint' : (['A','B'].includes(g.trim().toUpperCase()[0]) ? 'good' : g.trim().toUpperCase()[0] === 'C' ? 'warn' : 'bad');
const pctTone = (p: number | null) => p == null ? 'faint' : p >= 0.8 ? 'good' : p >= 0.5 ? 'warn' : 'bad';
const reviewTone = (s: number | null) => s == null ? 'faint' : s >= 4.3 ? 'good' : s >= 3.5 ? 'warn' : 'bad';
const probTone = (p: number | null) => p == null ? 'faint' : p >= 0.6 ? 'good' : p >= 0.3 ? 'warn' : 'bad';
const fmtPct = (p: number | null) => p == null ? '—' : Math.round(p * 100) + '%';
const fmtReview = (s: number | null, n: number | null) => s == null ? 'no reviews' : `${s.toFixed(1)} (${n || 0})`;
const money = (cents: number | null) => cents == null ? '—' : '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => {
  if (!d) return null;
  const t = new Date(d); if (isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};
const inpCls = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text)]';

// ─── Small components ─────────────────────────────────────────────────────────

function BrandTag({ brand }: { brand: string }) {
  const m = BRAND_META[brand] || { emoji: '●', short: brand.slice(0,2), color: 'var(--color-text-faint)', bg: 'var(--color-elevated)' };
  return (
    <span class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold shrink-0"
      style={{ color: m.color, background: m.bg }}>
      {m.emoji} {m.short}
    </span>
  );
}

function SourceTag({ source }: { source: string | null }) {
  if (!source) return null;
  return (
    <span class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
      style={{ color: '#0ea5e9', background: 'rgba(14,165,233,.1)' }}>
      {source}
    </span>
  );
}

function LocalBadge() {
  return (
    <span class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
      style={{ color: '#f59e0b', background: 'rgba(245,158,11,.1)' }}>
      local
    </span>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-elevated)]" style={{ color: TONE[tone] }}>
      <span class="text-[var(--color-text-faint)] font-normal">{label}</span>{value}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  'not contacted': 'faint', emailed: 'warn', opened: 'warn', replied: 'good',
  'webinar booked': 'good', 'webinar held': 'good', endorsed: 'good', declined: 'bad',
  called: 'warn', 'follow-up': 'warn', 'meeting set': 'good',
};
function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[(status || '').toLowerCase()] ?? 'faint';
  return <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
    style={{ color: TONE[tone], background: `color-mix(in srgb, ${TONE[tone]} 14%, transparent)` }}>{status}</span>;
}

function StatCard({ icon, label, value, sub, accent }: { icon: any; label: string; value: string | number; sub?: string; accent?: string }) {
  const Icon = icon;
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 flex items-center gap-3">
      <div class="rounded-lg p-2" style={{ background: 'var(--color-accent-soft)', color: accent || 'var(--color-accent)' }}><Icon size={16} /></div>
      <div>
        <div class="text-[20px] font-bold text-[var(--color-text)] tabular-nums leading-none">{value}</div>
        <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{label}{sub && <span class="text-[var(--color-text-faint)]"> · {sub}</span>}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <label class="block"><span class="text-[11px] text-[var(--color-text-muted)] mb-1 block">{label}</span>{children}</label>;
}

// ─── Deal card (pipeline board) ───────────────────────────────────────────────

function DealCardView({ d, colName, onStageChange, onEdit }: {
  d: DealCard; colName: string;
  onStageChange: (id: string, subStage: string) => void;
  onEdit?: (d: DealCard) => void;
}) {
  const isOpen = colName !== 'Won' && colName !== 'Lost';
  const next = isOpen ? NEXT_STAGE[colName] : null;
  const prev = isOpen ? PREV_STAGE[colName] : null;

  return (
    <div class="group rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 hover:border-[var(--color-border-strong)] transition-colors">
      <div class="flex items-start justify-between gap-1 mb-1.5">
        <div class="flex flex-wrap items-center gap-1 min-w-0">
          <BrandTag brand={d.brand} />
          {d.source && <SourceTag source={d.source} />}
          {d.isLocal && <LocalBadge />}
        </div>
        {onEdit && (
          <button type="button" onClick={() => onEdit(d)} class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 rounded p-0.5 text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <Pencil size={11} />
          </button>
        )}
      </div>

      <div class="text-[13px] font-semibold text-[var(--color-text)] leading-snug">{d.name}</div>
      {d.accountName && (
        <div class="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] truncate">
          <Building2 size={11} class="text-[var(--color-text-faint)] shrink-0" />{d.accountName}
        </div>
      )}

      {d.value > 0 && (
        <div class="mt-1.5 flex items-baseline gap-2">
          <span class="text-[14px] font-bold text-[var(--color-text)] tabular-nums">{money(d.value)}</span>
          {d.weighted > 0 && d.weighted !== d.value && (
            <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums">{money(d.weighted)} wtd</span>
          )}
        </div>
      )}

      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
        {d.probability != null && (
          <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-elevated)]" style={{ color: TONE[probTone(d.probability)] }}>
            <span class="text-[var(--color-text-faint)] font-normal">P</span>{fmtPct(d.probability)}
          </span>
        )}
        {fmtDate(d.expectedCloseDate) && (
          <span class="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-faint)]">
            <Calendar size={10} />{fmtDate(d.expectedCloseDate)}
          </span>
        )}
      </div>

      {d.notes && <div class="mt-1.5 text-[10px] text-[var(--color-text-muted)] italic border-l-2 border-[var(--color-border-strong)] pl-1.5 leading-snug">{d.notes}</div>}

      {/* Stage advance / rewind buttons */}
      {isOpen && (prev || next) && (
        <div class="mt-2 pt-2 border-t border-[var(--color-border)] flex items-center justify-between gap-1">
          <button type="button"
            onClick={() => prev && onStageChange(d.id, prev)}
            disabled={!prev}
            class="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded disabled:opacity-25 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors">
            <ChevronLeft size={10} />{prev}
          </button>
          <button type="button"
            onClick={() => next && onStageChange(d.id, next)}
            disabled={!next}
            class="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded disabled:opacity-25 text-[var(--color-accent)] font-medium hover:bg-[var(--color-accent-soft)] transition-colors">
            {next}<ChevronRight size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Board column ─────────────────────────────────────────────────────────────

function Column({ name, count, total, children }: { name: string; count: number; total?: number | null; children: any }) {
  const m = COL_META[name];
  const Icon = m?.icon || Target;
  return (
    <div class="flex flex-col min-w-[285px] w-[295px] shrink-0">
      <div class="flex items-center gap-2 px-1 pb-2 mb-1 border-b border-[var(--color-border)]">
        <span class="rounded-md p-1" style={{ background: `color-mix(in srgb, ${m?.color || 'var(--color-accent)'} 14%, transparent)`, color: m?.color || 'var(--color-accent)' }}>
          <Icon size={13} />
        </span>
        <span class="text-[12px] font-semibold text-[var(--color-text)]">{name}</span>
        <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--color-elevated)] text-[var(--color-text-muted)] tabular-nums">{count}</span>
        {total != null && total > 0 && <span class="ml-auto text-[11px] font-medium text-[var(--color-text-muted)] tabular-nums">{money(total)}</span>}
      </div>
      <div class="flex flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        {count === 0 && (
          <div class="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-center text-[11px] text-[var(--color-text-faint)]">
            {m?.desc || 'No records'}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ─── New Lead modal ───────────────────────────────────────────────────────────

function NewLeadModal({ brands, sources, onClose, onCreated }: {
  brands: string[]; sources: string[];
  onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [brand, setBrand] = useState(brands[0] || 'Rocket Local');
  const [source, setSource] = useState('BID');
  const [contactName, setContactName] = useState('');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setErr('Deal name is required'); return; }
    setSaving(true); setErr(null);
    try {
      await apiPost('/api/pipeline/lead', {
        name: name.trim(),
        accountName: accountName.trim() || name.trim(),
        brand,
        subStage: 'Lead',
        source: source || null,
        contactName: contactName.trim() || null,
        value: value ? Math.round(parseFloat(value) * 100) : 0,
        notes: notes.trim() || null,
      });
      onCreated();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setSaving(false);
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div class="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-[14px] font-semibold text-[var(--color-text)]">Add New Lead</h2>
            <p class="text-[11px] text-[var(--color-text-faint)] mt-0.5">Starts in the Lead column — advance when contact is made</p>
          </div>
          <button type="button" onClick={onClose} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <Field label="Brand *">
              <select value={brand} onChange={(e: any) => setBrand(e.currentTarget.value)} class={inpCls}>
                {brands.map((b) => <option key={b} value={b}>{BRAND_META[b]?.emoji || ''} {b}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select value={source} onChange={(e: any) => setSource(e.currentTarget.value)} class={inpCls}>
                <option value="">— none —</option>
                {sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Deal name *">
            <input value={name} placeholder="e.g. ABC Roofing – Local SEO" onInput={(e: any) => setName(e.currentTarget.value)} class={inpCls} />
          </Field>
          <Field label="Company name">
            <input value={accountName} placeholder="Leave blank to use deal name" onInput={(e: any) => setAccountName(e.currentTarget.value)} class={inpCls} />
          </Field>
          <div class="grid grid-cols-2 gap-3">
            <Field label="Contact name">
              <input value={contactName} placeholder="First Last" onInput={(e: any) => setContactName(e.currentTarget.value)} class={inpCls} />
            </Field>
            <Field label="Est. value ($)">
              <input type="number" step="100" value={value} placeholder="0" onInput={(e: any) => setValue(e.currentTarget.value)} class={inpCls} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={notes} placeholder="Problem / context / next step" onInput={(e: any) => setNotes(e.currentTarget.value)} rows={2} class={inpCls} />
          </Field>
          {err && <div class="text-[11px] text-[var(--color-status-failed)]">{err}</div>}
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} class="rounded-md px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]">Cancel</button>
          <button type="button" disabled={saving} onClick={save}
            class="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
            {saving ? 'Adding…' : 'Add Lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit lead / stage modal ──────────────────────────────────────────────────

function EditDealModal({ deal, brands, sources, subStages, onClose, onSaved }: {
  deal: DealCard; brands: string[]; sources: string[]; subStages: string[];
  onClose: () => void; onSaved: () => void;
}) {
  const [subStage, setSubStage] = useState(deal.subStage);
  const [brand, setBrand] = useState(deal.brand);
  const [source, setSource] = useState(deal.source || '');
  const [name, setName] = useState(deal.name);
  const [accountName, setAccountName] = useState(deal.accountName || '');
  const [contactName, setContactName] = useState(deal.contactName || '');
  const [value, setValue] = useState(deal.value > 0 ? String(deal.value / 100) : '');
  const [notes, setNotes] = useState(deal.notes || '');
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      if (deal.isLocal) {
        await fetch(`/api/pipeline/lead/${deal.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(), accountName: accountName.trim() || name.trim(),
            brand, subStage, source: source || null,
            contactName: contactName.trim() || null,
            value: value ? Math.round(parseFloat(value) * 100) : 0,
            notes: notes.trim() || null,
          }),
        });
      } else {
        await apiPost('/api/pipeline/stage', { id: deal.id, subStage, brand, source: source || null });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deal.isLocal) return;
    setDeleting(true);
    try {
      await fetch(`/api/pipeline/lead/${deal.id}`, { method: 'DELETE' });
      onSaved();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setDeleting(false);
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div class="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-[14px] font-semibold text-[var(--color-text)] truncate max-w-[300px]">{deal.name}</h2>
            <p class="text-[11px] text-[var(--color-text-faint)]">{deal.isLocal ? 'Local lead (not yet in Vendasta)' : 'Vendasta opportunity'}</p>
          </div>
          <button type="button" onClick={onClose} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>
        <div class="space-y-3">
          <div class="grid grid-cols-3 gap-2">
            <Field label="Stage">
              <select value={subStage} onChange={(e: any) => setSubStage(e.currentTarget.value)} class={inpCls}>
                {subStages.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Brand">
              <select value={brand} onChange={(e: any) => setBrand(e.currentTarget.value)} class={inpCls}>
                {brands.map((b) => <option key={b} value={b}>{BRAND_META[b]?.emoji || ''} {b}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select value={source} onChange={(e: any) => setSource(e.currentTarget.value)} class={inpCls}>
                <option value="">—</option>
                {sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          {deal.isLocal && (
            <>
              <Field label="Deal name">
                <input value={name} onInput={(e: any) => setName(e.currentTarget.value)} class={inpCls} />
              </Field>
              <Field label="Company name">
                <input value={accountName} onInput={(e: any) => setAccountName(e.currentTarget.value)} class={inpCls} />
              </Field>
              <div class="grid grid-cols-2 gap-2">
                <Field label="Contact">
                  <input value={contactName} placeholder="Name" onInput={(e: any) => setContactName(e.currentTarget.value)} class={inpCls} />
                </Field>
                <Field label="Est. value ($)">
                  <input type="number" step="100" value={value} onInput={(e: any) => setValue(e.currentTarget.value)} class={inpCls} />
                </Field>
              </div>
              <Field label="Notes">
                <textarea value={notes} rows={2} onInput={(e: any) => setNotes(e.currentTarget.value)} class={inpCls} />
              </Field>
            </>
          )}
          {err && <div class="text-[11px] text-[var(--color-status-failed)]">{err}</div>}
        </div>
        <div class="mt-4 flex items-center justify-between">
          {deal.isLocal ? (
            <button type="button" onClick={doDelete} disabled={deleting}
              class="flex items-center gap-1 text-[11px] text-[var(--color-status-failed)] hover:opacity-80 disabled:opacity-50">
              <Trash2 size={12} />{deleting ? 'Deleting…' : 'Delete lead'}
            </button>
          ) : <div />}
          <div class="flex gap-2">
            <button type="button" onClick={onClose} class="rounded-md px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]">Cancel</button>
            <button type="button" disabled={saving} onClick={save}
              class="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Customer card ────────────────────────────────────────────────────────────

function RevenueRow({ c }: { c: AccountCard }) {
  if (c.retailMRR == null) return null;
  const mtone = c.margin == null ? 'faint' : c.margin > 0 ? 'good' : c.margin < 0 ? 'bad' : 'faint';
  return (
    <div class="mt-2 pt-2 border-t border-[var(--color-border)] flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <span class="font-semibold text-[var(--color-text)]">{money(c.retailMRR)}<span class="text-[var(--color-text-faint)] font-normal">/mo</span></span>
      <span class="text-[var(--color-text-faint)]">cost {money(c.wholesaleMonthly)}</span>
      <span class="font-medium" style={{ color: TONE[mtone] }}>{money(c.margin)} margin</span>
      <span class="text-[var(--color-text-faint)] ml-auto">LTV {money(c.wholesaleLifetime)}</span>
    </div>
  );
}

function CustomerCardView({ c, onEdit }: { c: AccountCard; onEdit: (c: AccountCard) => void }) {
  return (
    <div class="group rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 hover:border-[var(--color-border-strong)] transition-colors">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[13px] font-semibold text-[var(--color-text)] truncate">{c.name}</div>
          {c.website && (
            <a href={c.website} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] truncate max-w-[180px]">
              {c.website.replace(/^https?:\/\//, '')}<ExternalLink size={10} />
            </a>
          )}
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <StatusPill status={c.outreachStatus} />
          <button type="button" onClick={() => onEdit(c)} title="Edit" class="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]">
            <Pencil size={12} />
          </button>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        <Chip label="WEB" value={c.websiteGrade || '—'} tone={gradeTone(c.websiteGrade)} />
        <Chip label="LIST" value={fmtPct(c.listingsAccuracy)} tone={pctTone(c.listingsAccuracy)} />
        <Chip label="★" value={fmtReview(c.reviewScore, c.reviewCount)} tone={reviewTone(c.reviewScore)} />
      </div>
      <RevenueRow c={c} />
      {c.notes && <div class="mt-2 text-[11px] text-[var(--color-text-muted)] italic border-l-2 border-[var(--color-border-strong)] pl-2">{c.notes}</div>}
    </div>
  );
}

// ─── Customer edit modal ──────────────────────────────────────────────────────

function EditAccountModal({ card, statuses, onClose, onSaved }: { card: AccountCard; statuses: string[]; onClose: () => void; onSaved: () => void }) {
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState(card.outreachStatus);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [notes, setNotes] = useState(card.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setErr(null);
    const payload: any = { companyId: card.id, companyName: card.name, notes };
    if (stage) payload.stage = stage;
    if (status !== card.outreachStatus) payload.outreachStatus = status;
    if (contactName.trim()) payload.contactName = contactName.trim();
    if (contactEmail.trim()) payload.contactEmail = contactEmail.trim();
    try { await apiPost('/api/pipeline/card', payload); onSaved(); }
    catch (e: any) { setErr(e?.message || String(e)); setSaving(false); }
  };
  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div class="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[14px] font-semibold text-[var(--color-text)] truncate">Edit · {card.name}</h2>
          <button type="button" onClick={onClose} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>
        <div class="space-y-3">
          <Field label="Outreach status">
            <select value={status} onChange={(e: any) => setStatus(e.currentTarget.value)} class={inpCls}>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Lifecycle stage (Vendasta)">
            <select value={stage} onChange={(e: any) => setStage(e.currentTarget.value)} class={inpCls}>
              <option value="">(unchanged)</option>
              <option>Lead</option><option>Prospect</option><option>Customer</option>
            </select>
          </Field>
          <Field label="Contact name"><input value={contactName} placeholder="add / update primary contact" onInput={(e: any) => setContactName(e.currentTarget.value)} class={inpCls} /></Field>
          <Field label="Contact email"><input value={contactEmail} placeholder="contact@company.com" onInput={(e: any) => setContactEmail(e.currentTarget.value)} class={inpCls} /></Field>
          <Field label="Notes (internal)"><textarea value={notes} onInput={(e: any) => setNotes(e.currentTarget.value)} rows={3} class={inpCls} /></Field>
          {err && <div class="text-[11px] text-[var(--color-status-failed)]">{err}</div>}
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} class="rounded-md px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]">Cancel</button>
          <button type="button" disabled={saving} onClick={save} class="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Accounts table ───────────────────────────────────────────────────────────

function Accounts({ rows, onEdit }: { rows: AccountCard[]; onEdit: (c: AccountCard) => void }) {
  const sorted = [...rows].sort((a, b) => (b.retailMRR || 0) - (a.retailMRR || 0));
  return (
    <div class="rounded-xl border border-[var(--color-border)] overflow-hidden">
      <table class="w-full text-[12px]">
        <thead>
          <tr class="bg-[var(--color-elevated)] text-[var(--color-text-muted)] text-left">
            <th class="px-4 py-2 font-medium">Account</th>
            <th class="px-4 py-2 font-medium">Status</th>
            <th class="px-4 py-2 font-medium text-right">MRR</th>
            <th class="px-4 py-2 font-medium text-right">Cost/mo</th>
            <th class="px-4 py-2 font-medium text-right">Margin/mo</th>
            <th class="px-4 py-2 font-medium text-right">Lifetime cost</th>
            <th class="px-4 py-2 font-medium">Reviews</th>
            <th class="px-4 py-2 font-medium">Web</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const mtone = r.margin == null ? 'faint' : r.margin > 0 ? 'good' : r.margin < 0 ? 'bad' : 'faint';
            return (
              <tr key={r.id} class="group border-t border-[var(--color-border)] hover:bg-[var(--color-card)]">
                <td class="px-4 py-2 text-[var(--color-text)] font-medium">{r.name}
                  {r.website && <a href={r.website} target="_blank" rel="noreferrer" class="ml-1 text-[var(--color-text-faint)] hover:text-[var(--color-accent)]"><ExternalLink size={10} class="inline" /></a>}</td>
                <td class="px-4 py-2"><StatusPill status={r.outreachStatus} /></td>
                <td class="px-4 py-2 text-right tabular-nums font-semibold text-[var(--color-text)]">{money(r.retailMRR)}</td>
                <td class="px-4 py-2 text-right tabular-nums text-[var(--color-text-muted)]">{money(r.wholesaleMonthly)}</td>
                <td class="px-4 py-2 text-right tabular-nums font-medium" style={{ color: TONE[mtone] }}>{money(r.margin)}</td>
                <td class="px-4 py-2 text-right tabular-nums text-[var(--color-text-muted)]">{money(r.wholesaleLifetime)}</td>
                <td class="px-4 py-2 tabular-nums" style={{ color: TONE[reviewTone(r.reviewScore)] }}>{fmtReview(r.reviewScore, r.reviewCount)}</td>
                <td class="px-4 py-2 font-medium" style={{ color: TONE[gradeTone(r.websiteGrade)] }}>{r.websiteGrade || '—'}</td>
                <td class="px-2 py-2"><button type="button" onClick={() => onEdit(r)} class="opacity-0 group-hover:opacity-100 rounded p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><Pencil size={12} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

interface PayoutRecord {
  payout_id: string; payout_date: string; client_name: string;
  gross_amount: number; processing_fee: number; net_amount: number;
  entity: 'ImpactWorks' | 'Rocket Local'; recorded_at?: string;
}
const fmtDollars = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function EntityBadge({ entity }: { entity: string }) {
  const isIW = entity === 'ImpactWorks';
  return (
    <span class="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: isIW ? '#818cf8' : '#10b981', background: isIW ? 'rgba(99,102,241,.15)' : 'rgba(16,185,129,.12)' }}>
      {entity}
    </span>
  );
}
function PayoutsView() {
  const { data: rows, loading, error, refresh } = useFetch<PayoutRecord[]>('/api/payouts', 0);
  const [formId, setFormId] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formClient, setFormClient] = useState('');
  const [formEntity, setFormEntity] = useState<'Rocket Local' | 'ImpactWorks'>('Rocket Local');
  const [formGross, setFormGross] = useState('');
  const [formFee, setFormFee] = useState('');
  const [formNet, setFormNet] = useState('');
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const calcNet = (gross: string, fee: string) => { const g = parseFloat(gross) || 0; const f = parseFloat(fee) || 0; if (g) setFormNet((g - f).toFixed(2)); };
  const submit = async () => {
    if (!formId.trim()) { setPostMsg({ ok: false, text: 'Payout ID required' }); return; }
    if (!formGross) { setPostMsg({ ok: false, text: 'Gross amount required' }); return; }
    setPosting(true); setPostMsg(null);
    try {
      const res = await apiPost('/api/payouts', {
        payout_id: formId.trim(), payout_date: formDate, client_name: formClient.trim(), entity: formEntity,
        gross_amount: parseFloat(formGross) || 0, processing_fee: parseFloat(formFee) || 0, net_amount: parseFloat(formNet) || 0,
      }) as any;
      if (res?.skipped) { setPostMsg({ ok: false, text: `Already sent (${formId}) — skipped` }); }
      else { setPostMsg({ ok: true, text: `✓ Posted ${formId} to QBO` }); setFormId(''); setFormClient(''); setFormGross(''); setFormFee(''); setFormNet(''); refresh(); }
    } catch (e: any) { setPostMsg({ ok: false, text: e?.message || String(e) }); }
    finally { setPosting(false); }
  };
  const sorted = rows ? [...rows].sort((a, b) => b.payout_date.localeCompare(a.payout_date)) : [];
  const totalNet = sorted.reduce((s, r) => s + (r.net_amount || 0), 0);
  const iwNet = sorted.filter(r => r.entity === 'ImpactWorks').reduce((s, r) => s + (r.net_amount || 0), 0);
  const rlNet = sorted.filter(r => r.entity === 'Rocket Local').reduce((s, r) => s + (r.net_amount || 0), 0);
  const inp = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text)]';
  return (
    <div>
      {(loading || error) && <PageState loading={loading} error={error} />}
      {rows && (
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={Receipt} label="Total payouts" value={rows.length} accent="#8b8af0" />
          <StatCard icon={TrendingUp} label="Total net" value={fmtDollars(totalNet)} accent="#16a34a" />
          <StatCard icon={Building2} label="ImpactWorks net" value={fmtDollars(iwNet)} accent="#818cf8" />
          <StatCard icon={Target} label="Rocket Local net" value={fmtDollars(rlNet)} accent="#10b981" />
        </div>
      )}
      {rows && (
        <div class="rounded-xl border border-[var(--color-border)] overflow-hidden mb-6">
          <table class="w-full text-[12px]">
            <thead>
              <tr class="bg-[var(--color-elevated)] text-[var(--color-text-muted)] text-left">
                <th class="px-4 py-2 font-medium">Payout ID</th>
                <th class="px-4 py-2 font-medium">Date</th>
                <th class="px-4 py-2 font-medium">Entity</th>
                <th class="px-4 py-2 font-medium">Client</th>
                <th class="px-4 py-2 font-medium text-right">Gross</th>
                <th class="px-4 py-2 font-medium text-right">Fee</th>
                <th class="px-4 py-2 font-medium text-right">Net</th>
                <th class="px-4 py-2 font-medium">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && <tr><td colspan={8} class="px-4 py-8 text-center text-[var(--color-text-faint)] text-[12px]">No payouts recorded yet</td></tr>}
              {sorted.map(p => (
                <tr key={p.payout_id} class="border-t border-[var(--color-border)] hover:bg-[var(--color-card)]">
                  <td class="px-4 py-2 font-mono text-[11px] text-[var(--color-text-muted)]">{p.payout_id}</td>
                  <td class="px-4 py-2 text-[var(--color-text-muted)]">{p.payout_date}</td>
                  <td class="px-4 py-2"><EntityBadge entity={p.entity} /></td>
                  <td class="px-4 py-2 text-[var(--color-text)]">{p.client_name || '—'}</td>
                  <td class="px-4 py-2 text-right tabular-nums text-[var(--color-text-muted)]">{fmtDollars(p.gross_amount)}</td>
                  <td class="px-4 py-2 text-right tabular-nums text-[var(--color-text-faint)]">{fmtDollars(p.processing_fee)}</td>
                  <td class="px-4 py-2 text-right tabular-nums font-semibold" style={{ color: '#10b981' }}>{fmtDollars(p.net_amount)}</td>
                  <td class="px-4 py-2 text-[11px] text-[var(--color-text-faint)]">
                    {p.recorded_at ? new Date(p.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Post Payout to QBO</div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <label class="block"><span class="text-[11px] text-[var(--color-text-muted)] mb-1 block">Payout ID</span><input class={inp} value={formId} placeholder="po_XXXXX" onInput={(e: any) => setFormId(e.currentTarget.value)} /></label>
          <label class="block"><span class="text-[11px] text-[var(--color-text-muted)] mb-1 block">Date</span><input type="date" class={inp} value={formDate} onInput={(e: any) => setFormDate(e.currentTarget.value)} /></label>
        </div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <label class="block"><span class="text-[11px] text-[var(--color-text-muted)] mb-1 block">Client Name</span><input class={inp} value={formClient} placeholder="SPP-Direct" onInput={(e: any) => setFormClient(e.currentTarget.value)} /></label>
          <label class="block"><span class="text-[11px] text-[var(--color-text-muted)] mb-1 block">Entity</span>
            <select class={inp} value={formEntity} onChange={(e: any) => setFormEntity(e.currentTarget.value)}>
              <option value="Rocket Local">Rocket Local</option>
              <option value="ImpactWorks">ImpactWorks</option>
            </select>
          </label>
        </div>
        <div class="grid grid-cols-3 gap-3 mb-4">
          <label class="block"><span class="text-[11px] text-[var(--color-text-muted)] mb-1 block">Gross ($)</span><input type="number" step="0.01" class={inp} value={formGross} placeholder="150.00" onInput={(e: any) => { setFormGross(e.currentTarget.value); calcNet(e.currentTarget.value, formFee); }} /></label>
          <label class="block"><span class="text-[11px] text-[var(--color-text-muted)] mb-1 block">Fee ($)</span><input type="number" step="0.01" class={inp} value={formFee} placeholder="4.65" onInput={(e: any) => { setFormFee(e.currentTarget.value); calcNet(formGross, e.currentTarget.value); }} /></label>
          <label class="block"><span class="text-[11px] text-[var(--color-text-muted)] mb-1 block">Net ($)</span><input type="number" step="0.01" class={inp} value={formNet} placeholder="145.35" onInput={(e: any) => setFormNet(e.currentTarget.value)} /></label>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" disabled={posting} onClick={submit} class="rounded-md bg-[var(--color-accent)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity">{posting ? 'Posting…' : 'Post to QBO'}</button>
          {postMsg && <span class="inline-flex items-center gap-1.5 text-[12px]" style={{ color: postMsg.ok ? '#10b981' : 'var(--color-status-failed)' }}>{postMsg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}{postMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── How to Use guide ─────────────────────────────────────────────────────────

function SopSection({ emoji, title, color, children }: { emoji: string; title: string; color: string; children: any }) {
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]" style={{ background: `color-mix(in srgb, ${color} 8%, var(--color-card))` }}>
        <span class="text-[18px]">{emoji}</span>
        <span class="text-[13px] font-semibold" style={{ color }}>{title}</span>
      </div>
      <div class="px-4 py-3 text-[12px] leading-relaxed text-[var(--color-text-muted)] space-y-1">{children}</div>
    </div>
  );
}

function StageRow({ stage, color, trigger, emoji }: { stage: string; color: string; trigger: string; emoji: string }) {
  return (
    <div class="flex items-start gap-3 py-2 border-b border-[var(--color-border)] last:border-0">
      <span class="shrink-0 mt-0.5 font-bold text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{emoji} {stage}</span>
      <span class="text-[var(--color-text-muted)] text-[11px] leading-relaxed">{trigger}</span>
    </div>
  );
}

function HowToUse() {
  return (
    <div class="max-w-3xl space-y-4">
      <div class="rounded-xl border border-[var(--color-border)] p-4 flex items-start gap-3" style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, var(--color-card))' }}>
        <BookOpen size={20} class="text-[var(--color-accent)] mt-0.5 shrink-0" />
        <div>
          <div class="text-[13px] font-semibold text-[var(--color-text)] mb-1">The Unified Sales Funnel — Gospel</div>
          <div class="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
            One board for both Rocket Local and ImpactWorks. Every prospect enters at <strong>Lead</strong> and advances left-to-right only when the trigger condition is met. No skipping stages. No moving backwards unless correcting an error.
          </div>
        </div>
      </div>

      <SopSection emoji="🗺️" title="Stage Definitions and Triggers" color="#6366f1">
        <StageRow stage="Lead" emoji="📍" color="#6366f1"
          trigger="Entry point. You have: company name + primary contact + the problem they need solved + source tag. Source could be BID referral, inbound form, cold outreach, partner, or event. Create the record immediately — don't hold leads in your head." />
        <StageRow stage="Contact" emoji="📞" color="#f59e0b"
          trigger="Advance when: you've had a first real conversation (not just an email bounce). A discovery call booked counts. Genuine interest expressed counts. A voicemail left does not." />
        <StageRow stage="Qualified" emoji="✅" color="#8b5cf6"
          trigger="Advance when: discovery call completed AND BANT confirmed — Budget (they can pay), Authority (you're talking to the decision-maker), Need (their problem matches your ICP), Timeline (they want to move in the next 90 days). All four. Not three." />
        <StageRow stage="Proposal" emoji="📄" color="#0ea5e9"
          trigger="Advance when: proposal sent or presentation scheduled. Set the close date to the expected decision date — not the contract start date. Update this date as it slips. Stale dates lose trust." />
        <StageRow stage="Won" emoji="🏆" color="#16a34a"
          trigger="Contract signed or first payment received. Move in Vendasta AND Mission Control. A verbal yes is not Won." />
        <StageRow stage="Lost" emoji="❌" color="#dc2626"
          trigger="Decision made, and it's not you. Document why in notes before closing: price, timing, competitor, or no decision. That data improves your pitch." />
      </SopSection>

      <SopSection emoji="📐" title="Ground Rules" color="#f59e0b">
        <p><strong class="text-[var(--color-text)]">One opp per prospect.</strong> If a company has interest in both Rocket Local and ImpactWorks services, create two separate deals with different brand tags. Don't combine them into one card.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Always start at Lead.</strong> Even warm inbounds, even referrals who basically said yes — start at Lead and advance immediately. This keeps the stage history accurate and the pipeline honest.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Always set a close date in Vendasta.</strong> A deal without a close date doesn't exist as far as forecasting goes. Set it when you create the Vendasta opportunity and update it when it slips.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Close stale deals at 60 days.</strong> If nothing has moved in 60 days and you can't get a response, close it as Lost with reason "Not responsive." You can always reopen a new opportunity if they come back.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Local leads vs Vendasta opps.</strong> New leads you add here start as local-only (orange local badge). Once you've had a real conversation, add them to Vendasta as a formal opportunity — then you can track probability and weighted pipeline value.</p>
      </SopSection>

      <SopSection emoji="🤝" title="BID Campaign Workflow" color="#0ea5e9">
        <p>BID (Business Improvement District) prospects are the primary source for Rocket Local leads from the Traffic Partnership outreach.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Step 1 — Webinar invite sent:</strong> Track in the BID Outreach tab, not here.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Step 2 — Webinar held, genuine interest shown:</strong> Create a Lead card here with source = BID. Move them to Contact immediately.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Step 3 — Discovery call booked:</strong> Card is already at Contact. Update notes with what you know from the webinar interaction.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Step 4 — Call completed, BANT confirmed:</strong> Advance to Qualified. Create the formal Vendasta opportunity now so it shows in the weighted pipeline.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Steps 5-6:</strong> Normal Proposal to Won/Lost flow from here.</p>
      </SopSection>

      <SopSection emoji="🏢" title="Brand Guide" color="#818cf8">
        <div class="flex flex-col gap-2 mt-1">
          <div class="flex items-start gap-3 p-2 rounded-lg bg-[var(--color-elevated)]">
            <span class="text-[20px]">🚀</span>
            <div>
              <div class="font-semibold text-[var(--color-text)] text-[12px]">Rocket Local</div>
              <div class="text-[11px] text-[var(--color-text-muted)]">Local SEO, reputation management, Google Maps Pack, home service providers (roofing, HVAC, plumbing, etc.), medical practices, multi-location brands. Hyperlocal optimization is the core differentiator.</div>
            </div>
          </div>
          <div class="flex items-start gap-3 p-2 rounded-lg bg-[var(--color-elevated)]">
            <span class="text-[20px]">⚡</span>
            <div>
              <div class="font-semibold text-[var(--color-text)] text-[12px]">ImpactWorks</div>
              <div class="text-[11px] text-[var(--color-text-muted)]">AI strategy, workflow automation (Zapier / Make / Airtable), agentic AI development, full-stack digital services. Client base: ambitious SMB to mid-market, e-commerce/SaaS. Flagship: AI Automation Audit + 3-week fixed-scope sprints.</div>
            </div>
          </div>
        </div>
        <p class="mt-2 text-[var(--color-text-faint)]">When a prospect could fit both brands, have an explicit conversation about which problem to solve first. Don't split attention across two deals in parallel early in the funnel.</p>
      </SopSection>

      <SopSection emoji="🖥️" title="Using This Board" color="#10b981">
        <p><strong class="text-[var(--color-text)]">Add a lead:</strong> Click "New Lead" in the top right. Fill in brand, source, deal name, company, and contact. It drops into the Lead column with an orange local badge.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Advance a card:</strong> Click the stage button (e.g. "Contact →") in the bottom right of any open card. This updates the local stage store immediately. Vendasta's board does not update automatically — sync it manually when the stage matters for reporting.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Edit a card:</strong> Hover and click the pencil icon. For local leads you can update all fields. For Vendasta opps you can update stage, brand, and source.</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Won/Lost:</strong> These always come from Vendasta live. Close opportunities in Vendasta and they'll appear here on next refresh (3-minute cache).</p>
        <p class="mt-2"><strong class="text-[var(--color-text)]">Refresh:</strong> Hit the Refresh button in the top right to pull latest Vendasta data immediately.</p>
      </SopSection>
    </div>
  );
}

// ─── Main Pipeline component ──────────────────────────────────────────────────

export function Pipeline() {
  const { data, loading, error, refresh } = useFetch<PipelineData>('/api/pipeline', 120_000);
  const [view, setView] = useState<'pipeline' | 'accounts' | 'payouts' | 'guide'>('pipeline');
  const [editingAccount, setEditingAccount] = useState<AccountCard | null>(null);
  const [editingDeal, setEditingDeal] = useState<DealCard | null>(null);
  const [addingLead, setAddingLead] = useState(false);

  const rev = data?.revenue;
  const t = data?.dealTotals;
  const totalMargin = rev && rev.totalRetailMRR != null && rev.totalWholesaleMonthly != null
    ? rev.totalRetailMRR - rev.totalWholesaleMonthly : null;

  const handleStageChange = async (id: string, subStage: string) => {
    try {
      await apiPost('/api/pipeline/stage', { id, subStage });
      refresh();
    } catch (e) {
      console.error('stage update failed', e);
    }
  };

  const cols = ['Lead', 'Contact', 'Qualified', 'Proposal', 'Won', 'Lost'] as const;

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Sales Pipeline" breadcrumb="Workspace"
        actions={
          <div class="flex items-center gap-2">
            {view === 'pipeline' && (
              <button type="button" onClick={() => setAddingLead(true)}
                class="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[12px] font-semibold text-white hover:opacity-90 transition-opacity">
                <Plus size={12} /> New Lead
              </button>
            )}
            <button type="button" onClick={refresh}
              class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        }
        tabs={<>
          <Tab label="Pipeline" active={view === 'pipeline'} count={t?.openTotal.count} onClick={() => setView('pipeline')} />
          <Tab label="Accounts" active={view === 'accounts'} count={data?.customers.length} onClick={() => setView('accounts')} />
          <Tab label="Payouts" active={view === 'payouts'} onClick={() => setView('payouts')} />
          <Tab label="How to Use" active={view === 'guide'} onClick={() => setView('guide')} />
        </>}
      />

      <div class="flex-1 overflow-auto p-6">
        {view === 'payouts' && <PayoutsView />}
        {view === 'guide' && <HowToUse />}

        {view !== 'payouts' && view !== 'guide' && (loading || error) && <PageState loading={loading} error={error} />}

        {view !== 'payouts' && view !== 'guide' && data && !error && (
          <>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard icon={Target} label="Open pipeline"
                value={t ? money(t.openTotal.value) : '—'}
                sub={t ? `${t.openTotal.count} deals · ${money(t.openTotal.weighted)} weighted` : undefined}
                accent="#6366f1" />
              <StatCard icon={Trophy} label="Won"
                value={t ? money(t.won.value) : '—'}
                sub={t ? `${t.won.count} deals` : undefined}
                accent="#16a34a" />
              <StatCard icon={TrendingUp} label="Monthly revenue"
                value={rev?.totalRetailMRR != null ? money(rev.totalRetailMRR) : '—'}
                sub={rev?.ready ? `margin ${money(totalMargin)}/mo` : 'updating…'}
                accent="#16a34a" />
              <StatCard icon={Users} label="Customers" value={data.customers.length} />
            </div>

            {view === 'pipeline' && (
              <div class="flex gap-4 overflow-x-auto pb-2">
                {cols.map((col) => {
                  const cards: DealCard[] =
                    col === 'Won' ? data.deals.won
                    : col === 'Lost' ? data.deals.lost
                    : col === 'Lead' ? data.deals.lead
                    : col === 'Contact' ? data.deals.contact
                    : col === 'Qualified' ? data.deals.qualified
                    : data.deals.proposal;
                  const stTotal: StageTotal | undefined =
                    col === 'Won' ? t?.won
                    : col === 'Lost' ? t?.lost
                    : col === 'Lead' ? t?.lead
                    : col === 'Contact' ? t?.contact
                    : col === 'Qualified' ? t?.qualified
                    : t?.proposal;
                  return (
                    <Column key={col} name={col} count={cards.length} total={stTotal?.value}>
                      {cards.map((d) => (
                        <DealCardView key={d.id} d={d} colName={col}
                          onStageChange={handleStageChange}
                          onEdit={setEditingDeal}
                        />
                      ))}
                    </Column>
                  );
                })}
              </div>
            )}

            {view === 'accounts' && <Accounts rows={data.customers} onEdit={setEditingAccount} />}

            <div class="mt-4 text-[11px] text-[var(--color-text-faint)] flex items-center gap-1.5">
              <Wallet size={11} /> Live from Vendasta · {new Date(data.generatedAt).toLocaleTimeString()}
              {rev?.ready && rev.asOf ? ` · revenue ${new Date(rev.asOf).toLocaleTimeString()}` : ' · revenue updating…'}
            </div>
          </>
        )}
      </div>

      {addingLead && data && (
        <NewLeadModal
          brands={data.brands}
          sources={data.sources}
          onClose={() => setAddingLead(false)}
          onCreated={() => { setAddingLead(false); refresh(); }}
        />
      )}
      {editingDeal && data && (
        <EditDealModal
          deal={editingDeal}
          brands={data.brands}
          sources={data.sources}
          subStages={data.subStages}
          onClose={() => setEditingDeal(null)}
          onSaved={() => { setEditingDeal(null); refresh(); }}
        />
      )}
      {editingAccount && (
        <EditAccountModal
          card={editingAccount}
          statuses={data?.outreachStatuses || []}
          onClose={() => setEditingAccount(null)}
          onSaved={() => { setEditingAccount(null); refresh(); }}
        />
      )}
    </div>
  );
}
