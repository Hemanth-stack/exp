'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, use } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { FileExplorer } from '@/components/file-explorer';
import { CodeViewer } from '@/components/code-viewer';
import { 
  ArrowLeft, 
  Send, 
  Loader2, 
  RefreshCw,
  ExternalLink,
  Monitor,
  Tablet,
  Smartphone,
  Play,
  Square,
  Rocket,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  modified?: boolean;
}

const deviceSizes = {
  desktop: { width: '100%', label: 'Desktop' },
  tablet: { width: '768px', label: 'Tablet' },
  mobile: { width: '375px', label: 'Mobile' },
};

export default function ProjectBuilderPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  
  // Unwrap params using React.use()
  const unwrappedParams = use(params);
  const projectId = unwrappedParams.projectId;
  
  const [project, setProject] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewKey, setPreviewKey] = useState(0);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileLanguage, setFileLanguage] = useState<string>('text');
  const [leftWidth] = useState(30);
  const [centerWidth] = useState(40);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetchProject();
      fetchFiles();
      checkPreviewStatus();
    }
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
        toast({
          title: 'Error',
          description: 'Project not found',
          variant: 'destructive',
        });
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Error fetching project:', error);
    }
  };

  const fetchFiles = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/files`);
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    }
  };

  const fetchFileContent = async (filePath: string) => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`
      );
      if (response.ok) {
        const data = await response.json();
        setFileContent(data.content);
        setFileLanguage(data.language);
        setSelectedFile(filePath);
      }
    } catch (error) {
      console.error('Error fetching file content:', error);
      toast({
        title: 'Error',
        description: 'Failed to load file',
        variant: 'destructive',
      });
    }
  };

  const checkPreviewStatus = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/preview`);
      if (response.ok) {
        const data = await response.json();
        setPreviewStatus(data.status);
        setPreviewUrl(data.url);
      }
    } catch (error) {
      console.error('Error checking preview status:', error);
    }
  };

  const startPreview = async () => {
    setPreviewStatus('starting');
    toast({
      title: 'Starting preview',
      description: 'Installing dependencies and starting server... This may take 20-30 seconds on first start.',
    });
    
    try {
      const response = await fetch(`/api/projects/${projectId}/preview`, {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        setPreviewUrl(data.preview.url);
        
        // Poll for status until running
        pollPreviewStatus();
      } else {
        setPreviewStatus('error');
        toast({
          title: 'Error',
          description: 'Failed to start preview',
          variant: 'destructive',
        });
      }
    } catch (error) {
      setPreviewStatus('error');
      toast({
        title: 'Error',
        description: 'Failed to start preview',
        variant: 'destructive',
      });
    }
  };

  const pollPreviewStatus = async () => {
    const maxAttempts = 30; // 30 attempts * 2 seconds = 60 seconds max
    let attempts = 0;
    
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/preview`);
        if (response.ok) {
          const data = await response.json();
          setPreviewStatus(data.status);
          
          if (data.status === 'running') {
            setPreviewKey(prev => prev + 1);
            toast({
              title: 'Preview ready',
              description: 'Your app is now running',
            });
            return;
          } else if (data.status === 'error') {
            toast({
              title: 'Preview error',
              description: 'Container failed to start properly',
              variant: 'destructive',
            });
            return;
          }
        }
        
        // Continue polling if still starting
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          toast({
            title: 'Preview timeout',
            description: 'Taking longer than expected. Check container logs.',
            variant: 'destructive',
          });
          setPreviewStatus('error');
        }
      } catch (error) {
        console.error('Error polling preview status:', error);
      }
    };
    
    // Start polling after 2 seconds
    setTimeout(poll, 2000);
  };

  const stopPreview = async () => {
    try {
      await fetch(`/api/projects/${projectId}/preview`, {
        method: 'DELETE',
      });
      setPreviewStatus('stopped');
      setPreviewUrl(null);
      toast({
        title: 'Preview stopped',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to stop preview',
        variant: 'destructive',
      });
    }
  };

  const refreshPreview = () => {
    setPreviewKey(prev => prev + 1);
    toast({
      title: 'Preview refreshed',
    });
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsStreaming(true);
    setCurrentMessage('');

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      createdAt: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);

    try {
      abortControllerRef.current = new AbortController();
      
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'text' && data.content) {
                assistantContent += data.content;
                setCurrentMessage(assistantContent);
              } else if (data.type === 'done') {
                const assistantMessage: Message = {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: assistantContent,
                  createdAt: new Date(),
                };
                setMessages(prev => [...prev, assistantMessage]);
                setCurrentMessage('');
                fetchFiles();
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        toast({
          title: 'Error',
          description: 'Failed to send message',
          variant: 'destructive',
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    toast({
      title: 'Deploying',
      description: 'Building and deploying your app...',
    });

    try {
      const response = await fetch(`/api/projects/${projectId}/deploy`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setDeploymentUrl(data.deployment.url);
        toast({
          title: 'Deployed successfully',
          description: `Your app is live at ${data.deployment.url}`,
        });
      } else {
        const error = await response.json();
        toast({
          title: 'Deployment failed',
          description: error.error || 'Failed to deploy',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to deploy project',
        variant: 'destructive',
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleAskAIToModify = (filePath: string) => {
    setInputValue(`Please modify the file ${filePath}:\n\n`);
  };

  if (status === 'loading' || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const rightWidth = 100 - leftWidth - centerWidth;

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-semibold">{project.name}</h1>
              <p className="text-sm text-muted-foreground">{project.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {deploymentUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(deploymentUrl, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Live
              </Button>
            )}
            <Button onClick={handleDeploy} disabled={isDeploying} size="sm">
              {isDeploying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-2" />
                  Deploy
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div className="border-r bg-card" style={{ width: `${leftWidth}%` }}>
          <div className="h-full flex flex-col">
            <div className="p-3 border-b">
              <h2 className="font-semibold">AI Assistant</h2>
            </div>
            
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
                
                {currentMessage && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg p-3 bg-muted">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {currentMessage}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
                
                {isStreaming && !currentMessage && (
                  <div className="flex justify-start">
                    <div className="rounded-lg p-3 bg-muted">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="p-4 border-t">
              <div className="flex gap-2">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder="Ask AI to build features..."
                  disabled={isStreaming}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={isStreaming || !inputValue.trim()}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Center Panel - Live Preview */}
        <div className="bg-background" style={{ width: `${centerWidth}%` }}>
          <div className="h-full flex flex-col">
            <div className="p-2 border-b flex items-center justify-between bg-card">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Live Preview</h2>
                <div className="flex gap-1">
                  {(['desktop', 'tablet', 'mobile'] as const).map((device) => (
                    <Button
                      key={device}
                      variant={previewDevice === device ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setPreviewDevice(device)}
                    >
                      {device === 'desktop' && <Monitor className="h-4 w-4" />}
                      {device === 'tablet' && <Tablet className="h-4 w-4" />}
                      {device === 'mobile' && <Smartphone className="h-4 w-4" />}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshPreview}
                  disabled={previewStatus !== 'running'}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                {previewUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(previewUrl, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
                {previewStatus === 'running' ? (
                  <Button variant="outline" size="sm" onClick={stopPreview}>
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </Button>
                ) : (
                  <Button size="sm" onClick={startPreview} disabled={previewStatus === 'starting'}>
                    {previewStatus === 'starting' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Start
                  </Button>
                )}
              </div>
            </div>
            
            <div className="flex-1 flex items-center justify-center bg-muted/20">
              {previewStatus === 'running' && previewUrl ? (
                <div
                  className="h-full bg-white transition-all duration-300"
                  style={{ width: deviceSizes[previewDevice].width }}
                >
                  <iframe
                    key={previewKey}
                    ref={iframeRef}
                    src={previewUrl}
                    className="w-full h-full border-0"
                    title="Preview"
                  />
                </div>
              ) : (
                <div className="text-center p-8">
                  <p className="text-muted-foreground mb-4">
                    {previewStatus === 'starting' ? 'Starting preview...' : 'Preview not running'}
                  </p>
                  {previewStatus !== 'starting' && (
                    <Button onClick={startPreview}>
                      <Play className="h-4 w-4 mr-2" />
                      Start Preview
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Files & Code */}
        <div className="border-l bg-card" style={{ width: `${rightWidth}%` }}>
          <div className="h-full flex flex-col">
            {!selectedFile ? (
              <FileExplorer
                files={files}
                selectedFile={selectedFile}
                onFileSelect={fetchFileContent}
              />
            ) : (
              <>
                <div className="flex-1 overflow-hidden">
                  <CodeViewer
                    code={fileContent}
                    language={fileLanguage}
                    filePath={selectedFile}
                    onAskAI={handleAskAIToModify}
                  />
                </div>
                <div className="p-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedFile(null)}
                    className="w-full"
                  >
                    Back to Files
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
