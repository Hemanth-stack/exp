'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, use } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  ArrowLeft, 
  Send, 
  StopCircle, 
  Loader2, 
  Wrench, 
  CheckCircle, 
  XCircle,
  Terminal,
  FileText,
  GitBranch,
  Package
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  createdAt: Date;
}

interface ToolResultData {
  success?: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

interface ToolResult {
  id: string;
  result: ToolResultData;
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status?: 'running' | 'success' | 'error';
  result?: ToolResultData;
}

interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool?: ToolCall;
  tool_use_id?: string;
  result?: ToolResultData;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  conversationId?: string;
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const [project, setProject] = useState<{
    id: string;
    name: string;
    description?: string;
    framework: string;
    status: string;
  } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentTools, setCurrentTools] = useState<ToolCall[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetchProject();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentMessage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchProject = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      } else {
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Error fetching project:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;

    const userMessage = inputValue.trim();
    setInputValue('');

    // Add user message immediately
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Start streaming
    setIsStreaming(true);
    setCurrentMessage('');
    setCurrentTools([]);

    try {
      abortControllerRef.current = new AbortController();
      
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No response body');

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
              const event: StreamEvent = JSON.parse(line.slice(6));
              handleStreamEvent(event);
            } catch (e) {
              console.error('Error parsing SSE:', e);
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Error sending message:', error);
        setCurrentMessage('Error: ' + error.message);
      }
    } finally {
      finalizeMessage();
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStreamEvent = (event: StreamEvent) => {
    switch (event.type) {
      case 'text':
        setCurrentMessage(prev => prev + event.content);
        break;

      case 'tool_use':
        if (event.tool) {
          setCurrentTools(prev => [
            ...prev,
            { ...event.tool!, status: 'running' },
          ]);
        }
        break;

      case 'tool_result':
        if (event.tool_use_id) {
          setCurrentTools(prev =>
            prev.map(tool =>
              tool.id === event.tool_use_id
                ? {
                    ...tool,
                    status: event.result?.success ? 'success' : 'error',
                    result: event.result,
                  }
                : tool
            )
          );
        }
        break;

      case 'done':
        if (event.usage) {
          setTokenUsage({
            input: event.usage.input_tokens,
            output: event.usage.output_tokens,
          });
        }
        if (event.conversationId) {
          setConversationId(event.conversationId);
        }
        break;

      case 'error':
        setCurrentMessage(prev => prev + '\n\nError: ' + event.error);
        break;
    }
  };

  const finalizeMessage = () => {
    if (currentMessage || currentTools.length > 0) {
      const assistantMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: currentMessage,
        toolCalls: currentTools.length > 0 ? currentTools : undefined,
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      setCurrentMessage('');
      setCurrentTools([]);
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'read_file':
      case 'write_file':
      case 'edit_file':
      case 'delete_file':
        return <FileText className="h-4 w-4" />;
      case 'execute_command':
        return <Terminal className="h-4 w-4" />;
      case 'git_status':
      case 'git_commit':
      case 'git_log':
      case 'git_diff':
        return <GitBranch className="h-4 w-4" />;
      case 'npm_install':
        return <Package className="h-4 w-4" />;
      default:
        return <Wrench className="h-4 w-4" />;
    }
  };

  if (status === 'loading' || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{project.name}</h1>
              <p className="text-sm text-muted-foreground">{project.description}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <span>Tokens: {tokenUsage.input + tokenUsage.output}</span>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 container mx-auto px-4 py-4 flex flex-col max-w-5xl">
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4 pb-4">
            {messages.length === 0 && !isStreaming && (
              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle>Welcome to AI Assistant</CardTitle>
                  <CardDescription>
                    I can help you build and modify your project. Try asking me to:
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>Create new files or components</li>
                      <li>Modify existing code</li>
                      <li>Install npm packages</li>
                      <li>Run commands and tests</li>
                      <li>Manage git operations</li>
                      <li>Search and analyze your codebase</li>
                    </ul>
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            {messages.map(message => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <Card className={`max-w-[80%] ${message.role === 'user' ? 'bg-primary text-primary-foreground' : ''}`}>
                  <CardContent className="pt-4">
                    {message.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <>
                        {message.content && (
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        )}
                        
                        {message.toolCalls && message.toolCalls.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {message.toolCalls.map((tool, idx) => (
                              <div
                                key={`${tool.id}-${idx}`}
                                className="flex items-start space-x-2 p-3 rounded-lg bg-muted/50 border"
                              >
                                <div className="mt-0.5">
                                  {tool.status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
                                  {tool.status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                                  {tool.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                                  {!tool.status && getToolIcon(tool.name)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center space-x-2">
                                    <code className="text-xs font-mono">{tool.name}</code>
                                  </div>
                                  {Object.keys(tool.input).length > 0 && (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      <pre className="overflow-x-auto">{JSON.stringify(tool.input, null, 2)}</pre>
                                    </div>
                                  )}
                                  {tool.result && (
                                    <div className="mt-2 text-xs">
                                      {tool.result.success ? (
                                        <div className="text-green-600 dark:text-green-400">
                                          {tool.result.message || 'Success'}
                                        </div>
                                      ) : (
                                        <div className="text-red-600 dark:text-red-400">
                                          {tool.result.error || 'Error'}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            ))}

            {/* Current streaming message */}
            {isStreaming && (currentMessage || currentTools.length > 0) && (
              <div className="flex justify-start">
                <Card className="max-w-[80%]">
                  <CardContent className="pt-4">
                    {currentMessage && (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {currentMessage}
                        </ReactMarkdown>
                      </div>
                    )}
                    
                    {currentTools.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {currentTools.map((tool, idx) => (
                          <div
                            key={`${tool.id}-${idx}`}
                            className="flex items-start space-x-2 p-3 rounded-lg bg-muted/50 border"
                          >
                            <div className="mt-0.5">
                              {tool.status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
                              {tool.status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                              {tool.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                              {!tool.status && getToolIcon(tool.name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <code className="text-xs font-mono">{tool.name}</code>
                              </div>
                              {Object.keys(tool.input).length > 0 && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  <pre className="overflow-x-auto">{JSON.stringify(tool.input, null, 2)}</pre>
                                </div>
                              )}
                              {tool.result && (
                                <div className="mt-2 text-xs">
                                  {tool.result.success ? (
                                    <div className="text-green-600 dark:text-green-400">
                                      {tool.result.message || 'Success'}
                                    </div>
                                  ) : (
                                    <div className="text-red-600 dark:text-red-400">
                                      {tool.result.error || 'Error'}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t pt-4">
          <div className="flex space-x-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask me to build something..."
              disabled={isStreaming}
              className="flex-1"
            />
            {isStreaming ? (
              <Button onClick={handleStopGeneration} variant="destructive">
                <StopCircle className="h-4 w-4 mr-2" />
                Stop
              </Button>
            ) : (
              <Button onClick={handleSendMessage} disabled={!inputValue.trim()}>
                <Send className="h-4 w-4 mr-2" />
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
