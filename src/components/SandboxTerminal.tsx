'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Terminal as TerminalIcon, 
  Play, 
  Loader2, 
  AlertCircle, 
  CheckCircle,
  Wrench,
  Trash2,
  ChevronRight,
  Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TerminalEntry {
  id: string;
  type: 'command' | 'output' | 'error' | 'info' | 'autofix';
  content: string;
  timestamp: Date;
  executionTime?: number;
  success?: boolean;
}

interface TerminalProps {
  sessionId: string;
  className?: string;
  onError?: (error: string) => void;
}

const EXAMPLE_COMMANDS = [
  { cmd: 'npm install', desc: 'Install dependencies' },
  { cmd: 'npm run build', desc: 'Build project' },
  { cmd: 'npm run lint', desc: 'Run linter' },
  { cmd: 'ls -la', desc: 'List files' },
  { cmd: 'cat package.json', desc: 'View package.json' },
  { cmd: 'npx tsc --noEmit', desc: 'Type check' },
];

export function SandboxTerminal({ sessionId, className = '', onError }: TerminalProps) {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [command, setCommand] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ command: string; description: string }>>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries are added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addEntry = useCallback((entry: Omit<TerminalEntry, 'id' | 'timestamp'>) => {
    setEntries(prev => [...prev, {
      ...entry,
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      timestamp: new Date(),
    }]);
  }, []);

  const executeCommand = async (cmd: string) => {
    if (!cmd.trim() || isExecuting) return;

    const trimmedCmd = cmd.trim();
    
    // Add to history
    setCommandHistory(prev => [...prev.filter(c => c !== trimmedCmd), trimmedCmd]);
    setHistoryIndex(-1);

    // Add command entry
    addEntry({ type: 'command', content: trimmedCmd });
    setCommand('');
    setIsExecuting(true);

    try {
      const response = await fetch(`/api/sandbox/${sessionId}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          command: trimmedCmd,
          autoFix: true,
        }),
      });

      const data = await response.json();

      if (!data.allowed) {
        addEntry({ 
          type: 'error', 
          content: data.reason || 'Command not allowed',
        });
        return;
      }

      if (data.result) {
        // Add output
        if (data.result.stdout) {
          addEntry({ 
            type: 'output', 
            content: data.result.stdout,
            executionTime: data.result.executionTime,
            success: data.result.success,
          });
        }
        
        // Add errors
        if (data.result.stderr) {
          addEntry({ 
            type: 'error', 
            content: data.result.stderr,
            success: false,
          });

          // Notify parent of error
          if (onError) {
            onError(data.result.stderr);
          }
        }

        // Show exit code if non-zero
        if (data.result.exitCode !== 0) {
          addEntry({
            type: 'info',
            content: `Exit code: ${data.result.exitCode}`,
          });
        }

        // Show auto-fix results if any
        if (data.autoFix?.attempts?.length > 0) {
          for (const attempt of data.autoFix.attempts) {
            addEntry({
              type: 'autofix',
              content: `🔧 Auto-fix: ${attempt.command}`,
              success: attempt.result.success,
            });
            if (attempt.result.stdout) {
              addEntry({ type: 'output', content: attempt.result.stdout });
            }
          }
          
          if (data.autoFix.resolved) {
            addEntry({
              type: 'info',
              content: '✅ Error automatically resolved!',
              success: true,
            });
          }
        }
      }

    } catch (error) {
      addEntry({ 
        type: 'error', 
        content: error instanceof Error ? error.message : 'Failed to execute command',
      });
    } finally {
      setIsExecuting(false);
      inputRef.current?.focus();
    }
  };

  const runAutoFix = async () => {
    setIsAutoFixing(true);
    addEntry({ type: 'info', content: '🔍 Analyzing container for errors...' });

    try {
      const response = await fetch(`/api/sandbox/${sessionId}/autofix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAttempts: 3 }),
      });

      const data = await response.json();

      if (data.suggestions?.length > 0) {
        setSuggestions(data.suggestions);
      }

      if (data.resolved) {
        addEntry({ 
          type: 'info', 
          content: '✅ All errors automatically resolved!',
          success: true,
        });

        for (const attempt of data.attempts || []) {
          addEntry({
            type: 'autofix',
            content: `✓ ${attempt.command}`,
            success: attempt.success,
          });
        }
      } else if (data.attempts?.length > 0) {
        addEntry({ 
          type: 'error', 
          content: '⚠️ Some errors could not be automatically resolved',
        });

        for (const attempt of data.attempts) {
          addEntry({
            type: 'autofix',
            content: `${attempt.success ? '✓' : '✗'} ${attempt.command}`,
            success: attempt.success,
          });
          if (attempt.error) {
            addEntry({ type: 'error', content: attempt.error });
          }
        }
      } else if (data.message) {
        addEntry({ type: 'info', content: data.message });
      }

    } catch (error) {
      addEntry({ 
        type: 'error', 
        content: error instanceof Error ? error.message : 'Auto-fix failed',
      });
    } finally {
      setIsAutoFixing(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand(command);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[commandHistory.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[commandHistory.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setCommand('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Simple tab completion for common commands
      const match = EXAMPLE_COMMANDS.find(c => c.cmd.startsWith(command));
      if (match) {
        setCommand(match.cmd);
      }
    }
  };

  const clearTerminal = () => {
    setEntries([]);
    setSuggestions([]);
  };

  const getEntryIcon = (entry: TerminalEntry) => {
    switch (entry.type) {
      case 'command':
        return <ChevronRight className="h-3 w-3 text-green-400" />;
      case 'error':
        return <AlertCircle className="h-3 w-3 text-red-400" />;
      case 'autofix':
        return entry.success 
          ? <CheckCircle className="h-3 w-3 text-green-400" />
          : <Wrench className="h-3 w-3 text-yellow-400" />;
      case 'info':
        return <Info className="h-3 w-3 text-blue-400" />;
      default:
        return null;
    }
  };

  return (
    <Card className={`bg-zinc-950 border-zinc-800 ${className}`}>
      <CardHeader className="py-3 px-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TerminalIcon className="h-4 w-4 text-green-400" />
            <CardTitle className="text-sm font-medium text-zinc-200">Terminal</CardTitle>
            <span className="text-xs px-2 py-0.5 rounded border border-zinc-700 text-zinc-400">
              {sessionId.slice(0, 8)}...
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={runAutoFix}
              disabled={isAutoFixing || isExecuting}
              className="h-7 text-xs"
            >
              {isAutoFixing ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Wrench className="h-3 w-3 mr-1" />
              )}
              Auto-Fix
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearTerminal}
              className="h-7 text-xs"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        {/* Output area */}
        <ScrollArea className="h-64" ref={scrollRef}>
          <div className="p-3 space-y-1 font-mono text-sm">
            {entries.length === 0 && (
              <div className="text-zinc-500 text-xs">
                <p>Welcome to the sandbox terminal. Type a command or try:</p>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {EXAMPLE_COMMANDS.slice(0, 4).map(({ cmd, desc }) => (
                    <button
                      key={cmd}
                      onClick={() => setCommand(cmd)}
                      className="text-left px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                    >
                      <span className="text-green-400">{cmd}</span>
                      <span className="text-zinc-600 ml-2">- {desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {entries.map((entry) => (
              <div 
                key={entry.id} 
                className={`flex items-start gap-2 ${
                  entry.type === 'command' ? 'text-green-400' :
                  entry.type === 'error' ? 'text-red-400' :
                  entry.type === 'autofix' ? 'text-yellow-400' :
                  entry.type === 'info' ? 'text-blue-400' :
                  'text-zinc-300'
                }`}
              >
                {getEntryIcon(entry)}
                <pre className="whitespace-pre-wrap break-all flex-1">{entry.content}</pre>
                {entry.executionTime && (
                  <span className="text-zinc-600 text-xs">{entry.executionTime}ms</span>
                )}
              </div>
            ))}
            
            {isExecuting && (
              <div className="flex items-center gap-2 text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Executing...</span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="border-t border-zinc-800 p-2">
            <p className="text-xs text-zinc-500 mb-1">Suggested fixes:</p>
            <div className="flex flex-wrap gap-1">
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  onClick={() => executeCommand(s.command)}
                  className="h-6 text-xs"
                  title={s.description}
                >
                  {s.command}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-zinc-800 p-2 flex items-center gap-2">
          <span className="text-green-400 font-mono">$</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isExecuting}
            placeholder="Enter command..."
            className="flex-1 bg-transparent border-none outline-none text-zinc-200 font-mono text-sm placeholder:text-zinc-600"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => executeCommand(command)}
            disabled={isExecuting || !command.trim()}
            className="h-7"
          >
            {isExecuting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default SandboxTerminal;
