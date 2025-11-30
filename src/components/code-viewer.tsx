'use client';

import React, { useEffect, useState } from 'react';
import { createHighlighter, Highlighter, BundledLanguage } from 'shiki';
import { Button } from '@/components/ui/button';
import { Copy, Check, Sparkles } from 'lucide-react';

interface CodeViewerProps {
  code: string;
  language: string;
  filePath: string;
  onAskAI?: (file: string, code: string) => void;
}

export function CodeViewer({ code, language, filePath, onAskAI }: CodeViewerProps) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [html, setHtml] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [
        'javascript',
        'typescript',
        'jsx',
        'tsx',
        'json',
        'css',
        'html',
        'markdown',
        'python',
        'bash',
        'yaml',
      ],
    }).then(setHighlighter);
  }, []);

  useEffect(() => {
    if (highlighter && code) {
      try {
        const html = highlighter.codeToHtml(code, {
          lang: language as BundledLanguage,
          theme: 'github-dark',
        });
        setHtml(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        // Fallback to plain text
        setHtml(`<pre><code>${escapeHtml(code)}</code></pre>`);
      }
    }
  }, [highlighter, code, language]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAskAI = () => {
    onAskAI?.(filePath, code);
  };

  return (
    <div className="relative h-full flex flex-col">
      <div className="flex items-center justify-between p-2 border-b bg-muted/50">
        <div className="text-sm font-mono text-muted-foreground">{filePath}</div>
        <div className="flex gap-2">
          {onAskAI && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAskAI}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Ask AI to modify
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div
          className="code-viewer"
          dangerouslySetInnerHTML={{ __html: html }}
          style={{
            fontSize: '14px',
            lineHeight: '1.5',
          }}
        />
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
