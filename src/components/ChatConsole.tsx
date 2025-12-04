'use client';

import { useState, useRef, useEffect } from 'react';
import { 
  MessageSquare, 
  Bot, 
  Send, 
  Loader2, 
  Sparkles,
  ArrowRight,
  CheckCircle,
  FileCode,
  ListChecks,
  ChevronDown,
  ChevronUp,
  Info,
  Lightbulb,
  Square
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

export type ChatMode = 'chat' | 'agent';
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode?: ChatMode;
  timestamp: Date;
  filesCreated?: string[];
  isStreaming?: boolean;
}

interface Requirements {
  projectType?: string;
  pages?: string[];
  features?: string[];
  styling?: string;
  confirmed?: boolean;
}

interface ChatConsoleProps {
  projectId: string;
  conversationId: string | null;
  onConversationIdChange?: (id: string) => void;
  onFilesCreated?: (files: string[]) => void;
  onModeChange?: (mode: ChatMode) => void;
  className?: string;
}

const CHAT_MODE_SUGGESTIONS = [
  "I want to build a personal blog",
  "Help me create a portfolio website",
  "I need an e-commerce store",
  "Build me a landing page",
];

const AGENT_MODE_SUGGESTIONS = [
  "Start building the homepage",
  "Create the navigation component",
  "Add a contact form",
  "Implement the about page",
];

