import { useMemo, useState } from 'preact/hooks';
import { Search, CalendarClock, Sparkles, Zap } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';

type Agent = {
  name: string;
  image: string;
  summary: string;
  purpose: string;
  use: string;
  schedule: string;
  mode: 'scheduled' | 'on-demand';
};

const P = 'https://attachments.clickup.com/profilePictures/';
const agents: Agent[] = [
  { name:'Sync Sawyer', image:P+'-39968289_IWd.jpg', summary:'Keeps Accounts honest.', purpose:'Maintains CRM integrity across accounts, contacts, deals and the product catalog.', use:'Use for imports, duplicates, linked-record validation and catalog reconciliation.', schedule:'On-demand / sync workflow', mode:'on-demand' },
  { name:'SLA Sam', image:P+'-39968242_85n.jpg', summary:'Branded SLA decks on demand.', purpose:'Builds personalized SLA decks using the established ImpactWorks dark-deck system.', use:'Provide the client, SLA type and tier; review the deck before sharing it.', schedule:'On-demand', mode:'on-demand' },
  { name:'Onboard Otto', image:P+'-39967673_Zu2.jpg', summary:'Spins up new clients end-to-end.', purpose:'Coordinates the operational structure and checklist for a newly approved client.', use:'Use after a deal is approved and the CRM identity has been verified.', schedule:'On-demand / deal-driven', mode:'on-demand' },
  { name:'Bot Builder Becky', image:P+'-39967664_xhs.jpg', summary:'Chatbot configs, deployment-ready.', purpose:'Turns requirements into structured chatbot configurations and implementation instructions.', use:'Provide goals, audiences, channels, knowledge sources and escalation rules.', schedule:'On-demand', mode:'on-demand' },
  { name:'Proposal Pete', image:P+'-39967656_qRP.jpg', summary:'Estimates and proposals, fast.', purpose:'Creates proposals from verified CRM identity and the active retail product catalog.', use:'Request a proposal by named account and scope; review assumptions before sending.', schedule:'On-demand', mode:'on-demand' },
  { name:'Support Sage', image:P+'-39967118_1Xc.jpg', summary:'First-line tech support, sorted.', purpose:'Provides safe, approved first-line troubleshooting without creating competing tickets.', use:'Use for low-risk guidance; outages, security issues and privileged changes go to Dispatch Dex.', schedule:'On-demand', mode:'on-demand' },
  { name:'Weekly Project Retro Agent', image:'https://app-cdn.clickup-qa.com/assets/images/familiar-agent-avatars/agent-4.jpg', summary:'Generates weekly project retros.', purpose:'Analyzes project outcomes, delivery problems, risks and improvements.', use:'Use for learning and process improvement, not as the factual shipping log.', schedule:'Weekly workflow', mode:'scheduled' },
  { name:'Super Agent Activity Dashboard', image:'https://app-cdn.clickup-qa.com/assets/images/familiar-agent-avatars/agent-2.jpg', summary:'Keeps a live KPI view of AI agents.', purpose:'Maintains confidence-labeled 24-hour and seven-day views of observable agent activity.', use:'Use for oversight; treat estimated attribution as directional rather than verified run telemetry.', schedule:'Weekdays at 8:30 AM', mode:'scheduled' },
  { name:'Brand Brush', image:P+'-39965635_HbG.jpg', summary:'On-brand document formatting.', purpose:'Formats documents into a consistent ImpactWorks presentation style.', use:'Provide approved copy and format; verify logos and assets render before approval.', schedule:'On-demand', mode:'on-demand' },
  { name:'Dispatch Dex', image:P+'-39964964_bCW.jpg', summary:'Service request intake and routing.', purpose:'Exclusively owns ticket acknowledgment, deduplication, SLA verification and routing.', use:'Use as the front door for support; it creates or updates one sourced ticket.', schedule:'On-demand / assigned intake', mode:'on-demand' },
  { name:'Shiplog Sloane', image:P+'-39964213_YfC.jpg', summary:'Your weekly wins, on autopilot.', purpose:'Produces the factual record of verified work completed and shipped during the week.', use:'Use for delivery visibility; leave interpretation and improvement analysis to the Retro agent.', schedule:'Weekly workflow', mode:'scheduled' },
  { name:'Roundup Remy', image:P+'-39964179_6FB.jpg', summary:'Your weekly AI news curator.', purpose:'Curates notable AI news and explains its practical relevance.', use:'Use for market awareness and follow up on items affecting products or clients.', schedule:'Weekly workflow', mode:'scheduled' },
  { name:'Domain Dex', image:P+'-39963822_J6F.jpg', summary:'Domain renewal tracker and alerts.', purpose:'Tracks domains, SSL and renewal risks.', use:'Use to identify upcoming expirations, owners and required action.', schedule:'Recurring renewal monitoring', mode:'scheduled' },
  { name:'Update Ulrich', image:P+'-39963059_nZn.jpg', summary:'Weekly ZAGG updates for Ralph.', purpose:'Drafts the account-specific ZAGG Phone Repair update.', use:'Review verified project activity and approve the draft before sending it to Ralph.', schedule:'Weekly workflow', mode:'scheduled' },
  { name:'Submission Sleuth', image:P+'-39962069_HNJ.jpg', summary:'Validates specialized IT submissions.', purpose:'Checks IT intake for completeness, evidence, security concerns and duplicates before dispatch.', use:'Use as a pre-dispatch validation gate; Dispatch Dex owns the resulting ticket.', schedule:'On-demand / submission-driven', mode:'on-demand' },
  { name:'Action Archer', image:P+'-39961437_f5i.jpg', summary:'Meeting notes become tasks.', purpose:'Extracts explicit action items, deduplicates them and creates sourced tasks.', use:'Provide a meeting-note link; use dry-run mode when you only want proposed tasks.', schedule:'Weekdays at 12:00 PM and 5:00 PM', mode:'scheduled' },
  { name:'Follow-Up Falcon', image:P+'-39961436_3qo.jpg', summary:'No proposal goes cold.', purpose:'Finds proposals that may need follow-up and drafts an internal review queue.', use:'Confirm deal stage, identity and last interaction before approving a draft.', schedule:'Weekdays at 9:00 AM', mode:'scheduled' },
  { name:'Briefing Beck', image:P+'-39961433_khC.jpg', summary:'Call prep, every time.', purpose:'Builds a concise pre-call brief from verified CRM and recent-work context.', use:'Ask with the named client or meeting; review gaps where evidence is incomplete.', schedule:'On-demand / meeting-driven', mode:'on-demand' },
  { name:'Assign Ace', image:P+'-39961432_L3u.jpg', summary:'Confirmed dev tasks go to Zakaria.', purpose:'Assigns existing development tasks only after scope and acceptance criteria are clear.', use:'Use after Dispatch has classified the work; ambiguous tasks remain unassigned.', schedule:'On-demand / task-driven', mode:'on-demand' },
  { name:'Recap Riley', image:P+'-39961431_tOR.jpg', summary:'Weekly client updates, drafted.', purpose:'Drafts client-facing recaps from verified project activity and CRM identity.', use:'Use for account updates; verify recipients and facts before sending.', schedule:'Weekly workflow', mode:'scheduled' },
  { name:'Pulse Porter', image:P+'-39961430_gQJ.jpg', summary:'Client delivery signals, daily.', purpose:'Scores observable delivery activity and surfaces accounts that may need attention.', use:'Treat it as a delivery indicator, not a complete relationship-health score.', schedule:'Daily workflow', mode:'scheduled' },
  { name:'Inbox Intel', image:P+'-39961429_dNs.jpg', summary:'Emails become tasks, automatically.', purpose:'Owns routine email-to-task processing, neutral acknowledgment drafts and deduplication.', use:'Ambiguous messages enter Needs Review; strategic or sensitive threads enter Executive Review.', schedule:'Weekdays at 9 AM, noon, 3 PM and 5 PM', mode:'scheduled' },
  { name:'Summary Sam', image:P+'-39961404_Rch.jpg', summary:'Weekly Audra task digests.', purpose:'Compiles a focused digest of Audra-related task activity.', use:'Use for stakeholder visibility and follow-up on blocked or aging work.', schedule:'Weekly workflow', mode:'scheduled' },
  { name:'Compliance Cody', image:P+'-39961400_q4m.jpg', summary:'Entity deadline watchdog.', purpose:'Monitors legal-entity, filing and compliance deadlines.', use:'Use as an internal alerting layer; verify official deadlines before filing.', schedule:'Recurring compliance monitoring', mode:'scheduled' },
  { name:'Roast Rae', image:P+'-39961170_Yjs.jpg', summary:'Your Monday morning roast.', purpose:'Provides a humorous internal review of habits and unfinished priorities.', use:'Use for a light weekly reset, never for client-facing communication.', schedule:'Monday workflow', mode:'scheduled' },
  { name:"Dante's Brain Dump", image:P+'-39922609_9ZP.jpg', summary:'Messages become organized daily actions.', purpose:'Converts unstructured thoughts into actionable daily pages.', use:'Send raw notes or a voice transcript, then review the resulting priorities.', schedule:'On-demand / daily capture', mode:'on-demand' },
  { name:'Morning Coffee', image:P+'-34175586.jpg', summary:'Daily operating brief.', purpose:'Combines the calendar, top priorities, overdue work, blockers and recommended first actions.', use:'Use as the operational start-of-day view; email remains with the dedicated email agents.', schedule:'Daily morning workflow', mode:'scheduled' },
  { name:'Growth Director', image:P+'-34175162_laa.jpg', summary:'Pipeline, clients, contacts.', purpose:'Analyzes the CRM pipeline and recommends growth priorities.', use:'Ask for pipeline analysis, account opportunities or an internal growth plan.', schedule:'On-demand', mode:'on-demand' },
  { name:"Dante's Email Executive Assistant", image:P+'-27912602.jpg', summary:'Executive inbox briefings and strategic replies.', purpose:'Acts as the Executive Inbox Advisor for decisions, relationships, opportunities and sensitive communication.', use:'Use the morning brief to decide what needs judgment; request substantive drafts by named thread.', schedule:'Weekdays at 8:00 AM', mode:'scheduled' },
];

