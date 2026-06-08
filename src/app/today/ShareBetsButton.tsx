'use client';

import { useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Copies a Wordle-style summary (the manager's slate, or their settled results) to
// the clipboard so it can be pasted into WhatsApp et al. The text is built by the
// caller and passed in whole; this component only handles the copy + the brief
// "Copied!" confirmation.
export function ShareBetsButton({ text, label = 'Share my bets' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older/insecure contexts: fall back to a hidden textarea + execCommand.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        return; // give up silently — nothing actionable for the user
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      type="button"
      variant="success"
      size="lg"
      onClick={handleCopy}
      className="mt-1 w-full"
      aria-live="polite"
    >
      {copied ? (
        <>
          <Check className="size-5" aria-hidden />
          Copied — paste & share!
        </>
      ) : (
        <>
          <Share2 className="size-5" aria-hidden />
          {label}
        </>
      )}
    </Button>
  );
}