export function ChatConsole({
  projectId,
  conversationId,
  onConversationIdChange,
  onFilesCreated,
  onModeChange,
  className = '',
}: ChatConsoleProps) {
  const [mode, setMode] = useState<ChatMode>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamContent, setCurrentStreamContent] = useState('');
  const [requirements, setRequirements] = useState<Requirements>({});
  const [showRequirements, setShowRequirements] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom with proper timing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
      // Also scroll the scroll area container
      if (scrollAreaRef.current) {
        const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, currentStreamContent]);

  // Load conversation history on mount
  useEffect(() => {
    if (conversationId) {
      loadConversationHistory();
    } else {
      setIsLoadingHistory(false);
      // Add welcome message in chat mode
      addWelcomeMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, projectId]);

  // Notify parent of mode changes
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  const addWelcomeMessage = () => {
    const welcomeMessage: Message = {
      id: 'welcome',
      role: 'assistant',
      content: `👋 **Welcome to the Project Builder!**

I'm here to help you create your web application. Let's start by understanding what you want to build.

**💬 Chat Mode** (current) is for planning only:
- Discuss your requirements and features
- Plan the structure and design
- I will NOT write or modify any code

**🤖 Agent Mode** is for building:
- I will write actual code files
- Create, modify, and delete files
- Implement your planned features

*What would you like to build today?*`,
      mode: 'chat',
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
  };

  const loadConversationHistory = async () => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/chat/history?conversationId=${conversationId}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.messages?.length > 0) {
          const loadedMessages: Message[] = data.messages.map((msg: {
            id: string;
            role: 'user' | 'assistant';
            content: string;
            createdAt: string;
            toolResults?: { mode?: ChatMode; filesCreated?: string[] };
          }) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            mode: msg.toolResults?.mode,
            timestamp: new Date(msg.createdAt),
            filesCreated: msg.toolResults?.filesCreated,
          }));
          setMessages(loadedMessages);
          
          // Detect mode from last messages
          const lastAgentMsg = [...loadedMessages].reverse().find(m => m.mode);
          if (lastAgentMsg?.mode === 'agent') {
            setMode('agent');
          }
          
          // Extract requirements from history
          extractRequirementsFromHistory(loadedMessages);
        } else {
          addWelcomeMessage();
        }
      }
    } catch (error) {
      console.error('Failed to load conversation history:', error);
      addWelcomeMessage();
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const extractRequirementsFromHistory = (msgs: Message[]) => {
    const reqs: Requirements = {};
    
    for (const msg of msgs) {
      const content = msg.content.toLowerCase();
      
      // Simple extraction - the backend does more sophisticated analysis
      if (content.includes('blog')) reqs.projectType = 'blog';
      else if (content.includes('portfolio')) reqs.projectType = 'portfolio';
      else if (content.includes('e-commerce') || content.includes('store')) reqs.projectType = 'e-commerce';
      
      if (content.includes('contact')) {
        if (!reqs.pages) reqs.pages = [];
        if (!reqs.pages.includes('contact')) reqs.pages.push('contact');
      }
      if (content.includes('about')) {
        if (!reqs.pages) reqs.pages = [];
        if (!reqs.pages.includes('about')) reqs.pages.push('about');
      }
    }
    
    setRequirements(reqs);
  };

  const handleModeSwitch = (newMode: ChatMode) => {
    setMode(newMode);
    
    // Add system message about mode switch
    const modeMessage: Message = {
      id: `mode-${Date.now()}`,
      role: 'system',
      content: newMode === 'agent' 
        ? `🤖 **Switched to Agent Mode**\n\nI'll now start implementing your project. I can:\n- Create new files\n- Modify existing code\n- Delete files when needed\n\nTell me what to build!`
        : `💬 **Switched to Chat Mode**\n\nI'm now in planning mode. I will NOT write or modify any code.\n\nLet's discuss your ideas, requirements, and design. When ready to code, switch back to 🤖 Agent Mode.`,
      mode: newMode,
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, modeMessage]);
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      mode,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setCurrentStreamContent('');

    try {
      abortControllerRef.current = new AbortController();

      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          conversationId,
          mode,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantContent = '';
      const filesCreated: string[] = [];
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'text' && data.content) {
                assistantContent += data.content;
                setCurrentStreamContent(assistantContent);
              } else if (data.type === 'thinking' && data.content) {
                // Show thinking content in the stream (for visibility)
                // This is planning/reasoning output from the AI
                if (!assistantContent.includes(data.content)) {
                  assistantContent += `\n\n> ${data.content}\n\n`;
                  setCurrentStreamContent(assistantContent);
                }
              } else if (data.type === 'file_created' && data.file?.path) {
                filesCreated.push(data.file.path);
              } else if (data.type === 'requirements_updated' && data.requirements) {
                setRequirements(prev => ({ ...prev, ...data.requirements }));
              } else if (data.type === 'done') {
                if (data.conversationId) {
                  onConversationIdChange?.(data.conversationId);
                }

                const assistantMessage: Message = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: assistantContent,
                  mode,
                  timestamp: new Date(),
                  filesCreated,
                };

                setMessages(prev => [...prev, assistantMessage]);
                setCurrentStreamContent('');

                if (filesCreated.length > 0) {
                  onFilesCreated?.(filesCreated);
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: '❌ Sorry, something went wrong. Please try again.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      
      // If there was partial content, save it as a message
      if (currentStreamContent) {
        const partialMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: currentStreamContent + '\n\n*[Generation stopped]*',
          mode,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, partialMessage]);
        setCurrentStreamContent('');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Cmd/Ctrl + M to toggle mode
    if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
      e.preventDefault();
      handleModeSwitch(mode === 'chat' ? 'agent' : 'chat');
    }
    // Escape to stop generation
    if (e.key === 'Escape' && isLoading) {
      e.preventDefault();
      stopGeneration();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    textareaRef.current?.focus();
  };

  const suggestions = mode === 'chat' ? CHAT_MODE_SUGGESTIONS : AGENT_MODE_SUGGESTIONS;

  return (
    <Card className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header with Mode Toggle */}
      <CardHeader className="py-3 px-4 border-b flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-semibold">Project Builder</CardTitle>
          </div>
          
          {/* Mode Toggle */}
          <div className="flex items-center bg-muted rounded-lg p-1">
            <Button
              variant={mode === 'chat' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleModeSwitch('chat')}
              className="gap-1.5 h-7 text-xs"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </Button>
            <Button
              variant={mode === 'agent' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleModeSwitch('agent')}
              className="gap-1.5 h-7 text-xs"
            >
              <Bot className="h-3.5 w-3.5" />
              Agent
            </Button>
          </div>
        </div>
        
        {/* Mode Description */}
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={mode === 'chat' ? 'secondary' : 'default'} className="text-xs">
            {mode === 'chat' ? (
              <>
                <Lightbulb className="h-3 w-3 mr-1" />
                Planning Mode (Read-Only)
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3 mr-1" />
                Building Mode (Can Edit Files)
              </>
            )}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {mode === 'chat' 
              ? 'Discuss and plan - no code changes' 
              : 'AI will create and modify files'}
          </span>
        </div>
      </CardHeader>

      {/* Requirements Panel (Collapsible) */}
      {Object.keys(requirements).length > 0 && (
        <div className="border-b px-4 py-2 bg-muted/30">
          <button
            onClick={() => setShowRequirements(!showRequirements)}
            className="flex items-center justify-between w-full text-sm"
          >
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              <span className="font-medium">Project Requirements</span>
              {requirements.confirmed && (
                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Confirmed
                </Badge>
              )}
            </div>
            {showRequirements ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          
          {showRequirements && (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {requirements.projectType && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Type:</span>
                  <Badge variant="outline" className="text-xs capitalize">
                    {requirements.projectType}
                  </Badge>
                </div>
              )}
              {requirements.pages && requirements.pages.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">Pages:</span>
                  {requirements.pages.map(page => (
                    <Badge key={page} variant="outline" className="text-xs capitalize">
                      {page}
                    </Badge>
                  ))}
                </div>
              )}
              {requirements.features && requirements.features.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">Features:</span>
                  {requirements.features.map(feature => (
                    <Badge key={feature} variant="outline" className="text-xs capitalize">
                      {feature}
                    </Badge>
                  ))}
                </div>
              )}
              {requirements.styling && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Style:</span>
                  <Badge variant="outline" className="text-xs capitalize">
                    {requirements.styling}
                  </Badge>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages Area */}
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollAreaRef}>
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} mode={mode} />
            ))}
            
            {/* Streaming content */}
            {currentStreamContent && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: currentStreamContent,
                  timestamp: new Date(),
                  isStreaming: true,
                }}
                mode={mode}
              />
            )}
            
            {/* Extra space at bottom for proper scrolling */}
            <div ref={messagesEndRef} className="h-2" />
          </div>
        )}
      </ScrollArea>

      {/* Suggestions */}
      {messages.length <= 2 && !isLoading && (
        <div className="px-4 py-2 border-t bg-muted/20">
          <p className="text-xs text-muted-foreground mb-2">
            <Info className="h-3 w-3 inline mr-1" />
            Try asking:
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(suggestion)}
                className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t bg-muted/20">
        <div className="flex gap-3 items-end">
          {/* Left: Mode Toggle - Minimal Pill Switch */}
          <div 
            className="relative flex items-center bg-muted rounded-full p-0.5 h-10 flex-shrink-0"
            title={mode === 'chat' ? 'Chat Mode (Planning)' : 'Agent Mode (Building)'}
          >
            <div
              className={cn(
                "absolute h-9 w-9 bg-primary rounded-full transition-transform duration-200 ease-out",
                mode === 'agent' ? 'translate-x-9' : 'translate-x-0'
              )}
            />
            <button
              onClick={() => handleModeSwitch('chat')}
              className={cn(
                "relative z-10 w-9 h-9 flex items-center justify-center rounded-full transition-colors text-base",
                mode === 'chat' ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              title="Chat Mode - Plan your project"
            >
              💬
            </button>
            <button
              onClick={() => handleModeSwitch('agent')}
              className={cn(
                "relative z-10 w-9 h-9 flex items-center justify-center rounded-full transition-colors text-base",
                mode === 'agent' ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              title="Agent Mode - Build your project"
            >
              🤖
            </button>
          </div>

          {/* Center: Input */}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'chat'
                ? 'Describe what you want to build...'
                : 'Tell me what to implement next...'
            }
            className="min-h-[60px] max-h-[120px] resize-none flex-1"
            disabled={isLoading}
          />

          {/* Right: Send/Stop Button - Matching size */}
          {isLoading ? (
            <Button
              onClick={stopGeneration}
              variant="destructive"
              className="h-10 w-10 p-0 flex-shrink-0 rounded-full"
              title="Stop generation"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="h-10 w-10 p-0 flex-shrink-0 rounded-full"
              title="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        
        {/* Mode Switch Hint + Character Count + Keyboard Hints */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'chat' && requirements.projectType && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                Ready? Switch to <span className="font-medium">Agent Mode</span>
              </p>
            )}
            {mode === 'agent' && !requirements.projectType && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                Tip: Use <span className="font-medium">Chat Mode</span> to plan first
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className={cn(input.length > 45000 ? 'text-destructive' : '')}>
              {input.length > 0 ? `${input.length.toLocaleString()} chars` : ''}
            </span>
            <span className="hidden sm:inline opacity-60" title="Keyboard shortcuts">
              ⌘M mode · Enter send · Esc stop
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Format timestamp for display
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Message Bubble Component
function MessageBubble({ message, mode }: { message: Message; mode?: ChatMode }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="bg-muted/50 rounded-lg px-4 py-2 text-sm max-w-[90%]">
          <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">
            {message.content}
          </ReactMarkdown>
          <p className="text-[10px] text-muted-foreground/60 mt-1 text-center">
            {formatTime(message.timestamp)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3 group', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      
      <div className="flex flex-col">
        <div
          className={cn(
            'rounded-lg px-4 py-2 max-w-[85%] overflow-auto',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted'
          )}
        >
          <div className="prose prose-sm max-w-none break-words">
            <ReactMarkdown 
              className={cn(
                'prose prose-sm max-w-none',
                isUser ? 'prose-invert' : 'dark:prose-invert'
              )}
            >
              {message.content}
            </ReactMarkdown>
          </div>
          
          {/* Files created indicator - only show in agent mode */}
          {message.filesCreated && message.filesCreated.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/20">
              <p className="text-xs opacity-80 flex items-center gap-1">
                <FileCode className="h-3 w-3" />
                {message.filesCreated.length} file(s) {mode === 'agent' ? 'created/updated' : 'would be created'}
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {message.filesCreated.slice(0, 5).map((file) => (
                  <span key={file} className="text-xs px-1.5 py-0.5 bg-background/30 rounded">
                    {file.split('/').pop()}
                  </span>
                ))}
                {message.filesCreated.length > 5 && (
                  <span className="text-xs opacity-60">+{message.filesCreated.length - 5} more</span>
                )}
              </div>
            </div>
          )}
          
          {/* Streaming indicator */}
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
          )}
        </div>
        
        {/* Timestamp - show on hover */}
        <p className={cn(
          'text-[10px] text-muted-foreground/50 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity',
          isUser ? 'text-right mr-1' : 'ml-1'
        )}>
          {formatTime(message.timestamp)}
        </p>
      </div>
      
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
          <span className="text-xs font-medium text-primary-foreground">U</span>
        </div>
      )}
    </div>
  );
}

export default ChatConsole;