export function SuperAgents() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | Agent['mode']>('all');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) =>
      (mode === 'all' || a.mode === mode) &&
      (!q || [a.name, a.summary, a.purpose, a.use, a.schedule].join(' ').toLowerCase().includes(q))
    );
  }, [query, mode]);

  return (
    <div class="flex flex-col h-full bg-[var(--color-bg)]">
      <PageHeader title="Super Agents" />
      <div class="flex-1 overflow-y-auto">
        <section class="relative overflow-hidden px-6 md:px-10 py-10 bg-gradient-to-br from-[#001d47] via-[#023E8A] to-[#0077B6] text-white">
          <Sparkles class="absolute right-8 top-5 text-white/10" size={150} />
          <p class="text-[11px] uppercase tracking-[0.22em] font-bold text-[#ABD3FF]">ImpactWorks · ClickUp AI Operations</p>
          <h1 class="mt-3 text-4xl md:text-6xl font-bold tracking-[-0.045em] leading-[0.96] max-w-3xl">Meet the agent workforce.</h1>
          <p class="mt-5 text-sm md:text-base text-blue-100 max-w-2xl leading-7">A practical directory of every active ClickUp agent: what it does, how it should be used, and when it runs.</p>
          <div class="mt-7 flex gap-3 flex-wrap">
            <Metric value={agents.length} label="Active agents" />
            <Metric value={agents.filter(a => a.mode === 'scheduled').length} label="Scheduled" />
            <Metric value={agents.filter(a => a.mode === 'on-demand').length} label="On-demand" />
          </div>
        </section>

        <div class="p-6 md:p-8 max-w-[1500px] mx-auto">
          <div class="flex flex-col md:flex-row gap-3 mb-6">
            <label class="relative flex-1">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
              <input value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} placeholder="Search agents, functions, or use cases…" class="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-accent)]" />
            </label>
            <select value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as any)} class="px-4 py-3 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)] text-sm">
              <option value="all">All agents</option><option value="scheduled">Scheduled</option><option value="on-demand">On-demand</option>
            </select>
          </div>

          <div class="grid gap-4" style={{ gridTemplateColumns:'repeat(auto-fill,minmax(330px,1fr))' }}>
            {filtered.map((a) => <AgentCard key={a.name} agent={a} />)}
          </div>
          {!filtered.length && <div class="text-center py-20 text-[var(--color-text-muted)]">No matching agents.</div>}
        </div>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value:number; label:string }) {
  return <div class="rounded-xl border border-white/20 bg-white/10 px-4 py-3 min-w-28"><b class="block text-xl">{value}</b><span class="text-[11px] text-blue-100">{label}</span></div>;
}

