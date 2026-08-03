import { useEffect, useMemo, useState } from 'preact/hooks';
import { ArrowLeft, ArrowRight, Check, CircleHelp, ContactRound, Mail, Phone, Plus, RefreshCw, UserRoundX } from 'lucide-preact';
import { apiGet, apiPost, apiPut } from '@/lib/api';

interface Candidate {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
}

interface Account {
  clickupTaskId: string;
  companyId: string | null;
  companyName: string;
  displayName: string;
  currentName: string | null;
  currentEmail: string | null;
  candidates: Candidate[];
}

interface ReviewData {
  accounts: Account[];
  draft: {
    selections: Record<string, string>;
    manualContacts: Record<string, ManualContact>;
    updatedAt: number;
  };
}

interface ManualContact {
  name: string;
  email: string | null;
  phone: string | null;
}

interface ApplyItem {
  clickupTaskId: string;
  companyName: string;
  status: 'updated' | 'unchanged' | 'skipped' | 'failed';
  contactName?: string;
  email?: string | null;
  phone?: string | null;
  reason?: string;
}

interface ApplyResult {
  appliedAt: number;
  totals: Record<ApplyItem['status'], number>;
  items: ApplyItem[];
}

const REVIEW_LATER = '__review_later__';
const NONE = '__none__';
const INACTIVE = '__inactive__';

