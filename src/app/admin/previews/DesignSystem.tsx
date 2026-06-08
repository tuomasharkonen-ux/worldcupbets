'use client';

import { useState } from 'react';
import { Trophy, Save, Lock, Ticket, Coins, Sparkles, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Flag } from '@/components/ui/flag';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { StakeSelector } from '@/app/matches/[matchId]/StakeSelector';
import { MOCK_STAKE } from '../mock';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-xl font-bold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, varName, text = false }: { name: string; varName: string; text?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div
        className="h-14 rounded-xl border border-border"
        style={{ background: text ? 'var(--color-surface)' : `var(${varName})` }}
      >
        {text && (
          <div className="flex h-full items-center justify-center font-display font-bold" style={{ color: `var(${varName})` }}>
            Aa
          </div>
        )}
      </div>
      <p className="text-xs text-muted">{name}</p>
      <p className="font-mono text-[0.65rem] text-subtle">{varName}</p>
    </div>
  );
}

export function DesignSystem() {
  return (
    <main className="mx-auto max-w-4xl space-y-12 px-6 py-10">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-primary text-on-primary shadow-[0_4px_0_0_var(--color-primary-press)]">
          <Sparkles className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">Design system</h1>
          <p className="text-sm text-muted">Tokens & components, live from the real source.</p>
        </div>
      </div>

      {/* Colours */}
      <Section title="Surfaces & colours">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Swatch name="Background" varName="--color-background" />
          <Swatch name="Surface" varName="--color-surface" />
          <Swatch name="Surface 2" varName="--color-surface-2" />
          <Swatch name="Surface 3" varName="--color-surface-3" />
          <Swatch name="Primary" varName="--color-primary" />
          <Swatch name="Primary bright" varName="--color-primary-bright" />
          <Swatch name="Accent" varName="--color-accent" />
          <Swatch name="Points (gold)" varName="--color-points" />
          <Swatch name="Success" varName="--color-success" />
          <Swatch name="Danger" varName="--color-danger" />
          <Swatch name="Foreground" varName="--color-foreground" text />
          <Swatch name="Muted" varName="--color-muted" text />
        </div>
      </Section>

      {/* Typography */}
      <Section title="Typography">
        <Card variant="glass" padding="lg" className="space-y-3">
          <p className="font-display text-3xl font-bold text-foreground">Carter One display — rounded &amp; bubbly</p>
          <p className="font-sans text-base text-foreground">Plus Jakarta Sans — body &amp; UI text, highly legible at small sizes.</p>
          <p className="font-mono text-base tabular-nums text-foreground">Geist Mono 0123456789 — scores &amp; numerics</p>
          <p className="text-glow font-display text-2xl font-bold text-foreground">Glow heading utility</p>
        </Card>
      </Section>

      {/* Buttons */}
      <Section title="Buttons">
        <Card variant="glass" padding="lg" className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="points">Points</Button>
            <Button variant="success">Success</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="glass">Glass</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm"><Ticket aria-hidden />Small</Button>
            <Button size="md"><Save aria-hidden />Medium</Button>
            <Button size="lg"><Trophy aria-hidden />Large</Button>
            <Button size="icon" aria-label="Icon"><Plus aria-hidden /></Button>
            <Button disabled><Lock aria-hidden />Disabled</Button>
          </div>
        </Card>
      </Section>

      {/* Badges */}
      <Section title="Badges">
        <Card variant="glass" padding="lg" className="flex flex-wrap items-center gap-3">
          <Badge variant="open">Open</Badge>
          <Badge variant="locked"><Lock aria-hidden />Locked</Badge>
          <Badge variant="finished">FT</Badge>
          <Badge variant="points"><Sparkles aria-hidden />+15 pts</Badge>
          <Badge variant="primary"><Ticket aria-hidden />Add picks</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="primary" size="sm">25¢ staked</Badge>
        </Card>
      </Section>

      {/* Cards */}
      <Section title="Cards">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card variant="glass">
            <CardTitle>Glass</CardTitle>
            <p className="mt-1 text-sm text-muted">Frosted, the default surface.</p>
          </Card>
          <Card variant="solid">
            <CardTitle>Solid</CardTitle>
            <p className="mt-1 text-sm text-muted">Opaque, for dense content.</p>
          </Card>
          <Card variant="well">
            <CardTitle>Well</CardTitle>
            <p className="mt-1 text-sm text-muted">Inset nested section.</p>
          </Card>
        </div>
      </Section>

      {/* Inputs */}
      <Section title="Inputs">
        <Card variant="glass" padding="lg" className="grid gap-4 sm:grid-cols-2">
          <Input placeholder="Text input" />
          <Input type="number" placeholder="0" className="text-center font-mono" />
          <Input disabled placeholder="Disabled" />
          <Input defaultValue="Pre-filled value" />
        </Card>
      </Section>

      {/* Flags */}
      <Section title="Flags">
        <Card variant="glass" padding="lg" className="flex flex-wrap items-center gap-4">
          {['Brazil', 'Argentina', 'France', 'Spain', 'Germany', 'England', 'Netherlands', 'Japan', 'Morocco', 'United States'].map(n => (
            <span key={n} className="flex items-center gap-1.5 text-sm text-muted">
              <Flag name={n} size="lg" />
              {n}
            </span>
          ))}
        </Card>
      </Section>

      {/* Stake selector */}
      <Section title="Stake selector">
        <Card variant="glass" padding="lg">
          <StakeSelector name="ds_stake" tiers={MOCK_STAKE.tiers} capCoins={MOCK_STAKE.capCoins} balance={MOCK_STAKE.balance} />
        </Card>
      </Section>

      {/* Dialog */}
      <Section title="Dialog">
        <Card variant="glass" padding="lg">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="glass"><Coins aria-hidden />Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Modal title</DialogTitle>
              <DialogDescription className="mt-1">
                Radix-backed glass dialog with focus trap, Escape-to-close and scroll lock.
              </DialogDescription>
              <div className="mt-4 flex justify-end">
                <Button size="sm">Got it</Button>
              </div>
            </DialogContent>
          </Dialog>
        </Card>
      </Section>

      {/* Motion */}
      <MotionDemo />
    </main>
  );
}

function MotionDemo() {
  const [key, setKey] = useState(0);
  return (
    <Section title="Motion (recap choreography)">
      <Card variant="glass" padding="lg" className="space-y-4">
        <Button variant="glass" size="sm" onClick={() => setKey(k => k + 1)}>Replay animations</Button>
        <div key={key} className="grid gap-3 sm:grid-cols-3">
          <div className="animate-rise-in rounded-xl bg-surface-2 px-4 py-3 text-sm text-foreground">rise-in</div>
          <div className="animate-hit-pop rounded-xl bg-[color-mix(in_oklab,var(--color-success)_18%,transparent)] px-4 py-3 text-sm text-success">hit-pop</div>
          <div className="animate-miss-shake rounded-xl bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)] px-4 py-3 text-sm text-danger">miss-shake</div>
        </div>
      </Card>
    </Section>
  );
}
