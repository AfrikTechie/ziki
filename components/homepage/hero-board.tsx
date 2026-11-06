"use client";

import { useState } from 'react';

type AgentState = 'working' | 'implemented' | 'queued';
type ActionKind = 'preview' | 'approve' | 'review' | 'live';

type Row = {
  id: string;
  score: number;
  title: string;
  meta: string;
  agents: { count: number; state: AgentState };
  actions: { label: string; kind: ActionKind }[];
};

type Tab = { key: string; label: string; count: number; rows: Row[] };

const preview = { label: 'Preview', kind: 'preview' } as const;
const approve = { label: 'Approve', kind: 'approve' } as const;

const tabs: Tab[] = [
  {
    key: 'app',
    label: 'Your App',
    count: 23,
    rows: [
      { id: '#412', score: 8, title: 'One-click checkout with saved cards', meta: 'Feature · 6 verdicts', agents: { count: 34, state: 'working' }, actions: [{ label: 'In review', kind: 'review' }] },
      { id: '#411', score: 5, title: 'Dark mode across the dashboard', meta: 'Feature · 4 verdicts', agents: { count: 12, state: 'working' }, actions: [preview] },
      { id: '#407', score: 9, title: 'Offline sync for the mobile app', meta: 'Feature · 7 verdicts', agents: { count: 50, state: 'implemented' }, actions: [preview, approve] },
      { id: '#409', score: 3, title: 'Speed up search on large organisations', meta: 'Performance · 2 verdicts', agents: { count: 8, state: 'queued' }, actions: [approve] },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    count: 14,
    rows: [
      { id: '#318', score: 7, title: 'Launch campaign for Product Hunt', meta: 'Campaign · 5 verdicts', agents: { count: 21, state: 'working' }, actions: [preview] },
      { id: '#316', score: 6, title: 'SEO landing pages for 40 search terms', meta: 'Content · 4 verdicts', agents: { count: 40, state: 'implemented' }, actions: [preview, approve] },
      { id: '#311', score: 5, title: 'Weekly newsletter for new releases', meta: 'Email · 3 verdicts', agents: { count: 6, state: 'implemented' }, actions: [{ label: 'Live', kind: 'live' }] },
      { id: '#309', score: 4, title: 'Find and reach 500 early-adopter teams', meta: 'Outreach · 3 verdicts', agents: { count: 18, state: 'queued' }, actions: [approve] },
    ],
  },
  {
    key: 'security',
    label: 'Security',
    count: 9,
    rows: [
      { id: '#205', score: 9, title: 'Penetration test of sign-in and sessions', meta: 'Audit · 6 verdicts', agents: { count: 16, state: 'working' }, actions: [{ label: 'In review', kind: 'review' }] },
      { id: '#203', score: 8, title: 'Patch 3 vulnerable dependencies', meta: 'Dependencies · 5 verdicts', agents: { count: 9, state: 'implemented' }, actions: [preview, approve] },
      { id: '#201', score: 6, title: 'Rate-limit the public API', meta: 'Hardening · 4 verdicts', agents: { count: 5, state: 'implemented' }, actions: [{ label: 'Live', kind: 'live' }] },
      { id: '#198', score: 5, title: 'Rotate keys and move secrets to a vault', meta: 'Hardening · 3 verdicts', agents: { count: 4, state: 'queued' }, actions: [approve] },
    ],
  },
];

const actionIcon: Record<ActionKind, string> = { preview: '◉', approve: '↑', review: '•', live: '●' };

/** The interactive board in the homepage hero. */
export function HeroBoard() {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <div className="th-app">
      <div className="th-tabs" role="tablist" aria-label="Example Ziki board">
        {tabs.map((item, index) => (
          <button
            className={index === active ? 'th-tab active' : 'th-tab'}
            type="button"
            role="tab"
            id={`hero-tab-${item.key}`}
            aria-selected={index === active}
            aria-controls="hero-board-panel"
            key={item.key}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              const next = (active + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
              setActive(next);
              document.getElementById(`hero-tab-${tabs[next].key}`)?.focus();
            }}
            tabIndex={index === active ? 0 : -1}
          >
            <span><b>{item.label}</b> {item.count}</span><i /><s />
          </button>
        ))}
      </div>
      <div className="th-board" role="tabpanel" id="hero-board-panel" aria-labelledby={`hero-tab-${tab.key}`}>
        <div className="th-toolbar">
          <span className="th-tool">+ Add task</span>
        </div>
        <div className="th-table" key={tab.key}>
          <div className="th-row th-head"><span>Score</span><span>Task</span><span>Agents</span><span>Status</span></div>
          {tab.rows.map((row) => (
            <div className="th-row" key={row.id}>
              <span className="th-score">▲ {row.score}</span>
              <span className="th-idea"><b>{row.title}</b><small>{row.id} · {row.meta}</small></span>
              <span className={`th-agents th-agents-${row.agents.state}`}><i />{row.agents.count} {row.agents.state}</span>
              <span className="th-status">
                {row.actions.map((action) => (
                  <em className={`th-action th-action-${action.kind}`} key={action.label}>{actionIcon[action.kind]} {action.label}</em>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="th-showing">Showing <b>1–4</b> of <b>{tab.count}</b> tasks</p>
      </div>
    </div>
  );
}
