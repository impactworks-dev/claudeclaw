// BrainProposals.tsx — Memory theme proposals, ported into the Mission Control SPA.
// Previously lived at /store/brain-proposals.html (standalone page) which stripped the sidebar.

import { useEffect, useRef, useState } from 'preact/hooks';
import { RefreshCw, Lightbulb, GitMerge, Plus, X, Edit3, BookOpen } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { apiGet, apiPost, dashboardToken } from '@/lib/api';

async function apiDeleteWithBody<T = unknown>(path: string, body: unknown): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${path}${sep}token=${encodeURIComponent(dashboardToken)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...(dashboardToken ? { Authorization: `Bearer ${dashboardToken}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Proposal {
  topic: string;
  hitCount: number;
  importance: number;
  examples: string[];
  suggestedNoteName: string;
  _client?: boolean;
}

interface Memory {
  id: number;
  summary: string;
  importance: number;
  topics: string;
  source?: string;
  created_at: number;
}

type RightTab = 'memory' | 'wiki';

// ── Helpers ───────────────────────────────────────────────────────────────────

function impColor(i: number): string {
  if (i >= 0.85) return '#f87171';
  if (i >= 0.70) return '#fb923c';
  if (i >= 0.55) return '#fbbf24';
  return '#34d399';
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function topicsOf(raw: string): string[] {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function genDraft(topic: string, noteName: string, mems: Memory[]): string {
  const today = new Date().toISOString().split('T')[0];
  const lines = mems.slice(0, 8).map(m => '- ' + m.summary).join('\n');
  return `---\ntitle: ${noteName}\ntags: [proposed, ${today}]\n---\n\n# ${noteName}\n\n${lines}\n\n## Notes\n\n`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BrainProposals() {
  const [proposals, setProposals]       = useState<Proposal[]>([]);
  const [clientTopics, setClientTopics] = useState<string[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [memories, setMemories]         = useState<Memory[]>([]);
  const [memLoading, setMemLoading]     = useState(false);
  const [selectedMem, setSelectedMem]   = useState<Memory | null>(null);
  const [rightTab, setRightTab]         = useState<RightTab>('memory');
  const [draft, setDraft]               = useState('');
  const [memEdit, setMemEdit]           = useState('');
  const [memSaving, setMemSaving]       = useState(false);
  const [wikiSaving, setWikiSaving]     = useState(false);
  const [toast, setToast]               = useState<{ msg: string; type?: string } | null>(null);
  const toastTimer = useRef<any>(null);

  // Modals
  const [reassignOpen, setReassignOpen]   = useState(false);
  const [reassignMem, setReassignMem]     = useState<Memory | null>(null);
  const [reassignChecked, setReassignChecked] = useState<string[]>([]);
  const [reassignNew, setReassignNew]     = useState('');
  const [mergeOpen, setMergeOpen]         = useState(false);
  const [mergeTopic, setMergeTopic]       = useState('');
  const [mergeTarget, setMergeTarget]     = useState('');
  const [newTopicOpen, setNewTopicOpen]   = useState(false);
  const [newTopicName, setNewTopicName]   = useState('');

  const allTopics = [...new Set([...proposals.map(p => p.topic), ...clientTopics])].sort();

  function showToast(msg: string, type?: string) {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }

  // ── Load proposals ────────────────────────────────────────────────────────

  async function loadProposals(force = false) {
    setLoading(true);
    try {
      const d = await apiGet<{ proposals: Proposal[] }>(`/api/brain/proposals${force ? '?force=1' : ''}`);
      setProposals(d.proposals || []);
    } catch { showToast('Failed to load proposals', 'error'); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadProposals(); }, []);

  // ── Select topic ──────────────────────────────────────────────────────────

  async function selectTopic(topic: string) {
    setSelectedTopic(topic);
    setSelectedMem(null);
    setMemEdit('');
    setDraft('');
    setMemLoading(true);
    setMemories([]);
    try {
      const d = await apiGet<{ memories: Memory[] }>(`/api/brain/proposals/memories?topic=${encodeURIComponent(topic)}`);
      setMemories(d.memories || []);
    } catch { showToast('Failed to load memories', 'error'); }
    finally { setMemLoading(false); }
  }

  // ── Memory edit ───────────────────────────────────────────────────────────

  function pickMem(mem: Memory) {
    setSelectedMem(mem);
    setMemEdit(mem.summary);
    setRightTab('memory');
  }

  async function saveSummary() {
    if (!selectedMem) return;
    const summary = memEdit.trim();
    if (!summary) { showToast('Text cannot be empty', 'error'); return; }
    setMemSaving(true);
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>(`/api/brain/memories/${selectedMem.id}/summary`, { summary });
      if (r.ok) {
        setMemories(ms => ms.map(m => m.id === selectedMem.id ? { ...m, summary } : m));
        setSelectedMem(m => m ? { ...m, summary } : m);
        showToast('Memory saved', 'success');
      } else { showToast('Error: ' + (r.error || 'unknown'), 'error'); }
    } catch { showToast('Network error', 'error'); }
    finally { setMemSaving(false); }
  }

  async function dismissMemory(id: number) {
    if (!selectedTopic) return;
    if (!confirm(`Remove this memory from "${selectedTopic}"?`)) return;
    try {
      const r = await apiDeleteWithBody<{ ok: boolean; error?: string }>(`/api/brain/memories/${id}/topic`, { topic: selectedTopic });
      if (r.ok) {
        setMemories(ms => ms.filter(m => m.id !== id));
        if (selectedMem?.id === id) { setSelectedMem(null); setMemEdit(''); }
        showToast('Removed from topic', 'success');
      } else { showToast('Error: ' + (r.error || ''), 'error'); }
    } catch { showToast('Network error', 'error'); }
  }

  // ── Wiki ──────────────────────────────────────────────────────────────────

  function handleTabWiki() {
    setRightTab('wiki');
    if (!draft.trim() && selectedTopic && memories.length) {
      const p = proposals.find(x => x.topic === selectedTopic);
      const noteName = p?.suggestedNoteName ?? (selectedTopic.charAt(0).toUpperCase() + selectedTopic.slice(1));
      setDraft(genDraft(selectedTopic, noteName, memories));
    }
  }

  async function addToWiki() {
    if (!selectedTopic) return;
    const content = draft.trim();
    if (!content) { showToast('Draft is empty — generate it first', 'error'); return; }
    const p = proposals.find(x => x.topic === selectedTopic);
    const noteName = p?.suggestedNoteName ?? (selectedTopic.charAt(0).toUpperCase() + selectedTopic.slice(1));
    setWikiSaving(true);
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>('/api/brain/proposals/accept', { topic: selectedTopic, noteName, content });
      if (r.ok) {
        setProposals(ps => ps.filter(x => x.topic !== selectedTopic));
        setClientTopics(cs => cs.filter(t => t !== selectedTopic));
        setSelectedTopic(null);
        setMemories([]);
        setDraft('');
        setSelectedMem(null);
        showToast('Added to wiki: ' + noteName, 'success');
      } else { showToast('Error: ' + (r.error || ''), 'error'); }
    } catch { showToast('Network error', 'error'); }
    finally { setWikiSaving(false); }
  }

  // ── Merge ─────────────────────────────────────────────────────────────────

  function openMerge(topic: string) {
    const others = allTopics.filter(t => t !== topic);
    if (!others.length) { showToast('No other topics to merge into', 'error'); return; }
    setMergeTopic(topic);
    setMergeTarget(others[0]);
    setMergeOpen(true);
  }

  async function doMerge() {
    if (!confirm(`Merge "${mergeTopic}" → "${mergeTarget}"?`)) return;
    try {
      const r = await apiPost<{ ok: boolean; updated?: number; error?: string }>('/api/brain/proposals/merge', { from: mergeTopic, into: mergeTarget });
      if (r.ok) {
        setProposals(ps => ps.filter(p => p.topic !== mergeTopic));
        setClientTopics(cs => cs.filter(t => t !== mergeTopic));
        if (selectedTopic === mergeTopic) selectTopic(mergeTarget);
        setMergeOpen(false);
        showToast(`Merged ${r.updated ?? ''} memories`, 'success');
      } else { showToast('Error: ' + (r.error || ''), 'error'); }
    } catch { showToast('Network error', 'error'); }
  }

  // ── Reassign ──────────────────────────────────────────────────────────────

  function openReassign(mem: Memory) {
    setReassignMem(mem);
    setReassignChecked(topicsOf(mem.topics));
    setReassignNew('');
    setReassignOpen(true);
  }

  async function saveReassign() {
    if (!reassignMem || !reassignChecked.length) { showToast('Select at least one topic', 'error'); return; }
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>(`/api/brain/memories/${reassignMem.id}/topics`, { topics: reassignChecked });
      if (r.ok) {
        const updated = JSON.stringify(reassignChecked);
        setMemories(ms => ms.map(m => m.id === reassignMem.id ? { ...m, topics: updated } : m));
        if (selectedMem?.id === reassignMem.id) setSelectedMem(m => m ? { ...m, topics: updated } : m);
        setReassignOpen(false);
        showToast('Topics updated', 'success');
      } else { showToast('Error: ' + (r.error || ''), 'error'); }
    } catch { showToast('Network error', 'error'); }
  }

  function addReassignNew() {
    const val = reassignNew.trim().toLowerCase();
    if (!val) return;
    if (!clientTopics.includes(val) && !proposals.find(p => p.topic === val)) {
      setClientTopics(cs => [...cs, val]);
    }
    if (!reassignChecked.includes(val)) setReassignChecked(c => [...c, val]);
    setReassignNew('');
  }

  // ── New topic ─────────────────────────────────────────────────────────────

  function createNewTopic() {
    const val = newTopicName.trim().toLowerCase();
    if (!val) { showToast('Enter a name', 'error'); return; }
    if (clientTopics.includes(val) || proposals.find(p => p.topic === val)) {
      showToast('Already exists', 'error'); return;
    }
    setClientTopics(cs => [...cs, val]);
    setNewTopicOpen(false);
    setNewTopicName('');
    selectTopic(val);
    showToast('Created — use ✎ on memory cards to assign here', 'success');
  }

  // ── All proposals list ────────────────────────────────────────────────────

  const allProposals: Proposal[] = [
    ...proposals,
    ...clientTopics.map(t => ({
      topic: t, hitCount: 0, importance: 0, examples: [],
      suggestedNoteName: t.charAt(0).toUpperCase() + t.slice(1), _client: true,
    })),
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div class="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Brain Proposals"
        subtitle="Recurring memory themes — promote to wiki when ready"
        actions={
          <button type="button" onClick={() => loadProposals(true)}
            class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]">
            <RefreshCw size={12} class={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      <div class="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left: topic list ── */}
        <div class="flex flex-col border-r border-[var(--color-border)] overflow-hidden" style={{ width: 230, flexShrink: 0 }}>
          <div class="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)] flex-shrink-0">
            <span class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">Topics</span>
            <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-elevated)] text-[var(--color-text-faint)]">
              {allProposals.length}
            </span>
          </div>

          <div class="flex-1 overflow-y-auto p-1.5">
            {loading ? (
              <div class="text-center text-[11px] text-[var(--color-text-faint)] py-6">Loading…</div>
            ) : allProposals.length === 0 ? (
              <div class="flex flex-col items-center justify-center py-8 gap-2 text-[var(--color-text-faint)]">
                <Lightbulb size={22} class="opacity-30" />
                <span class="text-[11px]">No proposals yet</span>
              </div>
            ) : allProposals.map(p => (
              <div key={p.topic}
                class={`relative rounded-md px-2.5 py-2 mb-0.5 cursor-pointer border transition-colors group ${
                  selectedTopic === p.topic
                    ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)]'
                    : 'border-transparent hover:bg-[var(--color-elevated)]'
                }`}
                onClick={() => selectTopic(p.topic)}>
                <div class="text-[12.5px] font-medium text-[var(--color-text)] pr-6 truncate">
                  {p.suggestedNoteName || p.topic}
                </div>
                <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">
                  {p._client ? 'custom · 0 memories' : `${p.hitCount} memories`}
                </div>
                <button type="button"
                  onClick={e => { e.stopPropagation(); openMerge(p.topic); }}
                  class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-opacity"
                  title="Merge into another topic">
                  <GitMerge size={12} />
                </button>
              </div>
            ))}
          </div>

          <button type="button"
            onClick={() => { setNewTopicName(''); setNewTopicOpen(true); }}
            class="flex items-center gap-1.5 px-3 py-2.5 border-t border-dashed border-[var(--color-border)] text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] transition-colors flex-shrink-0">
            <Plus size={12} /> New topic
          </button>
        </div>

        {/* ── Middle: memory cards ── */}
        <div class="flex flex-col flex-1 min-w-0 overflow-hidden border-r border-[var(--color-border)]">
          <div class="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)] flex-shrink-0">
            <span class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">Memories</span>
            <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-elevated)] text-[var(--color-text-faint)]">
              {memories.length || '—'}
            </span>
          </div>

          <div class="flex-1 overflow-y-auto p-2.5">
            {!selectedTopic ? (
              <div class="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-faint)]">
                <span style={{ fontSize: 22, opacity: 0.3 }}>👈</span>
                <span class="text-[11px]">Select a topic</span>
              </div>
            ) : memLoading ? (
              <div class="text-center text-[11px] text-[var(--color-text-faint)] py-6">Loading…</div>
            ) : memories.length === 0 ? (
              <div class="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-faint)]">
                <span style={{ fontSize: 22, opacity: 0.3 }}>🔍</span>
                <span class="text-[11px]">No memories for this topic</span>
              </div>
            ) : memories.map(mem => {
              const topics = topicsOf(mem.topics);
              return (
                <div key={mem.id}
                  class={`relative rounded-lg border p-2.5 mb-2 cursor-pointer transition-colors ${
                    selectedMem?.id === mem.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-accent)]'
                  }`}
                  onClick={e => { if ((e.target as HTMLElement).closest('button')) return; pickMem(mem); }}>

                  {/* action buttons */}
                  <div class="absolute top-2 right-2 flex gap-1">
                    <button type="button" onClick={e => { e.stopPropagation(); openReassign(mem); }}
                      class="p-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors">
                      <Edit3 size={10} />
                    </button>
                    <button type="button" onClick={e => { e.stopPropagation(); dismissMemory(mem.id); }}
                      class="p-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-faint)] hover:text-[#f87171] hover:border-[#f87171] transition-colors">
                      <X size={10} />
                    </button>
                  </div>

                  <div class="text-[12px] leading-relaxed text-[var(--color-text)] pr-12">{mem.summary}</div>

                  <div class="flex flex-wrap items-center gap-1.5 mt-2">
                    <span class="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: impColor(mem.importance) }} />
                    {mem.source && <span class="text-[10px] text-[var(--color-text-faint)]">{mem.source}</span>}
                    <span class="text-[10px] text-[var(--color-text-faint)]">{fmtDate(mem.created_at)}</span>
                    {topics.map(t => (
                      <span key={t} class={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                        t.toLowerCase() === selectedTopic
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent)]'
                          : 'bg-[var(--color-elevated)] text-[var(--color-text-faint)] border-[var(--color-border)]'
                      }`}>{t}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: tabbed panel ── */}
        <div class="flex flex-col overflow-hidden flex-shrink-0" style={{ width: 380 }}>
          {/* Tabs */}
          <div class="flex border-b border-[var(--color-border)] bg-[var(--color-card)] flex-shrink-0">
            <button type="button" onClick={() => setRightTab('memory')}
              class={`flex-1 py-2.5 text-[12px] font-semibold border-b-2 transition-colors ${
                rightTab === 'memory'
                  ? 'text-[var(--color-text)] border-[var(--color-accent)]'
                  : 'text-[var(--color-text-faint)] border-transparent hover:text-[var(--color-text)]'
              }`}>
              ✏️ Edit Memory
            </button>
            <button type="button" onClick={handleTabWiki}
              class={`flex-1 py-2.5 text-[12px] font-semibold border-b-2 transition-colors ${
                rightTab === 'wiki'
                  ? 'text-[var(--color-text)] border-[var(--color-accent)]'
                  : 'text-[var(--color-text-faint)] border-transparent hover:text-[var(--color-text)]'
              }`}>
              📖 Wiki Draft
            </button>
          </div>

          {/* Memory edit pane */}
          {rightTab === 'memory' && (
            <div class="flex flex-col flex-1 overflow-hidden">
              {!selectedMem ? (
                <div class="flex flex-col items-center justify-center flex-1 gap-2 text-[var(--color-text-faint)]">
                  <span style={{ fontSize: 22, opacity: 0.3 }}>👆</span>
                  <span class="text-[11px] text-center px-4">Click any memory card to view and edit its text</span>
                </div>
              ) : (
                <>
                  <div class="px-3 py-2 border-b border-[var(--color-border)] text-[11px] text-[var(--color-text-faint)] leading-relaxed flex-shrink-0">
                    <span class="text-[var(--color-text)] font-medium">Memory #{selectedMem.id}</span>
                    {' · '}{Math.round(selectedMem.importance * 100)}% importance
                    {' · '}{fmtDate(selectedMem.created_at)}<br />
                    Topics: {topicsOf(selectedMem.topics).map(t => <em key={t} class="mr-1">{t}</em>) || <em>none</em>}
                  </div>
                  <textarea
                    class="flex-1 bg-transparent border-0 resize-none p-3.5 text-[13px] text-[var(--color-text)] leading-relaxed focus:outline-none"
                    value={memEdit}
                    onInput={(e: any) => setMemEdit(e.target.value)}
                  />
                  <div class="flex items-center gap-2 px-3 py-2.5 border-t border-[var(--color-border)] flex-shrink-0">
                    <button type="button" onClick={saveSummary} disabled={memSaving}
                      class="px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white disabled:opacity-50">
                      {memSaving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" onClick={() => openReassign(selectedMem)}
                      class="px-3 py-1.5 rounded text-[12px] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                      ✎ Topics
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Wiki draft pane */}
          {rightTab === 'wiki' && (
            <div class="flex flex-col flex-1 overflow-hidden">
              <textarea
                class="flex-1 bg-transparent border-0 resize-none p-3.5 text-[13px] text-[var(--color-text)] leading-relaxed focus:outline-none"
                placeholder={'Select a topic then click ✨ Generate to pre-fill from memories.\n\nEdit the draft, then click Add to Wiki to save it.'}
                value={draft}
                onInput={(e: any) => setDraft(e.target.value)}
              />
              <div class="flex gap-2 px-3 py-2.5 border-t border-[var(--color-border)] flex-shrink-0">
                <button type="button"
                  disabled={!selectedTopic || memories.length === 0}
                  onClick={() => {
                    if (!selectedTopic) return;
                    const p = proposals.find(x => x.topic === selectedTopic);
                    const noteName = p?.suggestedNoteName ?? (selectedTopic.charAt(0).toUpperCase() + selectedTopic.slice(1));
                    setDraft(genDraft(selectedTopic, noteName, memories));
                    showToast('Draft generated', 'success');
                  }}
                  class="px-3 py-1.5 rounded text-[12px] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed">
                  ✨ Generate
                </button>
                <button type="button"
                  disabled={!selectedTopic || wikiSaving}
                  onClick={addToWiki}
                  class="px-3 py-1.5 rounded text-[12px] font-medium bg-[#34d399] text-black disabled:opacity-40 disabled:cursor-not-allowed">
                  <BookOpen size={11} class="inline mr-1" />
                  {wikiSaving ? 'Saving…' : 'Add to Wiki'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}

      {/* Re-assign topics */}
      {reassignOpen && reassignMem && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) setReassignOpen(false); }}>
          <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-5 w-[460px] max-w-[92vw] max-h-[80vh] overflow-y-auto shadow-2xl">
            <div class="text-[14px] font-bold mb-2 text-[var(--color-text)]">Re-assign Topics</div>
            <div class="text-[11px] text-[var(--color-text-faint)] mb-3 leading-relaxed">
              {reassignMem.summary.slice(0, 100)}{reassignMem.summary.length > 100 ? '…' : ''}
            </div>
            <div class="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto mb-3">
              {allTopics.length === 0
                ? <div class="text-[11px] text-[var(--color-text-faint)] px-1">No topics yet — add one below.</div>
                : allTopics.map(t => (
                  <label key={t} class="flex items-center gap-2.5 px-2.5 py-1.5 rounded border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-elevated)]">
                    <input type="checkbox" checked={reassignChecked.includes(t)}
                      onChange={e => {
                        const checked = (e.target as HTMLInputElement).checked;
                        setReassignChecked(c => checked ? [...c, t] : c.filter(x => x !== t));
                      }} />
                    <span class="text-[13px] text-[var(--color-text)]">{t}</span>
                  </label>
                ))}
            </div>
            <div class="flex gap-2 mb-4">
              <input class="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                placeholder="New topic name…" value={reassignNew}
                onInput={(e: any) => setReassignNew(e.target.value)}
                onKeyDown={(e: any) => { if (e.key === 'Enter') addReassignNew(); }} />
              <button type="button" onClick={addReassignNew}
                class="px-3 py-1.5 rounded border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Add
              </button>
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" onClick={() => setReassignOpen(false)}
                class="px-3 py-1.5 rounded border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)]">Cancel</button>
              <button type="button" onClick={saveReassign}
                class="px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Merge */}
      {mergeOpen && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) setMergeOpen(false); }}>
          <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-5 w-[420px] max-w-[92vw] shadow-2xl">
            <div class="text-[14px] font-bold mb-2 text-[var(--color-text)]">Merge Topic</div>
            <div class="text-[11px] text-[var(--color-text-faint)] mb-3">
              All memories tagged <strong class="text-[var(--color-text)]">"{mergeTopic}"</strong> will be retagged with the target. The source disappears.
            </div>
            <select class="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] rounded px-2.5 py-2 text-[13px] mb-4 focus:outline-none focus:border-[var(--color-accent)]"
              value={mergeTarget} onChange={(e: any) => setMergeTarget(e.target.value)}>
              {allTopics.filter(t => t !== mergeTopic).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div class="flex justify-end gap-2">
              <button type="button" onClick={() => setMergeOpen(false)}
                class="px-3 py-1.5 rounded border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)]">Cancel</button>
              <button type="button" onClick={doMerge}
                class="px-3 py-1.5 rounded text-[12px] font-medium bg-[#f87171] text-white">Merge</button>
            </div>
          </div>
        </div>
      )}

      {/* New topic */}
      {newTopicOpen && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) setNewTopicOpen(false); }}>
          <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-5 w-[400px] max-w-[92vw] shadow-2xl">
            <div class="text-[14px] font-bold mb-2 text-[var(--color-text)]">Create New Topic</div>
            <div class="text-[11px] text-[var(--color-text-faint)] mb-3 leading-relaxed">
              Name a new topic. Then use ✎ on memory cards to assign memories to it.
            </div>
            <input class="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2.5 py-2 text-[13px] text-[var(--color-text)] mb-4 focus:outline-none focus:border-[var(--color-accent)]"
              placeholder="e.g. client onboarding" value={newTopicName}
              onInput={(e: any) => setNewTopicName(e.target.value)}
              onKeyDown={(e: any) => { if (e.key === 'Enter') createNewTopic(); }}
              autoFocus />
            <div class="flex justify-end gap-2">
              <button type="button" onClick={() => setNewTopicOpen(false)}
                class="px-3 py-1.5 rounded border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)]">Cancel</button>
              <button type="button" onClick={createNewTopic}
                class="px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div class={`fixed bottom-5 right-5 z-[200] px-4 py-2.5 rounded-lg border text-[12px] shadow-lg transition-opacity ${
          toast.type === 'success' ? 'border-[#34d399] bg-[var(--color-card)] text-[var(--color-text)]' :
          toast.type === 'error'   ? 'border-[#f87171] bg-[var(--color-card)] text-[var(--color-text)]' :
          'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text)]'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