function AgentCard({ agent:a }: { agent:Agent }) {
  return (
    <article class="rounded-2xl bg-[var(--color-card)] border border-[var(--color-border)] p-5 shadow-sm">
      <div class="flex gap-3 items-center">
        <img src={a.image} alt="" class="w-16 h-16 rounded-2xl object-cover bg-[var(--color-elevated)]" loading="lazy" />
        <div class="min-w-0">
          <h2 class="font-semibold text-[15px] text-[var(--color-text)] truncate">{a.name}</h2>
          <p class="text-[12px] text-[var(--color-text-muted)] mt-0.5">{a.summary}</p>
          <span class="inline-flex items-center gap-1 mt-2 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] px-2 py-1 text-[10px] font-bold">
            {a.mode === 'scheduled' ? <CalendarClock size={11}/> : <Zap size={11}/>} {a.mode === 'scheduled' ? 'Scheduled' : 'On-demand'}
          </span>
        </div>
      </div>
      <Info label="What it does" text={a.purpose} />
      <Info label="How to use it" text={a.use} />
      <div class="mt-4 pt-4 border-t border-[var(--color-border)]">
        <div class="text-[9px] uppercase tracking-[0.16em] font-bold text-[var(--color-accent)] mb-1.5">Schedule</div>
        <div class="rounded-lg bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">{a.schedule}</div>
      </div>
    </article>
  );
}

function Info({ label, text }: { label:string; text:string }) {
  return <div class="mt-4 pt-4 border-t border-[var(--color-border)]"><div class="text-[9px] uppercase tracking-[0.16em] font-bold text-[var(--color-accent)] mb-1.5">{label}</div><p class="text-[12px] leading-5 text-[var(--color-text-muted)]">{text}</p></div>;
}
