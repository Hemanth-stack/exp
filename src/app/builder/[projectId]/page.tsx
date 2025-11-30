'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, use } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { FileExplorer } from '@/components/file-explorer';
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
  Eye,
  Code,
  Save,
  X,
  History,
  RotateCcw,
  Github,
  GitBranch,
  ChevronDown,
  ChevronUp,
  RefreshCcw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  filesCreated?: string[];  // Track files created by this message
  isCodeResponse?: boolean; // Flag for responses that generated code
  error?: boolean; // Flag for error responses
}

interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author_name: string;
}

interface GitHubStatus {
  isConnected: boolean;
  githubUsername?: string;
  repoUrl?: string;
  repoName?: string;
}

// Helper function to extract chat-friendly message (without full code blocks)
function formatChatMessage(content: string, filesCreated?: string[]): string {
  // Check if this is a code generation response
  const hasCodeBlock = /```[\s\S]*?```/.test(content);
  
  if (!hasCodeBlock) {
    return content;
  }
  
  // Extract just the description before the code block
  const beforeCode = content.split(/```/)[0].trim();
  
  // Build a clean message
  let cleanMessage = beforeCode || "I've generated the code for you.";
  
  // Add file info if available
  if (filesCreated && filesCreated.length > 0) {
    cleanMessage += `\n\n📁 **Files created/updated:**\n${filesCreated.map(f => `- \`${f}\``).join('\n')}`;
    cleanMessage += `\n\n✅ The code has been saved to your project. Switch to **Code Editor** view to see the changes.`;
  }
  
  return cleanMessage;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  modified?: boolean;
}

interface OpenTab {
  path: string;
  name: string;
  content: string;
  language: string;
  modified: boolean;
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
  
  const [project, setProject] = useState<{
    id: string;
    name: string;
    description?: string;
    framework: string;
    gitRepoPath?: string;
    status: string;
  } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewKey, setPreviewKey] = useState(0);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  
  // New states for toggle view and VS Code-like editing
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Git history states
  const [showGitHistory, setShowGitHistory] = useState(false);
  const [gitCommits, setGitCommits] = useState<GitCommit[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  
  // GitHub integration states
  const [githubStatus, setGithubStatus] = useState<GitHubStatus>({ isConnected: false });
  const [isPushingToGithub, setIsPushingToGithub] = useState(false);
  const [isSyncingToGithub, setIsSyncingToGithub] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetchProject();
      fetchFiles();
      fetchConversationHistory();
      checkPreviewStatus();
      fetchGitHubStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, projectId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentMessage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchGitHubStatus = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/github`);
      if (response.ok) {
        const data = await response.json();
        setGithubStatus(data);
      }
    } catch (error) {
      console.error('Error fetching GitHub status:', error);
    }
  };

  const fetchGitCommits = async () => {
    setIsLoadingCommits(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/git?action=log`);
      if (response.ok) {
        const data = await response.json();
        setGitCommits(data.commits || []);
      }
    } catch (error) {
      console.error('Error fetching git commits:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch commit history',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingCommits(false);
    }
  };

  const handleRevertToCommit = async (commitSha: string, commitMessage: string) => {
    if (!confirm(`Revert to commit: "${commitMessage}"? This will discard all changes after this commit.`)) {
      return;
    }
    
    setIsReverting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert', commitSha }),
      });

      if (response.ok) {
        toast({
          title: 'Reverted successfully',
          description: `Reverted to: ${commitMessage}`,
        });
        // Refresh files and preview
        fetchFiles();
        setOpenTabs([]);
        setActiveTab(null);
        if (previewStatus === 'running') {
          setTimeout(() => setPreviewKey(prev => prev + 1), 500);
        }
        fetchGitCommits();
      } else {
        throw new Error('Failed to revert');
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to revert to commit',
        variant: 'destructive',
      });
    } finally {
      setIsReverting(false);
    }
  };

  const handlePushToGitHub = async () => {
    setIsPushingToGithub(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push' }),
      });

      if (response.ok) {
        const data = await response.json();
        toast({
          title: 'Pushed to GitHub!',
          description: `Repository: ${data.repo.fullName}`,
        });
        fetchGitHubStatus();
      } else {
        const error = await response.json();
        throw new Error(error.error);
      }
    } catch (error) {
      toast({
        title: 'Push failed',
        description: error instanceof Error ? error.message : 'Failed to push to GitHub',
        variant: 'destructive',
      });
    } finally {
      setIsPushingToGithub(false);
    }
  };

  const handleSyncToGitHub = async () => {
    setIsSyncingToGithub(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });

      if (response.ok) {
        toast({
          title: 'Synced to GitHub!',
          description: 'Changes pushed successfully',
        });
      } else {
        const error = await response.json();
        throw new Error(error.error);
      }
    } catch (error) {
      toast({
        title: 'Sync failed',
        description: error instanceof Error ? error.message : 'Failed to sync to GitHub',
        variant: 'destructive',
      });
    } finally {
      setIsSyncingToGithub(false);
    }
  };

  const [pendingRetryMessage, setPendingRetryMessage] = useState<string | null>(null);
  
  const handleRetryMessage = (messageContent: string) => {
    // Remove the last assistant message if it exists
    setMessages(prev => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage?.role === 'assistant') {
        return prev.slice(0, -1);
      }
      return prev;
    });
    
    // Set the pending retry message
    setPendingRetryMessage(messageContent);
  };

  // Handle pending retry message
  useEffect(() => {
    if (pendingRetryMessage && !isStreaming) {
      setInputValue(pendingRetryMessage);
      setPendingRetryMessage(null);
      // Trigger send after a tick to ensure state is updated
      setTimeout(() => {
        const sendBtn = document.querySelector('[data-send-button]') as HTMLButtonElement;
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        }
      }, 100);
    }
  }, [pendingRetryMessage, isStreaming]);

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

  const fetchConversationHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const convResponse = await fetch(`/api/projects/${projectId}/chat`);
      if (convResponse.ok) {
        const convData = await convResponse.json();
        
        if (convData.conversations && convData.conversations.length > 0) {
          const latestConversation = convData.conversations[0];
          setConversationId(latestConversation.id);
          
          const msgResponse = await fetch(
            `/api/projects/${projectId}/chat?conversationId=${latestConversation.id}`
          );
          
          if (msgResponse.ok) {
            const msgData = await msgResponse.json();
            if (msgData.messages && msgData.messages.length > 0) {
              const loadedMessages: Message[] = msgData.messages.map((msg: { id: string; role: string; content: string; createdAt: string; toolCalls?: Array<{ files?: string[] }> }) => {
                // For assistant messages, format to remove code blocks
                let content = msg.content;
                const filesFromToolCalls = msg.toolCalls?.[0]?.files || [];
                
                if (msg.role === 'assistant') {
                  content = formatChatMessage(msg.content, filesFromToolCalls);
                }
                
                return {
                  id: msg.id,
                  role: msg.role as 'user' | 'assistant',
                  content,
                  createdAt: new Date(msg.createdAt),
                  filesCreated: filesFromToolCalls,
                  isCodeResponse: filesFromToolCalls.length > 0,
                };
              });
              setMessages(loadedMessages);
            }
          }
        }
      }
    } catch {
      console.error('Error fetching conversation history');
    } finally {
      setIsLoadingHistory(false);
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
    // Check if file is already open
    const existingTab = openTabs.find(tab => tab.path === filePath);
    if (existingTab) {
      setActiveTab(filePath);
      setSelectedFile(filePath);
      setViewMode('code');
      return;
    }

    try {
      const response = await fetch(
        `/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`
      );
      if (response.ok) {
        const data = await response.json();
        const fileName = filePath.split('/').pop() || filePath;
        
        const newTab: OpenTab = {
          path: filePath,
          name: fileName,
          content: data.content,
          language: data.language,
          modified: false,
        };
        
        setOpenTabs(prev => [...prev, newTab]);
        setActiveTab(filePath);
        setSelectedFile(filePath);
        setViewMode('code');
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

  const handleTabClose = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tab = openTabs.find(t => t.path === path);
    
    if (tab?.modified) {
      if (!confirm('You have unsaved changes. Close anyway?')) {
        return;
      }
    }
    
    setOpenTabs(prev => prev.filter(t => t.path !== path));
    
    if (activeTab === path) {
      const remaining = openTabs.filter(t => t.path !== path);
      if (remaining.length > 0) {
        setActiveTab(remaining[remaining.length - 1].path);
        setSelectedFile(remaining[remaining.length - 1].path);
      } else {
        setActiveTab(null);
        setSelectedFile(null);
      }
    }
  };

  const handleEditorChange = (content: string) => {
    setOpenTabs(prev => 
      prev.map(tab => 
        tab.path === activeTab 
          ? { ...tab, content, modified: true }
          : tab
      )
    );
  };

  const handleSaveFile = async () => {
    const currentTab = openTabs.find(t => t.path === activeTab);
    if (!currentTab) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: currentTab.path,
          content: currentTab.content,
        }),
      });

      if (response.ok) {
        setOpenTabs(prev =>
          prev.map(tab =>
            tab.path === activeTab ? { ...tab, modified: false } : tab
          )
        );
        toast({
          title: 'File saved',
          description: `Saved ${currentTab.name}`,
        });
        
        // Refresh preview if running
        if (previewStatus === 'running') {
          setTimeout(() => setPreviewKey(prev => prev + 1), 500);
        }
      } else {
        throw new Error('Failed to save');
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to save file',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, openTabs]);

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
        pollPreviewStatus();
      } else {
        setPreviewStatus('error');
        toast({
          title: 'Error',
          description: 'Failed to start preview',
          variant: 'destructive',
        });
      }
    } catch {
      setPreviewStatus('error');
      toast({
        title: 'Error',
        description: 'Failed to start preview',
        variant: 'destructive',
      });
    }
  };

  const pollPreviewStatus = async () => {
    const maxAttempts = 30;
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
    } catch {
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
        body: JSON.stringify({ 
          message: userMessage,
          conversationId: conversationId 
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantContent = '';
      const createdFiles: string[] = [];
      let buffer = '';  // Buffer for incomplete SSE messages

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Add new chunk to buffer
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'status') {
                // Show status updates
                setCurrentMessage(data.message || 'Processing...');
              } else if (data.type === 'text' && data.content) {
                // Append streamed text
                assistantContent += data.content;
                // Show cleaned version while streaming
                const cleanedMessage = formatChatMessage(assistantContent);
                setCurrentMessage(cleanedMessage);
              } else if (data.type === 'file_created') {
                if (data.file?.path) {
                  createdFiles.push(data.file.path);
                }
                toast({
                  title: '✅ File created',
                  description: data.file?.path || 'file',
                });
              } else if (data.type === 'error') {
                toast({
                  title: 'Error',
                  description: data.error || 'Something went wrong',
                  variant: 'destructive',
                });
              } else if (data.type === 'done') {
                if (data.conversationId) {
                  setConversationId(data.conversationId);
                }
                
                // Format the final message
                const formattedContent = formatChatMessage(assistantContent, createdFiles);
                
                const assistantMessage: Message = {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: formattedContent,
                  createdAt: new Date(),
                  filesCreated: createdFiles,
                  isCodeResponse: createdFiles.length > 0,
                };
                setMessages(prev => [...prev, assistantMessage]);
                setCurrentMessage('');
                
                if (data.filesCreated > 0) {
                  fetchFiles();
                  setOpenTabs([]);
                  setActiveTab(null);
                }
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
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
    } catch {
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
    // Get current file content if available
    const currentTab = openTabs.find(t => t.path === filePath);
    if (currentTab) {
      // Include file content for context
      const codePreview = currentTab.content.length > 500 
        ? currentTab.content.substring(0, 500) + '\n// ... (file continues)'
        : currentTab.content;
      
      setInputValue(`Please modify the file ${filePath}. Here's the current code:\n\n\`\`\`\n${codePreview}\n\`\`\`\n\nI want to: `);
    } else {
      setInputValue(`Please modify the file ${filePath}. I want to: `);
    }
  };

  // Function to include multiple files for context
  const handleAskAIWithContext = () => {
    const contextFiles = openTabs
      .filter(tab => tab.content)
      .map(tab => `### FILE: ${tab.path}\n\`\`\`\n${tab.content.substring(0, 300)}${tab.content.length > 300 ? '\n// ...' : ''}\n\`\`\``)
      .join('\n\n');
    
    if (contextFiles) {
      setInputValue(`Here are my current files:\n\n${contextFiles}\n\nPlease: `);
    } else {
      setInputValue('');
    }
  };

  const currentTab = openTabs.find(t => t.path === activeTab);

  if (status === 'loading' || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

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
            {githubStatus.repoUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(githubStatus.repoUrl!, '_blank')}
              >
                <Github className="h-4 w-4 mr-2" />
                View Repo
              </Button>
            )}
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
            {githubStatus.isConnected && !githubStatus.repoUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePushToGitHub}
                disabled={isPushingToGithub}
              >
                {isPushingToGithub ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Pushing...
                  </>
                ) : (
                  <>
                    <Github className="h-4 w-4 mr-2" />
                    Push to GitHub
                  </>
                )}
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
        {/* Left Panel - Chat (30%) */}
        <div className="border-r bg-card" style={{ width: '30%' }}>
          <div className="h-full flex flex-col">
            <div className="p-3 border-b flex items-center justify-between">
              <h2 className="font-semibold">AI Assistant</h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowGitHistory(!showGitHistory);
                    if (!showGitHistory) {
                      fetchGitCommits();
                    }
                  }}
                  className="h-8 px-2"
                  title="View commit history"
                >
                  <History className="h-4 w-4" />
                </Button>
                {githubStatus.isConnected ? (
                  githubStatus.repoUrl ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSyncToGitHub}
                      disabled={isSyncingToGithub}
                      className="h-8 px-2"
                      title="Sync to GitHub"
                    >
                      {isSyncingToGithub ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handlePushToGitHub}
                      disabled={isPushingToGithub}
                      className="h-8 px-2"
                      title="Push to GitHub"
                    >
                      {isPushingToGithub ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Github className="h-4 w-4" />
                      )}
                    </Button>
                  )
                ) : null}
              </div>
            </div>
            
            {/* Git History Panel */}
            {showGitHistory && (
              <div className="border-b bg-muted/30 p-3 max-h-48 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    <span className="text-sm font-medium">Commit History</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowGitHistory(false)}
                    className="h-6 w-6 p-0"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                </div>
                
                {githubStatus.repoUrl && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Github className="h-3 w-3" />
                    <a
                      href={githubStatus.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {githubStatus.repoName}
                    </a>
                  </div>
                )}
                
                <ScrollArea className="h-32">
                  {isLoadingCommits ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : gitCommits.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No commits yet</p>
                  ) : (
                    <div className="space-y-2">
                      {gitCommits.slice(0, 10).map((commit, index) => (
                        <div
                          key={commit.hash}
                          className="flex items-start justify-between gap-2 p-2 rounded bg-background hover:bg-muted/50 group"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{commit.message}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(commit.date).toLocaleDateString()} · {commit.hash.slice(0, 7)}
                            </p>
                          </div>
                          {index > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevertToCommit(commit.hash, commit.message)}
                              disabled={isReverting}
                              className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Revert to this commit"
                            >
                              {isReverting ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
            
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {isLoadingHistory ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <p className="mb-2">No messages yet</p>
                    <p className="text-sm">Ask AI to help you build your app!</p>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg p-3 ${
                          message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                        }`}
                      >
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                        {/* Show quick actions for code responses */}
                        {message.role === 'assistant' && message.filesCreated && message.filesCreated.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-border/50">
                            <div className="flex flex-wrap gap-2">
                              {message.filesCreated.map((file) => (
                                <button
                                  key={file}
                                  onClick={() => {
                                    fetchFileContent(file);
                                    setViewMode('code');
                                  }}
                                  className="text-xs px-2 py-1 bg-background/50 hover:bg-background rounded border flex items-center gap-1 transition-colors"
                                >
                                  <Code className="h-3 w-3" />
                                  {file.split('/').pop()}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Retry button for user messages */}
                        {message.role === 'user' && index === messages.length - 2 && !isStreaming && (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            <button
                              onClick={() => handleRetryMessage(message.content)}
                              className="text-xs px-2 py-1 bg-background/50 hover:bg-background rounded border flex items-center gap-1 transition-colors"
                            >
                              <RefreshCcw className="h-3 w-3" />
                              Retry
                            </button>
                          </div>
                        )}
                        {/* Retry button for the last assistant message */}
                        {message.role === 'assistant' && index === messages.length - 1 && !isStreaming && messages.length >= 2 && (
                          <div className="mt-2 pt-2 border-t border-border/50 flex gap-2">
                            <button
                              onClick={() => {
                                const userMessage = messages[messages.length - 2];
                                if (userMessage?.role === 'user') {
                                  handleRetryMessage(userMessage.content);
                                }
                              }}
                              className="text-xs px-2 py-1 bg-background/50 hover:bg-background rounded border flex items-center gap-1 transition-colors"
                            >
                              <RefreshCcw className="h-3 w-3" />
                              Regenerate response
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                
                {/* Streaming message display */}
                {isStreaming && currentMessage && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg p-3 bg-muted">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {currentMessage}
                      </ReactMarkdown>
                      <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                    </div>
                  </div>
                )}
                
                {/* Loading indicator when no message yet */}
                {isStreaming && !currentMessage && (
                  <div className="flex justify-start">
                    <div className="rounded-lg p-3 bg-muted flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Thinking...</span>
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="p-4 border-t">
              <div className="flex gap-2 items-end">
                <div className="flex-1 relative">
                  <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Ask AI to build features... (Shift+Enter for new line)"
                    disabled={isStreaming}
                    className="w-full min-h-[44px] max-h-[200px] resize-none px-3 py-2 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ height: 'auto' }}
                    rows={1}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                    }}
                  />
                </div>
                {isStreaming ? (
                  <Button
                    onClick={() => {
                      abortControllerRef.current?.abort();
                      setIsStreaming(false);
                      setCurrentMessage('');
                    }}
                    variant="destructive"
                    size="icon"
                    className="shrink-0"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSendMessage}
                    disabled={!inputValue.trim()}
                    size="icon"
                    className="shrink-0"
                    data-send-button="true"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {isStreaming ? '⏳ Generating... Click stop button to cancel' : '💡 Tip: Ask to create/edit multiple files at once'}
              </p>
            </div>
          </div>
        </div>

        {/* Right Panel - Toggle between Preview and Code Editor (70%) */}
        <div className="bg-background flex-1" style={{ width: '70%' }}>
          <div className="h-full flex flex-col">
            {/* Toggle Header */}
            <div className="p-2 border-b flex items-center justify-between bg-card">
              <div className="flex items-center gap-2">
                {/* Toggle Buttons */}
                <div className="flex bg-muted rounded-lg p-1">
                  <Button
                    variant={viewMode === 'preview' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('preview')}
                    className="gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    Live Preview
                  </Button>
                  <Button
                    variant={viewMode === 'code' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('code')}
                    className="gap-2"
                  >
                    <Code className="h-4 w-4" />
                    Code Editor
                  </Button>
                </div>

                {/* Preview Controls - only show in preview mode */}
                {viewMode === 'preview' && (
                  <div className="flex gap-1 ml-4">
                    {(['desktop', 'tablet', 'mobile'] as const).map((device) => (
                      <Button
                        key={device}
                        variant={previewDevice === device ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setPreviewDevice(device)}
                      >
                        {device === 'desktop' && <Monitor className="h-4 w-4" />}
                        {device === 'tablet' && <Tablet className="h-4 w-4" />}
                        {device === 'mobile' && <Smartphone className="h-4 w-4" />}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {viewMode === 'preview' ? (
                  <>
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
                  </>
                ) : (
                  <>
                    {currentTab?.modified && (
                      <Button
                        size="sm"
                        onClick={handleSaveFile}
                        disabled={isSaving}
                        className="gap-2"
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
              {viewMode === 'preview' ? (
                /* Live Preview */
                <div className="h-full flex items-center justify-center bg-muted/20">
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
              ) : (
                /* Code Editor with File Explorer */
                <div className="h-full flex">
                  {/* File Explorer Sidebar */}
                  <div className="w-64 border-r bg-card overflow-hidden flex flex-col">
                    <div className="p-2 border-b text-sm font-semibold text-muted-foreground">
                      EXPLORER
                    </div>
                    <ScrollArea className="flex-1">
                      <FileExplorer
                        files={files}
                        selectedFile={selectedFile}
                        onFileSelect={fetchFileContent}
                      />
                    </ScrollArea>
                  </div>

                  {/* Editor Area */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Tabs */}
                    {openTabs.length > 0 && (
                      <div className="flex border-b bg-muted/30 overflow-x-auto">
                        {openTabs.map((tab) => (
                          <div
                            key={tab.path}
                            className={`flex items-center gap-2 px-3 py-2 border-r cursor-pointer text-sm ${
                              activeTab === tab.path
                                ? 'bg-background border-b-2 border-b-primary'
                                : 'hover:bg-muted/50'
                            }`}
                            onClick={() => {
                              setActiveTab(tab.path);
                              setSelectedFile(tab.path);
                            }}
                          >
                            <span className={tab.modified ? 'italic' : ''}>
                              {tab.name}
                              {tab.modified && ' •'}
                            </span>
                            <button
                              onClick={(e) => handleTabClose(tab.path, e)}
                              className="hover:bg-muted rounded p-0.5"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Editor Content */}
                    <div className="flex-1 overflow-hidden">
                      {currentTab ? (
                        <div className="h-full flex flex-col">
                          <div className="flex items-center justify-between p-2 border-b bg-muted/30">
                            <span className="text-sm font-mono text-muted-foreground">
                              {currentTab.path}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAskAIToModify(currentTab.path)}
                              className="gap-2 text-xs"
                            >
                              Ask AI to modify
                            </Button>
                          </div>
                          <div className="flex-1 overflow-hidden relative">
                            <textarea
                              ref={editorRef}
                              value={currentTab.content}
                              onChange={(e) => handleEditorChange(e.target.value)}
                              className="absolute inset-0 w-full h-full p-4 font-mono text-sm bg-[#1e1e1e] text-[#d4d4d4] resize-none focus:outline-none"
                              style={{
                                lineHeight: '1.5',
                                tabSize: 2,
                              }}
                              spellCheck={false}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-muted-foreground">
                          <div className="text-center">
                            <Code className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>Select a file from the explorer to edit</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