export function PrimaryContacts() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [showApply, setShowApply] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const load = async (refresh = false) => {
    setError('');
    try {
      setData(await apiGet<ReviewData>(`/api/primary-contacts${refresh ? '?refresh=1' : ''}`));
    } catch (e: any) {
      setError(e?.message || 'Could not load customer contacts.');
    }
  };

  useEffect(() => { void load(); }, []);

  const accounts = data?.accounts || [];
  const selections = data?.draft.selections || {};
  const completed = useMemo(() => accounts.filter(a => selections[a.clickupTaskId]).length, [accounts, selections]);
  const reviewSummary = useMemo(() => {
    const result = {
      existing: [] as Account[],
      manual: [] as Account[],
      inactive: [] as Account[],
      none: [] as Account[],
      reviewLater: [] as Account[],
    };
    for (const account of accounts) {
      const choice = selections[account.clickupTaskId];
      if (choice === INACTIVE) result.inactive.push(account);
      else if (choice === NONE) result.none.push(account);
      else if (choice === REVIEW_LATER) result.reviewLater.push(account);
      else if (choice?.startsWith('manual:')) result.manual.push(account);
      else if (choice) result.existing.push(account);
    }
    return result;
  }, [accounts, selections]);
  const current = accounts[index];

  useEffect(() => {
    if (!current || !data) return;
    const manual = data.draft.manualContacts?.[current.clickupTaskId];
    setShowManual(Boolean(manual));
    setManualName(manual?.name || '');
    setManualEmail(manual?.email || '');
    setManualPhone(manual?.phone || '');
  }, [current?.clickupTaskId]);

  const choose = async (contactId: string, manualContact?: ManualContact) => {
    if (!current || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await apiPut<{ draft: ReviewData['draft'] }>(
        `/api/primary-contacts/${current.clickupTaskId}`,
        { contactId, ...(manualContact ? { manualContact } : {}) },
      );
      setData(prev => prev ? {
        ...prev,
        draft: result.draft,
      } : prev);
      if (index < accounts.length - 1) setTimeout(() => setIndex(i => i + 1), 180);
    } catch (e: any) {
      setError(e?.message || 'Selection could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const applyToClickUp = async () => {
    if (applying) return;
    setApplying(true);
    setError('');
    try {
      const result = await apiPost<ApplyResult>('/api/primary-contacts/apply', {
        confirmation: 'APPLY_PRIMARY_CONTACTS',
      });
      setApplyResult(result);
      setShowApply(false);
      await load(true);
    } catch (e: any) {
      setError(e?.body?.error || e?.message || 'Could not apply contacts to ClickUp.');
    } finally {
      setApplying(false);
    }
  };

  if (!data && !error) {
    return <div class="h-full flex items-center justify-center text-[13px] text-[var(--color-text-muted)]">Loading Vendasta contacts…</div>;
  }

  if (!current) {
    return (
      <div class="h-full overflow-y-auto p-5 md:p-8">
        <div class="max-w-3xl mx-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 text-center">
          <ContactRound size={34} class="mx-auto text-[var(--color-accent)]" />
          <h1 class="mt-3 text-[22px] font-bold">No active customer accounts found</h1>
          <p class="mt-2 text-[13px] text-[var(--color-text-muted)]">{error || 'Refresh the Vendasta and ClickUp connection, then try again.'}</p>
          <button onClick={() => void load(true)} class="mt-5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[12px] font-semibold text-white">Refresh</button>
        </div>
      </div>
    );
  }

  const selected = selections[current.clickupTaskId];
  const manualId = `manual:${current.clickupTaskId}`;
  const manual = data.draft.manualContacts?.[current.clickupTaskId];
  const pct = accounts.length ? Math.round((completed / accounts.length) * 100) : 0;

  return (
    <div class="h-full overflow-y-auto p-4 md:p-7">
      <div class="mx-auto max-w-4xl">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">CRM review</div>
            <h1 class="mt-1 text-[22px] md:text-[28px] font-bold text-[var(--color-text)]">Choose each client’s primary contact</h1>
            <p class="mt-1 max-w-2xl text-[12px] md:text-[13px] text-[var(--color-text-muted)]">
              Candidates come from Vendasta. Selections are saved as a draft and do not change ClickUp yet.
            </p>
          </div>
          <button onClick={() => void load(true)} class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <RefreshCw size={12} /> Refresh data
          </button>
        </div>

        <div class="mt-5">
          <div class="flex justify-between text-[11px] text-[var(--color-text-muted)]">
            <span>{completed} of {accounts.length} reviewed</span>
            <span>{pct}%</span>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-elevated)]">
            <div class="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {completed === accounts.length && accounts.length > 0 && (
          <div class="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 md:p-6">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-400">
                  <Check size={14} /> Review complete
                </div>
                <h2 class="mt-1 text-[18px] font-semibold text-[var(--color-text)]">Final change summary</h2>
                <p class="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  These are saved draft decisions. Nothing below has been written to ClickUp.
                </p>
              </div>
              <span class="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400">100%</span>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
              {[
                ['Existing contacts', reviewSummary.existing.length],
                ['Manual contacts', reviewSummary.manual.length],
                ['Inactive customers', reviewSummary.inactive.length],
                ['Contact missing', reviewSummary.none.length],
                ['Review later', reviewSummary.reviewLater.length],
              ].map(([label, count]) => (
                <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <div class="text-[20px] font-bold text-[var(--color-text)]">{count}</div>
                  <div class="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{label}</div>
                </div>
              ))}
            </div>
            {(reviewSummary.manual.length > 0 || reviewSummary.inactive.length > 0 || reviewSummary.none.length > 0 || reviewSummary.reviewLater.length > 0) && (
              <div class="mt-4 grid gap-3 md:grid-cols-2">
                {[
                  ['Manual contacts to create', reviewSummary.manual],
                  ['Customers marked inactive', reviewSummary.inactive],
                  ['Customers missing a contact', reviewSummary.none],
                  ['Customers marked review later', reviewSummary.reviewLater],
                ].filter(([, items]) => (items as Account[]).length > 0).map(([label, items]) => (
                  <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                    <div class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{label as string}</div>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      {(items as Account[]).map(account => (
                        <span class="rounded-full bg-[var(--color-elevated)] px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
                          {account.companyName}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!applyResult && !showApply && (
              <button
                type="button"
                onClick={() => setShowApply(true)}
                class="mt-5 w-full rounded-xl bg-[var(--color-accent)] px-4 py-3 text-[12px] font-semibold text-white"
              >
                Review and apply to ClickUp
              </button>
            )}
            {!applyResult && showApply && (
              <div class="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
                <div class="text-[12px] font-semibold text-amber-300">Confirm ClickUp update</div>
                <p class="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  This will update Contact Name, Email, and Phone for approved contacts. Inactive, missing, and review-later customers will be skipped. Every update will be read back from ClickUp and verified.
                </p>
                <div class="mt-3 flex justify-end gap-2">
                  <button type="button" disabled={applying} onClick={() => setShowApply(false)}
                    class="rounded-lg px-3 py-2 text-[11px] text-[var(--color-text-muted)]">Cancel</button>
                  <button type="button" disabled={applying} onClick={() => void applyToClickUp()}
                    class="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50">
                    {applying ? 'Applying and verifying…' : 'Apply approved contacts'}
                  </button>
                </div>
              </div>
            )}
            {applyResult && (
              <div class="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-[12px] font-semibold text-[var(--color-text)]">ClickUp reconciliation report</div>
                    <div class="mt-0.5 text-[10px] text-[var(--color-text-faint)]">
                      Applied {new Date(applyResult.appliedAt).toLocaleString()}
                    </div>
                  </div>
                  <button type="button" onClick={() => setApplyResult(null)}
                    class="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[10px] text-[var(--color-text-muted)]">
                    Run again
                  </button>
                </div>
                <div class="mt-3 grid grid-cols-4 gap-2">
                  {[
                    ['Updated', applyResult.totals.updated, 'text-emerald-400'],
                    ['Unchanged', applyResult.totals.unchanged, 'text-sky-400'],
                    ['Skipped', applyResult.totals.skipped, 'text-amber-400'],
                    ['Failed', applyResult.totals.failed, 'text-red-400'],
                  ].map(([label, count, color]) => (
                    <div class="rounded-lg bg-[var(--color-elevated)] p-2 text-center">
                      <div class={`text-[18px] font-bold ${color}`}>{count}</div>
                      <div class="text-[9px] text-[var(--color-text-faint)]">{label}</div>
                    </div>
                  ))}
                </div>
                {(applyResult.totals.skipped > 0 || applyResult.totals.failed > 0) && (
                  <div class="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
                    {applyResult.items.filter(item => item.status === 'skipped' || item.status === 'failed').map(item => (
                      <div class="flex items-start justify-between gap-3 rounded-lg bg-[var(--color-elevated)] px-3 py-2 text-[10px]">
                        <span class="font-medium text-[var(--color-text)]">{item.companyName}</span>
                        <span class={item.status === 'failed' ? 'text-red-400' : 'text-amber-400'}>
                          {item.reason || item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div class="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-xl shadow-black/10">
          <div class="border-b border-[var(--color-border)] p-5 md:p-6">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="text-[11px] text-[var(--color-text-faint)]">Customer {index + 1} of {accounts.length}</div>
                <h2 class="mt-1 text-[20px] font-semibold text-[var(--color-text)]">{current.companyName}</h2>
                {current.displayName !== current.companyName && <div class="mt-1 text-[11px] text-[var(--color-text-faint)]">ClickUp: {current.displayName}</div>}
              </div>
              {selected && <span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400"><Check size={11} /> Reviewed</span>}
            </div>
            {(current.currentName || current.currentEmail) && (
              <div class="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
                Currently shown in ClickUp: <span class="font-medium text-[var(--color-text)]">{current.currentName || current.currentEmail}</span>
                {current.currentName && current.currentEmail ? ` · ${current.currentEmail}` : ''}
              </div>
            )}
          </div>

          <div class="p-4 md:p-6">
            <div class="mb-3 text-[12px] font-semibold text-[var(--color-text)]">Who is the main point of contact?</div>
            <div class="grid gap-2">
              {current.candidates.map(candidate => {
                const active = selected === candidate.id;
                return (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void choose(candidate.id)}
                    class={`w-full rounded-xl border p-3.5 text-left transition-all ${active ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]'}`}
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="font-semibold text-[13px] text-[var(--color-text)]">{candidate.name}</div>
                      {active && <Check size={15} class="text-[var(--color-accent)]" />}
                    </div>
                    <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
                      {candidate.email && <span class="inline-flex items-center gap-1"><Mail size={11} />{candidate.email}</span>}
                      {candidate.phone && <span class="inline-flex items-center gap-1"><Phone size={11} />{candidate.phone}</span>}
                      {candidate.source && <span class="text-[var(--color-text-faint)]">{candidate.source}</span>}
                    </div>
                  </button>
                );
              })}
              {current.candidates.length === 0 && (
                <div class="rounded-xl border border-dashed border-[var(--color-border)] p-4 text-[12px] text-[var(--color-text-muted)]">
                  No associated Vendasta users were found for this customer.
                </div>
              )}
              {manual && selected === manualId && (
                <div class="w-full rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3.5">
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-semibold text-[13px] text-[var(--color-text)]">{manual.name}</div>
                    <Check size={15} class="text-[var(--color-accent)]" />
                  </div>
                  <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
                    {manual.email && <span class="inline-flex items-center gap-1"><Mail size={11} />{manual.email}</span>}
                    {manual.phone && <span class="inline-flex items-center gap-1"><Phone size={11} />{manual.phone}</span>}
                    <span class="text-[var(--color-text-faint)]">Manually entered</span>
                  </div>
                </div>
              )}
              {!showManual ? (
                <button type="button" disabled={saving} onClick={() => setShowManual(true)}
                  class="w-full rounded-xl border border-dashed border-[var(--color-border)] p-3.5 text-left text-[12px] transition-all hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]">
                  <span class="inline-flex items-center gap-1.5 font-semibold text-[var(--color-text)]"><Plus size={13} />Add a new contact</span>
                  <span class="ml-2 text-[var(--color-text-faint)]">Enter someone who is not listed</span>
                </button>
              ) : (
                <form
                  class="rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] p-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void choose(manualId, {
                      name: manualName.trim(),
                      email: manualEmail.trim() || null,
                      phone: manualPhone.trim() || null,
                    });
                  }}
                >
                  <div class="text-[12px] font-semibold text-[var(--color-text)]">Add a new contact</div>
                  <div class="mt-3 grid gap-3 md:grid-cols-3">
                    <label class="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                      Name
                      <input required value={manualName} onInput={(e: any) => setManualName(e.currentTarget.value)}
                        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]" />
                    </label>
                    <label class="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                      Email
                      <input type="email" value={manualEmail} onInput={(e: any) => setManualEmail(e.currentTarget.value)}
                        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]" />
                    </label>
                    <label class="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                      Phone
                      <input type="tel" value={manualPhone} onInput={(e: any) => setManualPhone(e.currentTarget.value)}
                        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]" />
                    </label>
                  </div>
                  <div class="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setShowManual(false)}
                      class="rounded-lg px-3 py-2 text-[11px] text-[var(--color-text-muted)]">Cancel</button>
                    <button type="submit" disabled={saving || !manualName.trim()}
                      class="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50">
                      Save manual contact
                    </button>
                  </div>
                </form>
              )}
              <button type="button" disabled={saving} onClick={() => void choose(NONE)}
                class={`w-full rounded-xl border p-3.5 text-left text-[12px] transition-all ${selected === NONE ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-border)] hover:bg-[var(--color-elevated)]'}`}>
                <span class="font-semibold text-[var(--color-text)]">None of these</span>
                <span class="ml-2 text-[var(--color-text-faint)]">The correct person is missing</span>
              </button>
              <button type="button" disabled={saving} onClick={() => void choose(INACTIVE)}
                class={`w-full rounded-xl border p-3.5 text-left text-[12px] transition-all ${selected === INACTIVE ? 'border-red-400 bg-red-400/10' : 'border-[var(--color-border)] hover:border-red-400/60 hover:bg-red-400/5'}`}>
                <span class="inline-flex items-center gap-1.5 font-semibold text-[var(--color-text)]"><UserRoundX size={13} />No longer an active customer</span>
                <span class="ml-2 text-[var(--color-text-faint)]">Mark for removal during final approval</span>
              </button>
              <button type="button" disabled={saving} onClick={() => void choose(REVIEW_LATER)}
                class={`w-full rounded-xl border p-3.5 text-left text-[12px] transition-all ${selected === REVIEW_LATER ? 'border-amber-400 bg-amber-400/10' : 'border-[var(--color-border)] hover:bg-[var(--color-elevated)]'}`}>
                <span class="inline-flex items-center gap-1.5 font-semibold text-[var(--color-text)]"><CircleHelp size={13} />Not sure—review later</span>
              </button>
            </div>
            {error && <div class="mt-3 text-[11px] text-red-400">{error}</div>}
          </div>

          <div class="flex items-center justify-between border-t border-[var(--color-border)] p-4 md:px-6">
            <button type="button" disabled={index === 0} onClick={() => setIndex(i => Math.max(0, i - 1))}
              class="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] disabled:opacity-30">
              <ArrowLeft size={13} /> Previous
            </button>
            <select value={index} onChange={(e: any) => setIndex(Number(e.currentTarget.value))}
              class="max-w-[48%] rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-2 py-2 text-[11px] text-[var(--color-text)]">
              {accounts.map((a, i) => <option value={i}>{selections[a.clickupTaskId] ? '✓ ' : ''}{a.companyName}</option>)}
            </select>
            <button type="button" disabled={index >= accounts.length - 1} onClick={() => setIndex(i => Math.min(accounts.length - 1, i + 1))}
              class="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] disabled:opacity-30">
              Next <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
